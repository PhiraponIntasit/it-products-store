import 'server-only';
import type { User } from '@prisma/client';
import { db } from './db';
import { can } from './auth';
import { canDecide } from '@/lib/domain';
import { CLAIM_SLA_DAYS } from './claim-service';
import { available } from './stock-reserve';
import { chatBadge } from './chat';

/** SKUs that already have a PR in flight (pending, pending_exec or approved) — never suggest re-ordering these. */
export async function openPrSkus() {
  const lines = await db.pRLine.findMany({ where: { pr: { status: { in: ['pending', 'pending_exec', 'approved'] } } }, select: { sku: true } });
  return new Set(lines.map(l => l.sku));
}

export async function lowStock() {
  const [items, open] = await Promise.all([db.inventoryItem.findMany({ orderBy: { sku: 'asc' } }), openPrSkus()]);
  // Units held for unpaid orders are as good as gone, so they don't count toward the reorder point
  const lowAll = items.filter(i => available(i) <= i.min);
  return { items, open, lowAll, lowNoPR: lowAll.filter(i => !open.has(i.sku)) };
}

/** Nav badges + bell notifications, computed only for modules the user can open. */
export async function shellData(me: User) {
  const isAdmin = me.role === 'admin';
  const badges: Record<string, number> = {};
  const notifs: { text: string; sub: string; href: string }[] = [];

  const [low, pendingN, approvedMine] = await Promise.all([
    can(me, 'inventory') ? lowStock() : null,
    can(me, 'approvals') ? db.purchaseRequest.findMany({ where: { status: { in: ['pending', 'pending_exec'] } }, select: { requesterId: true, status: true, approver1Id: true } }).then(ps => ps.filter(p => canDecide(p, me).ok).length) : 0,
    can(me, 'purchase') ? db.purchaseRequest.count({ where: { status: 'approved', ...(isAdmin ? {} : { requesterId: me.id }) } }) : 0,
  ]);
  const [toPack, lateMoney] = can(me, 'orders') ? await Promise.all([
    db.order.count({ where: { status: 'paid' } }),
    db.order.count({ where: { status: { in: ['expired', 'cancelled'] }, payments: { some: { status: 'successful' } } } }),
  ]) : [0, 0];
  // Technicians see their own claim queue; everyone else with the menu sees all open claims.
  const tech = me.role === 'itsupport';
  const [claimsNew, claimsHeld, claimsOverdue, claimsUnassigned] = can(me, 'claims') ? await Promise.all([
    tech ? 0 : db.claim.count({ where: { status: 'submitted' } }),
    db.claim.count({ where: { status: 'received', ...(tech ? { assigneeId: me.id } : {}) } }),
    db.claim.count({ where: { status: 'received', receivedAt: { lt: new Date(Date.now() - CLAIM_SLA_DAYS * 864e5) }, ...(tech ? { assigneeId: me.id } : {}) } }),
    tech ? 0 : db.claim.count({ where: { status: 'received', assigneeId: null } }),
  ]) : [0, 0, 0, 0];
  const lowNoPR = low?.lowNoPR ?? [];
  const chat = can(me, 'chat') ? await chatBadge(me.id) : { waiting: 0, mineUnread: 0 };
  if (chat.waiting) notifs.push({ text: `แชทลูกค้ารอพนักงาน ${chat.waiting} รายการ`, sub: 'แชทลูกค้า', href: '/chat?tab=waiting' });
  if (chat.mineUnread) notifs.push({ text: `ลูกค้าตอบแชทที่คุณดูแล ${chat.mineUnread} รายการ`, sub: 'แชทลูกค้า', href: '/chat?tab=mine' });
  Object.assign(badges, { chat: chat.waiting + chat.mineUnread, claims: claimsNew + claimsHeld, approvals: pendingN, inventory: lowNoPR.length, purchase: approvedMine, orders: toPack + lateMoney });

  if (tech && claimsHeld) notifs.push({ text: `เคลมที่มอบหมายให้คุณ ${claimsHeld} เรื่อง`, sub: 'ตรวจเครื่องและบันทึกผล', href: '/claims?tab=mine' });
  if (claimsUnassigned) notifs.push({ text: `เคลมที่รับเครื่องแล้วแต่ยังไม่มอบหมายช่าง ${claimsUnassigned} เรื่อง`, sub: 'เคลมสินค้า', href: '/claims?tab=received' });
  if (claimsOverdue) notifs.push({ text: `เคลมเกินกำหนด ${CLAIM_SLA_DAYS} วัน ${claimsOverdue} เรื่อง`, sub: 'รับเครื่องมานานแล้วยังไม่มีผล', href: tech ? '/claims?tab=mine' : '/claims?tab=received' });
  if (lowNoPR.length) notifs.push({ text: `สินค้า ${lowNoPR.length} รายการต่ำกว่าจุดสั่งซื้อ`, sub: lowNoPR.map(i => i.name).join(', '), href: '/inventory' });
  if (pendingN) notifs.push({ text: `ใบขอซื้อรออนุมัติ ${pendingN} ใบ`, sub: 'อนุมัติการสั่งซื้อ', href: '/approvals' });
  if (approvedMine) notifs.push({ text: `ใบขอซื้อได้รับอนุมัติ ${approvedMine} ใบ`, sub: 'พร้อมออกใบสั่งซื้อ (PO) และรับเข้าคลัง', href: '/purchase' });
  if (toPack) notifs.push({ text: `คำสั่งซื้อชำระแล้ว รอแพ็ก ${toPack} รายการ`, sub: 'คำสั่งซื้อ & จัดส่ง', href: '/orders' });
  if (lateMoney) notifs.push({ text: `เงินเข้าหลังคำสั่งซื้อหมดเวลา ${lateMoney} รายการ`, sub: 'ต้องโอนคืนลูกค้า', href: '/orders?tab=refund' });
  if (claimsNew) notifs.push({ text: `เคลมใหม่จากลูกค้า ${claimsNew} รายการ`, sub: 'รอลูกค้าส่งเครื่อง — กด “รับเครื่องแล้ว” เมื่อได้รับ', href: '/claims?tab=submitted' });
  if (!tech && claimsHeld) notifs.push({ text: `เครื่องเคลมรอตรวจสอบ ${claimsHeld} รายการ`, sub: 'ซ่อมคืน เปลี่ยนเครื่องใหม่ หรือไม่อนุมัติ', href: '/claims?tab=received' });
  return { badges, notifs };
}
