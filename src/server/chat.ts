import 'server-only';
import type { Prisma, User } from '@prisma/client';
import { db, num } from './db';
import { Fail, str } from './act';
import { audit } from './auth';
import { getCustomer } from './customer-session';
import { appUrl, sendMail } from './mail';
import { ORDER_ST } from './orders';
import { CLAIM_ST, OPEN_CLAIM } from './claims';
import { MISS, ruleReply, type AssistantReply } from './assistant';
import { claudeEnabled, claudeReply } from './assistant-claude';
import { baht, fmtDT } from '@/lib/domain';

// Storefront live chat (person A). Signed-in customers only — a visitor is asked to sign in first, so staff always know
// who they are talking to and replies can be emailed. One open conversation per customer. Status: bot (assistant
// answering) → waiting (needs a person) → open (a staff member took it) → closed. Both sides poll for new messages by id.

type Staff = Pick<User, 'id' | 'name' | 'role'>;

export const CHAT_MAX_LEN = 1000;
const RATE_PER_MIN = 12;
/** With Claude answering, a conversation that goes on this long is handed to staff (keeps cost per chat bounded). */
const MAX_BOT_TURNS = 40;
const PAGE = 200;
/** The customer counts as "away" when their widget hasn't polled for this long — staff replies are then emailed. */
const AWAY_MS = 2 * 60e3;
/** At most one "staff replied" email per conversation in this window. */
const EMAIL_GAP_MS = 15 * 60e3;
const OPEN = ['bot', 'waiting', 'open'];

export const CHAT_ST: Record<string, [string, string]> = {
  bot: ['ผู้ช่วยอัตโนมัติกำลังตอบ', 'tag-neutral'], waiting: ['รอพนักงาน', 'tag-accent-2'], open: ['กำลังคุย', 'tag-accent'], closed: ['ปิดแล้ว', 'tag-outline'],
};

const threadInclude = { customer: { select: { id: true, name: true, email: true } }, assignee: { select: { name: true } } } satisfies Prisma.ChatThreadInclude;
type ThreadRow = Prisma.ChatThreadGetPayload<{ include: typeof threadInclude }>;

/** The signed-in customer's open conversation, if any. */
async function openThread(customerId: string): Promise<ThreadRow | null> {
  return db.chatThread.findFirst({ where: { customerId, status: { in: OPEN } }, orderBy: { createdAt: 'desc' }, include: threadInclude });
}

const nameOf = (t: { customer: { name: string } }) => t.customer.name;
const msgOut = (m: { id: number; role: string; text: string; by: string; createdAt: Date }) => ({ id: m.id, role: m.role, text: m.text, by: m.by, at: m.createdAt.toISOString() });
export type ChatMsg = ReturnType<typeof msgOut>;

// ── Customer side ─────────────────────────────────────────────────────────────

/** What the widget shows: who the customer is, their latest conversation (an ended one stays visible until they write
 *  again, so they see that it was closed) and messages after `afterId`. Marks them seen.
 *  A visitor who isn't signed in gets `signedIn: false` and nothing else. */
export async function customerChat(afterId = 0) {
  const me = await getCustomer();
  if (!me) return { signedIn: false, name: '', thread: null, messages: [] as ChatMsg[] };
  const t = await db.chatThread.findFirst({ where: { customerId: me.id }, orderBy: { createdAt: 'desc' }, include: threadInclude });
  if (!t) return { signedIn: true, name: me.name, thread: null, messages: [] as ChatMsg[] };
  const [messages] = await Promise.all([
    db.chatMessage.findMany({ where: { threadId: t.id, id: { gt: afterId } }, orderBy: { id: 'asc' }, take: PAGE }),
    db.chatThread.update({ where: { id: t.id }, data: { customerSeenAt: new Date(), updatedAt: t.updatedAt } }), // polling must not reorder the inbox
  ]);
  return {
    signedIn: true, name: me.name,
    thread: { id: t.id, status: t.status, statusLabel: CHAT_ST[t.status]?.[0] ?? t.status, staff: t.status === 'open' ? t.assignee?.name ?? '' : '' },
    messages: messages.map(msgOut),
  };
}
export type CustomerChat = Awaited<ReturnType<typeof customerChat>>;

async function signedIn() {
  const me = await getCustomer();
  if (!me) throw new Fail('กรุณาเข้าสู่ระบบก่อนแชทกับร้าน');
  return me;
}

/** Customer sends a message, starting a conversation if there is none. */
export async function customerSend(textIn: string) {
  const text = str(textIn).slice(0, CHAT_MAX_LEN + 1);
  if (!text) throw new Fail('พิมพ์ข้อความก่อนส่ง');
  if (text.length > CHAT_MAX_LEN) throw new Fail(`ข้อความยาวได้ไม่เกิน ${CHAT_MAX_LEN} ตัวอักษร`);
  const me = await signedIn();
  // A new conversation starts with the assistant; it hands over to staff when it can't help.
  const t = (await openThread(me.id)) ?? (await db.chatThread.create({ data: { customerId: me.id, status: 'bot' }, include: threadInclude }));
  const recent = await db.chatMessage.count({ where: { threadId: t.id, role: 'customer', createdAt: { gt: new Date(Date.now() - 60e3) } } });
  if (recent >= RATE_PER_MIN) throw new Fail('ส่งข้อความถี่เกินไป รอสักครู่แล้วลองใหม่');
  await db.$transaction([
    db.chatMessage.create({ data: { threadId: t.id, role: 'customer', text } }),
    db.chatThread.update({ where: { id: t.id }, data: { customerSeenAt: new Date() } }), // also bumps updatedAt → top of the staff inbox
  ]);
  if (t.status === 'bot') await assistantTurn(t.id, me.id, text);
  return t.id;
}

/** The assistant answers the customer's latest message: Claude when an API key is set, otherwise (or if Claude fails or
 *  declines) the rule-based assistant. With the rules, two "didn't understand" in a row hand the chat to staff. */
async function assistantTurn(threadId: string, customerId: string, text: string) {
  let r: AssistantReply | null = null;
  if (claudeEnabled()) {
    const used = await db.chatMessage.count({ where: { threadId, role: 'bot' } });
    if (used >= MAX_BOT_TURNS) r = { text: 'คุยกันมาหลายข้อความแล้ว ขอส่งต่อให้พนักงานช่วยดูต่อนะครับ', handoff: true };
    else {
      try { r = await claudeReply(threadId, customerId); } catch (e) { console.error('claude assistant failed, using rules', e); }
    }
  }
  if (!r) {
    try { r = await ruleReply(customerId, text); } catch (e) {
      console.error('assistant failed', e);
      r = { text: 'ขออภัย ผู้ช่วยอัตโนมัติขัดข้อง ขอส่งต่อให้พนักงานครับ', handoff: true };
    }
    if (r.miss) {
      const prev = await db.chatMessage.findFirst({ where: { threadId, role: 'bot' }, orderBy: { id: 'desc' }, select: { text: true } });
      if (prev?.text.startsWith(MISS)) r = { text: 'ขอโทษครับ ผมยังตอบเรื่องนี้ไม่ได้ ขอส่งต่อให้พนักงานช่วยดูนะครับ', handoff: true };
    }
  }
  await db.chatMessage.create({ data: { threadId, role: 'bot', text: r.text, by: 'ผู้ช่วยอัตโนมัติ' } });
  if (r.handoff) await handOff(threadId);
}

async function handOff(threadId: string) {
  const n = await db.chatThread.updateMany({ where: { id: threadId, status: 'bot' }, data: { status: 'waiting' } });
  if (n.count) await db.chatMessage.create({ data: { threadId, role: 'system', text: 'ส่งต่อให้พนักงานแล้ว — พนักงานจะตอบในหน้าต่างนี้' } });
}

/** The customer asks for a person ("คุยกับพนักงาน"): straight to the staff queue, starting a conversation if needed. */
export async function customerAskStaff() {
  const me = await signedIn();
  const t = (await openThread(me.id)) ?? (await db.chatThread.create({ data: { customerId: me.id, status: 'bot' }, include: threadInclude }));
  await handOff(t.id);
}

/** Customer ends the conversation from the widget. */
export async function customerClose() {
  const t = await openThread((await signedIn()).id);
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
  if (tab === 'open') return { status: { in: ['bot', 'waiting', 'open'] } }; // includes chats the assistant is still answering
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
        ...threadInclude, messages: { where: { role: { not: 'system' } }, orderBy: { id: 'desc' }, take: 1 },
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
        id: r.id, name: nameOf(r), status: r.status, statusLabel: CHAT_ST[r.status][0], statusTag: CHAT_ST[r.status][1],
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
    name: nameOf(t), customerId: t.customer.id, email: t.customer.email,
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

  const away = !t.customerSeenAt || Date.now() - t.customerSeenAt.getTime() > AWAY_MS;
  const quiet = !t.emailedAt || Date.now() - t.emailedAt.getTime() > EMAIL_GAP_MS;
  if (away && quiet) {
    await db.chatThread.update({ where: { id }, data: { emailedAt: new Date() } });
    const base = appUrl();
    await mailSafe(t.customer.email, 'พนักงาน COREPICK ตอบแชทของคุณแล้ว', [
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
