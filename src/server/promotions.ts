import 'server-only';
import type { User } from '@prisma/client';
import { db, num } from './db';
import { Fail, str } from './act';
import { audit } from './auth';
import { zonedTime, dayKey, DISPLAY_TZ, bahtS } from '@/lib/domain';

// Storefront promotions (B): flash sales (time-limited sale prices, applied everywhere through pricing.ts) and
// home-page banners. Kept apart from coupons, which customers type at checkout.

type Staff = Pick<User, 'id' | 'name' | 'role'>;
export const TONES = [['cobalt', 'น้ำเงิน'], ['slate', 'เทาเข้ม'], ['teal', 'เขียวน้ำทะเล'], ['violet', 'ม่วง']] as const;
const TONE_KEYS: string[] = TONES.map(t => t[0]);
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;          // <input type="datetime-local">
const MAX_ITEMS = 50;

const at = (raw: string, what: string) => {
  const m = LOCAL.exec(str(raw));
  if (!m) throw new Fail(`กรุณาระบุ${what}`);
  return zonedTime(m[1], `${m[2]}:00`);
};
/** Date → the value a datetime-local input shows, in the shop's time zone. */
export const localInput = (d: Date) => `${dayKey(d)}T${d.toLocaleTimeString('en-GB', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit' })}`;

/** Only links inside the shop: a path, never another site. */
function safeLink(raw: string) {
  const s = str(raw).slice(0, 200);
  if (!s) return '';
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) throw new Fail('ลิงก์ต้องเป็นหน้าในร้าน เช่น /shop?cat=gpu หรือ /p/amd-ryzen-5-7600');
  return s;
}

export async function savePromotion(me: Staff, id: string | null, f: Record<string, string>, itemsIn: Record<string, string>) {
  const kind = f.kind === 'flash' ? 'flash' : f.kind === 'banner' ? 'banner' : '';
  if (!kind) throw new Fail('เลือกชนิดโปรโมชั่น');
  const title = str(f.title).slice(0, 80), subtitle = str(f.subtitle).slice(0, 160);
  if (title.length < 3) throw new Fail('กรุณาตั้งชื่อโปรโมชั่น (อย่างน้อย 3 ตัวอักษร)');
  const startsAt = at(f.startsAt, 'วันเวลาเริ่ม'), endsAt = at(f.endsAt, 'วันเวลาสิ้นสุด');
  if (endsAt <= startsAt) throw new Fail('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  const tone = TONE_KEYS.includes(f.tone) ? f.tone : 'cobalt';
  const sort = Math.max(0, Math.min(99, parseInt(f.sort || '0', 10) || 0));
  const link = safeLink(f.link);

  const want = Object.entries(itemsIn).map(([sku, p]) => [sku.toUpperCase(), Number(str(p))] as const).filter(([sku]) => sku);
  if (kind === 'flash' && !want.length) throw new Fail('เพิ่มสินค้าอย่างน้อย 1 รายการพร้อมราคาลด');
  if (want.length > MAX_ITEMS) throw new Fail(`ใส่สินค้าได้ไม่เกิน ${MAX_ITEMS} รายการ`);
  const products = await db.inventoryItem.findMany({ where: { sku: { in: want.map(w => w[0]) } }, select: { sku: true, name: true, price: true } });
  const items = kind === 'flash' ? want.map(([sku, sale]) => {
    const p = products.find(x => x.sku === sku);
    if (!p) throw new Fail(`ไม่พบสินค้า ${sku}`);
    if (!Number.isFinite(sale) || sale <= 0) throw new Fail(`ราคาลดของ ${p.name} ต้องมากกว่า 0`);
    if (sale >= num(p.price)) throw new Fail(`ราคาลดของ ${p.name} ต้องต่ำกว่าราคาปกติ (${bahtS(num(p.price))})`);
    return { sku, salePrice: Math.round(sale * 100) / 100 };
  }) : [];

  const data = { kind, title, subtitle, link, tone, startsAt, endsAt, sort };
  const detail = `${kind === 'flash' ? `Flash sale ${items.length} รายการ` : 'แบนเนอร์'} · ${localInput(startsAt).replace('T', ' ')} ถึง ${localInput(endsAt).replace('T', ' ')}`;
  return db.$transaction(async tx => {
    let pid = id;
    if (id) {
      const r = await tx.promotion.updateMany({ where: { id }, data });
      if (r.count !== 1) throw new Fail('ไม่พบโปรโมชั่น');
      await tx.promotionItem.deleteMany({ where: { promotionId: id } });
    } else {
      pid = (await tx.promotion.create({ data })).id;
    }
    if (items.length) await tx.promotionItem.createMany({ data: items.map(i => ({ promotionId: pid!, ...i })) });
    await audit(tx, me, 'coupon', id ? 'แก้ไขโปรโมชั่น' : 'สร้างโปรโมชั่น', title, detail);
    return pid!;
  });
}

export async function setPromotionActive(me: Staff, id: string, active: boolean) {
  const p = await db.promotion.findUnique({ where: { id } });
  if (!p) throw new Fail('ไม่พบโปรโมชั่น');
  await db.$transaction(async tx => {
    await tx.promotion.update({ where: { id }, data: { active } });
    await audit(tx, me, 'coupon', active ? 'เปิดโปรโมชั่น' : 'ปิดโปรโมชั่น', p.title);
  });
  return p.title;
}

export const promoStatus = (p: { active: boolean; startsAt: Date; endsAt: Date }, now = new Date()): [string, string] =>
  !p.active ? ['ปิดอยู่', 'tag-outline'] : now < p.startsAt ? ['ยังไม่เริ่ม', 'tag-neutral'] : now >= p.endsAt ? ['จบแล้ว', 'tag-neutral'] : ['กำลังจัด', 'tag-accent'];

/** Back-office list: every promotion with its products, sale prices, discount and margin at the sale price. */
export async function promotionRows() {
  const rows = await db.promotion.findMany({
    orderBy: [{ endsAt: 'desc' }, { sort: 'asc' }],
    include: { items: { include: { item: { select: { name: true, price: true, cost: true } } }, orderBy: { sku: 'asc' } } },
  });
  const now = new Date();
  return rows.map(p => {
    const [statusLabel, statusTag] = promoStatus(p, now);
    return {
      id: p.id, kind: p.kind, title: p.title, subtitle: p.subtitle, link: p.link, tone: p.tone, active: p.active, statusLabel, statusTag,
      periodText: `${localInput(p.startsAt).replace('T', ' ')} – ${localInput(p.endsAt).replace('T', ' ')}`,
      items: p.items.map(i => {
        const price = num(i.item.price), sale = num(i.salePrice), cost = num(i.item.cost);
        return { sku: i.sku, name: i.item.name, price, sale, off: Math.round((1 - sale / price) * 100), margin: sale / 1.07 - cost };
      }),
      form: { kind: p.kind, title: p.title, subtitle: p.subtitle, link: p.link, tone: p.tone, sort: String(p.sort), startsAt: localInput(p.startsAt), endsAt: localInput(p.endsAt) },
    };
  });
}
export type PromotionRow = Awaited<ReturnType<typeof promotionRows>>[number];

/** Products for the flash-sale picker. */
export async function promoProducts() {
  const rows = await db.inventoryItem.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { sku: true, name: true, price: true, cost: true } });
  return rows.map(r => ({ sku: r.sku, name: r.name, price: num(r.price), cost: num(r.cost) }));
}

// ── storefront ──

/** Running banners and the running flash sale(s) for the home page. */
export async function livePromotions(now = new Date()) {
  const running = { active: true, startsAt: { lte: now }, endsAt: { gt: now } };
  const [banners, flash] = await Promise.all([
    db.promotion.findMany({ where: { kind: 'banner', ...running }, orderBy: [{ sort: 'asc' }, { endsAt: 'asc' }], take: 6 }),
    db.promotion.findMany({ where: { kind: 'flash', ...running }, orderBy: { endsAt: 'asc' }, include: { items: { select: { sku: true } } } }),
  ]);
  return {
    banners: banners.map(b => ({ id: b.id, title: b.title, subtitle: b.subtitle, link: b.link || '/shop', tone: b.tone })),
    flash: flash.length ? { title: flash[0].title, subtitle: flash[0].subtitle, endsAt: flash[0].endsAt.toISOString(), skus: [...new Set(flash.flatMap(f => f.items.map(i => i.sku)))] } : null,
  };
}
