import 'server-only';
import { randomBytes } from 'node:crypto';
import { Prisma, type Customer } from '@prisma/client';
import { db, nextSeq, num, type Tx } from './db';
import { Fail } from './act';
import { release, reserve, sellReserved } from './stock-reserve';
import { paymentConfig } from './payments/config';
import { SIGNATURE_HEADER, verify } from './payments/signature';
import { promptPayPayload } from '@/lib/promptpay';
import { provinceOf, shippingFee, shippingNote } from '@/lib/shipping';
import { baht, DISPLAY_TZ } from '@/lib/domain';
import { appUrl, sendMail } from './mail';
import { checkCoupon, claimCoupon, releaseCoupon } from './coupons';
import { salesFor } from './pricing';

// Checkout → payment → stock, all on the server (amounts never come from the browser):
//   placeOrder   cart → Order(pending_payment) + hold stock (reserved) + Payment with a PromptPay QR, one transaction
//   handleWebhook signed provider event → Payment successful, Order paid, held units leave stock (sale)
//   expireOrder  unpaid past expiresAt, or cancelled by the customer → hand the held units back
// Every status change is a conditional updateMany on the old status, so a repeated webhook, a double click
// or the expiry sweep racing a payment can only ever apply once.

export const ORDER_ST: Record<string, [string, string]> = {
  pending_payment: ['รอชำระเงิน', 'tag-accent-2'], paid: ['ชำระแล้ว', 'tag-accent'], packing: ['กำลังแพ็ก', 'tag-accent'],
  shipped: ['จัดส่งแล้ว', 'tag-accent'], completed: ['สำเร็จ', 'tag-neutral'], cancelled: ['ยกเลิก', 'tag-outline'],
  expired: ['หมดเวลาชำระเงิน', 'tag-outline'], refunded: ['คืนเงินแล้ว', 'tag-outline'],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

async function log(tx: Tx, by: string, role: string, action: string, target: string, detail = '') {
  await tx.auditLog.create({ data: { userId: null, by, role, cat: 'order', action, target, detail } });
}
const asCustomer = (c: Pick<Customer, 'name'>) => [`${c.name}`, 'ลูกค้า'] as const;
const SYSTEM = ['ระบบชำระเงิน', 'ระบบ'] as const;

// ── cart & totals ──

export type CheckoutLine = { sku: string; name: string; price: number; cost: number; qty: number; available: number; active: boolean };

export async function cartLines(customerId: string): Promise<CheckoutLine[]> {
  const cart = await db.cart.findUnique({ where: { customerId }, include: { items: { include: { item: true }, orderBy: { sku: 'asc' } } } });
  const sales = await salesFor((cart?.items ?? []).map(ci => ci.sku)); // a running flash sale is the price charged
  return (cart?.items ?? []).map(ci => ({
    sku: ci.sku, name: ci.item.name, price: sales.get(ci.sku)?.price ?? num(ci.item.price), cost: num(ci.item.cost), qty: ci.qty,
    available: ci.item.qty - ci.item.reserved, active: ci.item.active,
  }));
}

export function totals(lines: { price: number; qty: number }[], province: string, discount = 0) {
  const subtotal = round2(lines.reduce((a, l) => a + l.price * l.qty, 0));
  const goods = round2(Math.max(0, subtotal - discount));
  const fee = shippingFee(province, goods);
  return { subtotal, discount: round2(subtotal - goods), shippingFee: fee, total: round2(goods + fee), shippingNote: shippingNote(province, goods) };
}

// ── address ──

export type AddressIn = { name: string; phone: string; line1: string; subdistrict: string; district: string; province: string; postcode: string };

export function readAddress(f: Record<string, unknown>): AddressIn {
  const s = (k: string, max: number) => String(f[k] ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const a = { name: s('name', 100), phone: s('phone', 20).replace(/[\s-]/g, ''), line1: s('line1', 200), subdistrict: s('subdistrict', 80), district: s('district', 80), province: s('province', 40), postcode: s('postcode', 5) };
  if (!a.name) throw new Fail('กรุณากรอกชื่อผู้รับ');
  if (!/^0\d{8,9}$/.test(a.phone)) throw new Fail('เบอร์โทรผู้รับไม่ถูกต้อง (เช่น 0812345678)');
  if (!a.line1 || !a.subdistrict || !a.district) throw new Fail('กรุณากรอกที่อยู่ ตำบล/แขวง และอำเภอ/เขต');
  const province = provinceOf(a.province);
  if (!province) throw new Fail('กรุณาเลือกจังหวัด');
  if (!/^[1-9]\d{4}$/.test(a.postcode)) throw new Fail('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');
  return { ...a, province };
}

export const addressText = (a: AddressIn) => `${a.line1} ต.${a.subdistrict} อ.${a.district} จ.${a.province} ${a.postcode}`;

// ── place an order ──

const fmtTime = (d: Date) => d.toLocaleString('th-TH', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit' });

export async function placeOrder(customer: Customer, addr: AddressIn, saveAddress: boolean, couponIn = ''): Promise<string> {
  await expireDue(); // stock held by orders nobody paid for goes back on sale first
  const lines = await cartLines(customer.id);
  if (!lines.length) throw new Fail('ตะกร้าว่าง');
  const off = lines.find(l => !l.active);
  if (off) throw new Fail(`${off.name} หยุดขายแล้ว — นำออกจากตะกร้าก่อน`);

  const now = new Date(), expiresAt = new Date(now.getTime() + paymentConfig.payMinutes() * 60_000);
  const year = now.toLocaleDateString('en-CA', { timeZone: DISPLAY_TZ, year: 'numeric' });
  const { id, t } = await db.$transaction(async tx => {
    // Coupon first: checked and one use taken inside the same transaction, so a limited code can't be oversold
    const subtotal = totals(lines, addr.province).subtotal;
    const cp = couponIn.trim() ? await checkCoupon(tx, couponIn, customer.id, subtotal, now) : null;
    if (cp && !(await claimCoupon(tx, cp.coupon.code))) throw new Fail('คูปองนี้ถูกใช้ครบจำนวนแล้ว');
    const t = totals(lines, addr.province, cp?.discount ?? 0);
    if (!(t.total > 0)) throw new Fail('ยอดชำระไม่ถูกต้อง');
    for (const l of lines)
      if (!(await reserve(tx, l.sku, l.qty))) {
        const it = await tx.inventoryItem.findUniqueOrThrow({ where: { sku: l.sku } });
        throw new Fail(`${l.name} เหลือไม่พอ — สั่งได้ ${Math.max(0, it.qty - it.reserved)} ชิ้น`);
      }
    const id = `ORD-${year}-${String(await nextSeq(tx, 'ord')).padStart(6, '0')}`;
    await tx.order.create({
      data: {
        id, customerId: customer.id, status: 'pending_payment',
        subtotal: t.subtotal, discount: t.discount, shippingFee: t.shippingFee, total: t.total, couponCode: cp?.coupon.code ?? null,
        shipName: addr.name, shipPhone: addr.phone, shipAddress: addressText(addr), expiresAt,
        lines: { create: lines.map(l => ({ sku: l.sku, name: l.name, price: l.price, cost: l.cost, qty: l.qty })) },
        payments: { create: { provider: 'demo_promptpay', amount: t.total, providerRef: 'demo_' + randomBytes(12).toString('hex'), qrImage: promptPayPayload(paymentConfig.promptPayId(), t.total), expiresAt } },
      },
    });
    await tx.cartItem.deleteMany({ where: { cart: { customerId: customer.id } } });
    if (saveAddress || !(await tx.address.count({ where: { customerId: customer.id } }))) {
      const first = !(await tx.address.count({ where: { customerId: customer.id } }));
      await tx.address.create({ data: { customerId: customer.id, ...addr, isDefault: first } });
    }
    await log(tx, ...asCustomer(customer), 'สั่งซื้อ', id, `${lines.map(l => `${l.name} × ${l.qty}`).join(', ')}` + (cp ? ` · คูปอง ${cp.coupon.code} −${baht(t.discount)}` : '') + ` · ค่าส่ง ${baht(t.shippingFee)} · รวม ${baht(t.total)}`);
    return { id, t };
  });

  const base = appUrl();
  await mailSafe(customer.email, `ยืนยันคำสั่งซื้อ ${id} — กรุณาชำระเงินภายใน ${fmtTime(expiresAt)} น.`,
    [`เรียนคุณ${customer.name}`, '', `ได้รับคำสั่งซื้อ ${id} แล้ว ยอดชำระ ${baht(t.total)}`, ...lines.map(l => `- ${l.name} × ${l.qty} = ${baht(l.price * l.qty)}`),
      t.discount ? `ส่วนลด −${baht(t.discount)}` : '', `ค่าจัดส่ง ${baht(t.shippingFee)}`, '', `ชำระด้วย PromptPay QR ภายใน ${fmtTime(expiresAt)} น. (${paymentConfig.payMinutes()} นาที) หากเลยเวลาคำสั่งซื้อจะถูกยกเลิกอัตโนมัติ`,
      base ? `ชำระเงิน: ${base}/pay/${id}` : ''].join('\n'));
  return id;
}

// ── expiry & cancellation ──

/** Ends an unpaid order and gives its held stock back. False if it was no longer awaiting payment. */
export async function expireOrder(id: string, to: 'expired' | 'cancelled', by: readonly [string, string] = SYSTEM): Promise<boolean> {
  return db.$transaction(async tx => {
    const r = await tx.order.updateMany({ where: { id, status: 'pending_payment' }, data: { status: to } });
    if (r.count !== 1) return false;
    const lines = await tx.orderLine.findMany({ where: { orderId: id } });
    for (const l of lines) if (!(await release(tx, l.sku, l.qty))) throw new Error(`reserved stock missing for ${l.sku}`);
    await tx.payment.updateMany({ where: { orderId: id, status: 'pending' }, data: { status: 'expired' } });
    const o = await tx.order.findUniqueOrThrow({ where: { id }, select: { couponCode: true } });
    if (o.couponCode) await releaseCoupon(tx, o.couponCode); // never paid, so the use goes back
    await log(tx, ...by, to === 'expired' ? 'หมดเวลาชำระเงิน · คืนสต็อกที่จอง' : 'ยกเลิกคำสั่งซื้อ · คืนสต็อกที่จอง', id, lines.map(l => `${l.name} × ${l.qty}`).join(', '));
    return true;
  });
}

/** Expire every unpaid order past its deadline (cron, and before anything that needs free stock). */
export async function expireDue(now = new Date()): Promise<number> {
  const due = await db.order.findMany({ where: { status: 'pending_payment', expiresAt: { lt: now } }, select: { id: true }, orderBy: { expiresAt: 'asc' }, take: 200 });
  let n = 0;
  for (const o of due) if (await expireOrder(o.id, 'expired')) n++;
  return n;
}

// ── webhook ──

type Event = { id: string; type: string; data: { ref: string; amount: string; paid_at?: string } };

function readEvent(body: string): Event | null {
  try {
    const e = JSON.parse(body);
    if (typeof e?.id !== 'string' || !e.id || e.id.length > 100 || typeof e.type !== 'string' || typeof e.data?.ref !== 'string' || typeof e.data?.amount !== 'string') return null;
    return e;
  } catch { return null; }
}

const cents = (v: string | number | Prisma.Decimal) => Math.round(Number(String(v)) * 100);

/** Verify and apply one provider delivery. Returns the HTTP status and a short body for the provider. */
export async function handleWebhook(body: string, signature: string | null): Promise<{ status: number; body: { ok: boolean; result: string } }> {
  if (!verify(signature, body, paymentConfig.webhookSecret())) return { status: 401, body: { ok: false, result: 'bad signature' } };
  const ev = readEvent(body);
  if (!ev) return { status: 400, body: { ok: false, result: 'bad payload' } };

  let paid: { orderId: string } | null = null;
  try {
    const result = await db.$transaction(async tx => {
      const payment = await tx.payment.findUnique({ where: { providerRef: ev.data.ref }, include: { order: { include: { lines: true, customer: true } } } });
      // Recording the event first makes a repeat delivery fail on the unique eventId → ignored below
      await tx.paymentEvent.create({ data: { eventId: ev.id, paymentId: payment?.id ?? null, type: ev.type, raw: JSON.parse(body) } });
      if (!payment) return 'unknown payment';
      const o = payment.order;
      if (ev.type === 'charge.failed' || ev.type === 'charge.expired') {
        await tx.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: ev.type === 'charge.failed' ? 'failed' : 'expired' } });
        return 'noted';
      }
      if (ev.type !== 'charge.successful') return 'ignored type';
      if (cents(ev.data.amount) !== cents(payment.amount)) {
        await log(tx, ...SYSTEM, 'ยอดเงินไม่ตรงกับคำสั่งซื้อ — ไม่ยืนยันการชำระ', o.id, `ได้รับ ${baht(Number(ev.data.amount))} ต้องชำระ ${baht(num(payment.amount))}`);
        return 'amount mismatch';
      }
      const at = ev.data.paid_at ? new Date(ev.data.paid_at) : new Date();
      const paidAt = Number.isNaN(at.getTime()) ? new Date() : at;
      const p = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ['pending', 'expired'] } }, data: { status: 'successful', paidAt } });
      if (p.count !== 1) return 'already applied';
      // Paid in time, and the order still holds its stock → it becomes a sale
      const inTime = paidAt <= o.expiresAt;
      const r = inTime ? await tx.order.updateMany({ where: { id: o.id, status: 'pending_payment' }, data: { status: 'paid', paidAt } }) : { count: 0 };
      if (r.count !== 1) {
        await log(tx, ...SYSTEM, 'ได้รับเงินหลังคำสั่งซื้อหมดเวลา/ยกเลิก — ต้องคืนเงินลูกค้า', o.id, `${baht(num(payment.amount))} · ${payment.providerRef}`);
        return 'late payment';
      }
      for (const l of o.lines) {
        if (!(await sellReserved(tx, l.sku, l.qty))) throw new Error(`reserved stock missing for ${l.sku}`);
        await tx.stockMove.create({ data: { sku: l.sku, type: 'sale', qty: l.qty, ref: o.id, by: `ลูกค้า ${o.customer.name}` } });
      }
      await log(tx, ...SYSTEM, 'ชำระเงินสำเร็จ · ตัดสต็อก', o.id, `${baht(num(payment.amount))} · PromptPay · ${payment.providerRef}`);
      paid = { orderId: o.id };
      return 'paid';
    });
    if (paid) await sendReceipt((paid as { orderId: string }).orderId);
    return { status: 200, body: { ok: true, result } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { status: 200, body: { ok: true, result: 'duplicate event' } };
    throw e;
  }
}

/** Demo mode only: what the provider would send once the customer's transfer clears. */
export function demoEvent(ref: string, amount: number) {
  return JSON.stringify({ id: 'evt_demo_' + randomBytes(12).toString('hex'), type: 'charge.successful', data: { ref, amount: amount.toFixed(2), paid_at: new Date().toISOString() } });
}
export { SIGNATURE_HEADER };

// ── email ──

async function mailSafe(to: string, subject: string, text: string) {
  try {
    const html = `<div style="font-family:sans-serif;white-space:pre-line">${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</div>`;
    await sendMail(to, subject, text, html);
  } catch (e) { console.error('order mail failed', e); } // the order stands even if email is down
}

async function sendReceipt(orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, include: { lines: true, customer: true } });
  if (!o) return;
  await mailSafe(o.customer.email, `ชำระเงินสำเร็จ — ใบเสร็จคำสั่งซื้อ ${o.id}`,
    [`เรียนคุณ${o.customer.name}`, '', `ร้านได้รับชำระเงินคำสั่งซื้อ ${o.id} แล้ว ขอบคุณที่สั่งซื้อกับ COREPICK`, '',
      ...o.lines.map(l => `- ${l.name} × ${l.qty} = ${baht(num(l.price) * l.qty)}`),
      `ยอดสินค้า ${baht(num(o.subtotal))}`, num(o.discount) ? `ส่วนลด −${baht(num(o.discount))}` : '', `ค่าจัดส่ง ${baht(num(o.shippingFee))}`,
      `รวมชำระ ${baht(num(o.total))} (รวม VAT 7%)`, '', `จัดส่งถึง ${o.shipName} ${o.shipPhone}`, o.shipAddress].filter(Boolean).join('\n'));
}
