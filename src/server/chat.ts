import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { db, num } from './db';
import { Fail, str } from './act';
import { audit } from './auth';
import { getCustomer } from './customer-session';
import { appUrl, sendMail } from './mail';
import { ORDER_ST } from './orders';
import { CLAIM_ST, OPEN_CLAIM } from './claims';
import { baht, fmtDT } from '@/lib/domain';

// Storefront live chat (person A). One open conversation per signed-in customer, or per visitor cookie (only its
// sha256 is stored, like the guest cart). Status: bot (assistant answering) → waiting (needs a person) → open (a staff
// member took it) → closed. Both sides poll for new messages by id; staff replies are emailed if the customer has left.

type Staff = Pick<User, 'id' | 'name' | 'role'>;

export const CHAT_COOKIE = 'cp_chat';
export const CHAT_MAX_LEN = 1000;
const RATE_PER_MIN = 12;
const PAGE = 200;
/** The customer counts as "away" when their widget hasn't polled for this long — staff replies are then emailed. */
const AWAY_MS = 2 * 60e3;
/** At most one "staff replied" email per conversation in this window. */
const EMAIL_GAP_MS = 15 * 60e3;
const DAYS = 30;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const OPEN = ['bot', 'waiting', 'open'];

export const CHAT_ST: Record<string, [string, string]> = {
  bot: ['ผู้ช่วยอัตโนมัติ', 'tag-neutral'], waiting: ['รอพนักงาน', 'tag-accent-2'], open: ['กำลังคุย', 'tag-accent'], closed: ['ปิดแล้ว', 'tag-outline'],
};

async function guestToken() {
  const t = (await cookies()).get(CHAT_COOKIE)?.value;
  return t && /^[\w-]{20,64}$/.test(t) ? t : null;
}

async function setGuestCookie() {
  const token = randomBytes(24).toString('base64url');
  (await cookies()).set(CHAT_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: DAYS * 86400,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  });
  return token;
}

const threadInclude = { customer: { select: { id: true, name: true, email: true } }, assignee: { select: { name: true } } } satisfies Prisma.ChatThreadInclude;
type ThreadRow = Prisma.ChatThreadGetPayload<{ include: typeof threadInclude }>;

/** The browser's open conversation, if any. A visitor's conversation moves to their account when they sign in. */
async function openThread(): Promise<ThreadRow | null> {
  const me = await getCustomer();
  const t = await guestToken();
  const guest = t ? await db.chatThread.findUnique({ where: { guestToken: sha256(t) }, include: threadInclude }) : null;
  if (me) {
    const mine = await db.chatThread.findFirst({ where: { customerId: me.id, status: { in: OPEN } }, orderBy: { createdAt: 'desc' }, include: threadInclude });
    if (mine) return mine;
    if (guest && OPEN.includes(guest.status) && !guest.customerId) {
      return db.chatThread.update({ where: { id: guest.id }, data: { customerId: me.id, guestToken: null }, include: threadInclude });
    }
    return null;
  }
  return guest && OPEN.includes(guest.status) ? guest : null;
}

const nameOf = (t: { customer: { name: string } | null; guestName: string }) => t.customer?.name || t.guestName || 'ผู้เยี่ยมชม';
const msgOut = (m: { id: number; role: string; text: string; by: string; createdAt: Date }) => ({ id: m.id, role: m.role, text: m.text, by: m.by, at: m.createdAt.toISOString() });
export type ChatMsg = ReturnType<typeof msgOut>;

// ── Customer side ─────────────────────────────────────────────────────────────

/** What the widget shows: who the customer is, the conversation (if any) and messages after `afterId`. Marks them seen. */
export async function customerChat(afterId = 0) {
  const [me, t] = await Promise.all([getCustomer(), openThread()]);
  const identity = me ? { signedIn: true, name: me.name } : { signedIn: false, name: '' };
  if (!t) return { ...identity, thread: null, messages: [] as ChatMsg[] };
  const [messages] = await Promise.all([
    db.chatMessage.findMany({ where: { threadId: t.id, id: { gt: afterId } }, orderBy: { id: 'asc' }, take: PAGE }),
    db.chatThread.update({ where: { id: t.id }, data: { customerSeenAt: new Date(), updatedAt: t.updatedAt } }), // polling must not reorder the inbox
  ]);
  return {
    ...identity, name: me ? me.name : t.guestName,
    thread: { id: t.id, status: t.status, statusLabel: CHAT_ST[t.status]?.[0] ?? t.status, staff: t.status === 'open' ? t.assignee?.name ?? '' : '', email: me ? me.email : t.guestEmail },
    messages: messages.map(msgOut),
  };
}
export type CustomerChat = Awaited<ReturnType<typeof customerChat>>;

/** A visitor's name (required) and email (optional, for replies while they are away) before their first message. */
function readContact(nameIn: string, emailIn: string) {
  const name = str(nameIn).slice(0, 60), email = str(emailIn).toLowerCase().slice(0, 120);
  if (name.length < 2) throw new Fail('กรุณาบอกชื่อเพื่อให้พนักงานเรียกได้ถูก');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Fail('อีเมลไม่ถูกต้อง');
  return { name, email };
}

/** Customer sends a message. Starts a conversation if there is none (visitors must give a name first). */
export async function customerSend(textIn: string, contact?: { name: string; email: string }) {
  const text = str(textIn).slice(0, CHAT_MAX_LEN + 1);
  if (!text) throw new Fail('พิมพ์ข้อความก่อนส่ง');
  if (text.length > CHAT_MAX_LEN) throw new Fail(`ข้อความยาวได้ไม่เกิน ${CHAT_MAX_LEN} ตัวอักษร`);
  const me = await getCustomer();
  let t = await openThread();
  if (!t) {
    // Until the assistant (bot) arrives, every new conversation goes straight to staff.
    if (me) t = await db.chatThread.create({ data: { customerId: me.id, status: 'waiting' }, include: threadInclude });
    else {
      const c = readContact(contact?.name ?? '', contact?.email ?? '');
      const token = (await guestToken()) ?? (await setGuestCookie());
      // A visitor's previous (closed) conversation keeps its history but gives up the cookie link.
      await db.chatThread.updateMany({ where: { guestToken: sha256(token) }, data: { guestToken: null } });
      t = await db.chatThread.create({ data: { guestToken: sha256(token), guestName: c.name, guestEmail: c.email, status: 'waiting' }, include: threadInclude });
    }
  }
  const recent = await db.chatMessage.count({ where: { threadId: t.id, role: 'customer', createdAt: { gt: new Date(Date.now() - 60e3) } } });
  if (recent >= RATE_PER_MIN) throw new Fail('ส่งข้อความถี่เกินไป รอสักครู่แล้วลองใหม่');
  await db.$transaction([
    db.chatMessage.create({ data: { threadId: t.id, role: 'customer', text } }),
    db.chatThread.update({ where: { id: t.id }, data: { customerSeenAt: new Date() } }), // also bumps updatedAt → top of the staff inbox
  ]);
  return t.id;
}

/** The customer asks for a person (used by the assistant's "คุยกับพนักงาน" button). */
export async function customerAskStaff() {
  const t = await openThread();
  if (!t) throw new Fail('ยังไม่มีบทสนทนา');
  if (t.status !== 'bot') return;
  await db.$transaction([
    db.chatThread.update({ where: { id: t.id }, data: { status: 'waiting' } }),
    db.chatMessage.create({ data: { threadId: t.id, role: 'system', text: 'ส่งต่อให้พนักงานแล้ว — พนักงานจะตอบในหน้าต่างนี้' } }),
  ]);
}

/** Customer ends the conversation from the widget. */
export async function customerClose() {
  const t = await openThread();
  if (!t) return;
  await db.$transaction([
    db.chatThread.update({ where: { id: t.id }, data: { status: 'closed', closedAt: new Date() } }),
    db.chatMessage.create({ data: { threadId: t.id, role: 'system', text: 'ลูกค้าปิดบทสนทนา' } }),
  ]);
}

// ── Back office ───────────────────────────────────────────────────────────────

export const CHAT_TABS = [['waiting', 'รอรับเรื่อง'], ['mine', 'ของฉัน'], ['open', 'ทั้งหมดที่เปิดอยู่'], ['closed', 'ปิดแล้ว']] as const;
export type ChatTab = (typeof CHAT_TABS)[number][0];
export const isChatTab = (t: string | undefined): t is ChatTab => CHAT_TABS.some(x => x[0] === t);

function tabWhere(tab: ChatTab, meId: string): Prisma.ChatThreadWhereInput {
  if (tab === 'waiting') return { status: 'waiting' };
  if (tab === 'mine') return { status: 'open', assigneeId: meId };
  if (tab === 'open') return { status: { in: ['waiting', 'open'] } };
  return { status: 'closed' };
}

/** Customer messages the staff side hasn't read yet, per conversation. */
async function unreadBy(ids: string[], seen: Map<string, Date | null>) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db.chatMessage.findMany({ where: { threadId: { in: ids }, role: 'customer' }, select: { threadId: true, createdAt: true } });
  const out = new Map<string, number>();
  for (const r of rows) { const s = seen.get(r.threadId); if (!s || r.createdAt > s) out.set(r.threadId, (out.get(r.threadId) ?? 0) + 1); }
  return out;
}

export async function chatInbox(tab: ChatTab, meId: string) {
  const [rows, counts] = await Promise.all([
    db.chatThread.findMany({
      where: tabWhere(tab, meId), orderBy: tab === 'closed' ? [{ closedAt: 'desc' }] : [{ updatedAt: 'desc' }], take: 100, include: {
        ...threadInclude, messages: { orderBy: { id: 'desc' }, take: 1 },
      },
    }),
    Promise.all(CHAT_TABS.map(([t]) => t === 'closed' ? Promise.resolve(0) : db.chatThread.count({ where: tabWhere(t, meId) }))),
  ]);
  const unread = await unreadBy(rows.map(r => r.id), new Map(rows.map(r => [r.id, r.staffSeenAt])));
  return {
    counts: Object.fromEntries(CHAT_TABS.map(([t], i) => [t, counts[i]])) as Record<ChatTab, number>,
    rows: rows.map(r => {
      const last = r.messages[0];
      return {
        id: r.id, name: nameOf(r), guest: !r.customerId, status: r.status, statusLabel: CHAT_ST[r.status][0], statusTag: CHAT_ST[r.status][1],
        assignee: r.assignee?.name ?? '', updatedText: fmtDT(r.updatedAt), unread: unread.get(r.id) ?? 0,
        preview: last ? `${last.role === 'staff' ? 'พนักงาน: ' : last.role === 'bot' ? 'ผู้ช่วย: ' : ''}${last.text}`.slice(0, 120) : '',
      };
    }),
  };
}

/** One conversation for staff, with who the customer is and what they bought — and mark it read. */
export async function chatForStaff(id: string, afterId = 0) {
  const t = await db.chatThread.findUnique({ where: { id }, include: threadInclude });
  if (!t) return null;
  const [messages] = await Promise.all([
    db.chatMessage.findMany({ where: { threadId: id, id: { gt: afterId } }, orderBy: { id: 'asc' }, take: 500 }),
    db.chatThread.update({ where: { id }, data: { staffSeenAt: new Date(), updatedAt: t.updatedAt } }), // reading must not reorder the inbox
  ]);
  return {
    id: t.id, status: t.status, statusLabel: CHAT_ST[t.status][0], statusTag: CHAT_ST[t.status][1], assigneeId: t.assigneeId, assignee: t.assignee?.name ?? '',
    name: nameOf(t), customerId: t.customer?.id ?? null, email: t.customer?.email || t.guestEmail, guest: !t.customerId,
    createdText: fmtDT(t.createdAt), customerOnline: !!t.customerSeenAt && Date.now() - t.customerSeenAt.getTime() < AWAY_MS,
    messages: messages.map(msgOut),
  };
}
export type StaffChat = NonNullable<Awaited<ReturnType<typeof chatForStaff>>>;

/** Recent orders and open claims of a signed-in customer, shown beside the conversation. */
export async function chatContext(customerId: string) {
  const [orders, claims] = await Promise.all([
    db.order.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, total: true, createdAt: true } }),
    db.claim.findMany({ where: { customerId, status: { in: OPEN_CLAIM } }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, serial: true } }),
  ]);
  return {
    orders: orders.map(o => ({ id: o.id, text: `${ORDER_ST[o.status]?.[0] ?? o.status} · ${baht(num(o.total))}`, date: fmtDT(o.createdAt) })),
    claims: claims.map(c => ({ id: c.id, text: `${CLAIM_ST[c.status]?.[0] ?? c.status} · ${c.serial}` })),
  };
}

async function mustOpen(id: string) {
  const t = await db.chatThread.findUnique({ where: { id }, include: threadInclude });
  if (!t) throw new Fail('ไม่พบบทสนทนานี้');
  if (t.status === 'closed') throw new Fail('บทสนทนานี้ปิดแล้ว');
  return t;
}

/** Staff takes the conversation: it leaves the shared queue and the customer sees who is answering. */
export async function takeChat(me: Staff, id: string) {
  const t = await mustOpen(id);
  if (t.assigneeId === me.id && t.status === 'open') return;
  await db.$transaction([
    db.chatThread.update({ where: { id }, data: { status: 'open', assigneeId: me.id } }),
    db.chatMessage.create({ data: { threadId: id, role: 'system', text: `${me.name} เข้ามาดูแลบทสนทนานี้` } }),
  ]);
}

/** Staff replies. Replying takes the conversation if someone else (or no one) had it. The customer gets an email if they're away. */
export async function staffReply(me: Staff, id: string, textIn: string) {
  const text = str(textIn);
  if (!text) throw new Fail('พิมพ์ข้อความก่อนส่ง');
  if (text.length > CHAT_MAX_LEN) throw new Fail(`ข้อความยาวได้ไม่เกิน ${CHAT_MAX_LEN} ตัวอักษร`);
  const t = await mustOpen(id);
  if (t.assigneeId !== me.id || t.status !== 'open') await takeChat(me, id); // replying takes the conversation (with a note the customer sees)
  await db.chatMessage.create({ data: { threadId: id, role: 'staff', text, staffId: me.id, by: me.name } });
  await db.chatThread.update({ where: { id }, data: { staffSeenAt: new Date() } });

  const to = t.customer?.email || t.guestEmail;
  const away = !t.customerSeenAt || Date.now() - t.customerSeenAt.getTime() > AWAY_MS;
  const quiet = !t.emailedAt || Date.now() - t.emailedAt.getTime() > EMAIL_GAP_MS;
  if (to && away && quiet) {
    await db.chatThread.update({ where: { id }, data: { emailedAt: new Date() } });
    const base = appUrl();
    await mailSafe(to, 'พนักงาน COREPICK ตอบแชทของคุณแล้ว', [
      `เรียนคุณ${nameOf(t)}`, '', `${me.name} ตอบข้อความของคุณ:`, '', text, '',
      base ? `อ่านและตอบกลับได้ที่ ${base}/?chat=1` : 'เปิดหน้าร้านแล้วกดปุ่มแชทเพื่ออ่านและตอบกลับ',
    ].join('\n'));
  }
}

export async function closeChat(me: Staff, id: string) {
  const t = await mustOpen(id);
  await db.$transaction(async tx => {
    await tx.chatThread.update({ where: { id }, data: { status: 'closed', closedAt: new Date(), assigneeId: t.assigneeId ?? me.id } });
    await tx.chatMessage.create({ data: { threadId: id, role: 'system', text: `${me.name} ปิดบทสนทนา — ถ้ามีคำถามเพิ่ม ส่งข้อความใหม่ได้เลย` } });
    await audit(tx, me, 'chat', 'ปิดแชทลูกค้า', id, nameOf(t));
  });
}

/** Back-office badge: conversations waiting for a person + this user's conversations with unread customer messages. */
export async function chatBadge(meId: string) {
  const [waiting, mine] = await Promise.all([
    db.chatThread.count({ where: { status: 'waiting' } }),
    db.chatThread.findMany({ where: { status: 'open', assigneeId: meId }, select: { id: true, staffSeenAt: true } }),
  ]);
  const unread = await unreadBy(mine.map(m => m.id), new Map(mine.map(m => [m.id, m.staffSeenAt])));
  return { waiting, mineUnread: [...unread.values()].filter(n => n > 0).length };
}

async function mailSafe(to: string, subject: string, text: string) {
  try {
    const html = `<div style="font-family:sans-serif;white-space:pre-line">${text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!)}</div>`;
    await sendMail(to, subject, text, html);
  } catch (e) { console.error('chat mail failed', e); }
}
