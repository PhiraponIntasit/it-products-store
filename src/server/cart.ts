import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { db, num } from './db';
import { getCustomer } from './customer-session';
import { available } from './stock-reserve';
import { imageUrl } from './products';
import { FREE_SHIPPING_MIN } from '@/lib/shipping';
import { salesFor } from './pricing';

// One cart per signed-in customer (Cart.customerId), or one per browser for visitors (Cart.guestToken).
// The visitor's cookie holds a random token and the table keeps only its hash, like the session tables.
// On sign-in the visitor's cart is folded into the customer's (mergeGuestCart), and checkout reads that.

export const GUEST_COOKIE = 'cp_cart';
const DAYS = 30;
/** Most of one product a single cart may hold. */
export const MAX_PER_LINE = 20;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function guestToken() {
  const t = (await cookies()).get(GUEST_COOKIE)?.value;
  return t && /^[\w-]{20,64}$/.test(t) ? t : null;
}

/** The cart of whoever is browsing; with `create`, makes one (and the visitor cookie) if there is none. */
export async function currentCart(create = false): Promise<{ id: string } | null> {
  const me = await getCustomer();
  if (me) {
    if (!create) return db.cart.findUnique({ where: { customerId: me.id }, select: { id: true } });
    return db.cart.upsert({ where: { customerId: me.id }, create: { customerId: me.id }, update: {}, select: { id: true } });
  }
  const t = await guestToken();
  if (t) {
    const c = await db.cart.findUnique({ where: { guestToken: sha256(t) }, select: { id: true } });
    if (c || !create) return c;
  }
  if (!create) return null;
  const token = randomBytes(24).toString('base64url');
  const c = await db.cart.create({ data: { guestToken: sha256(token) }, select: { id: true } });
  (await cookies()).set(GUEST_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: DAYS * 86400,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  });
  return c;
}

/** Moves the visitor's cart into the customer's after sign-in: quantities add up, capped by stock. */
export async function mergeGuestCart(customerId: string) {
  const t = await guestToken();
  if (!t) return;
  const guest = await db.cart.findUnique({ where: { guestToken: sha256(t) }, include: { items: { include: { item: true } } } });
  (await cookies()).delete(GUEST_COOKIE);
  if (!guest) return;
  await db.$transaction(async tx => {
    const mine = await tx.cart.upsert({ where: { customerId }, create: { customerId }, update: {}, include: { items: true } });
    const had = new Map(mine.items.map(i => [i.sku, i.qty]));
    for (const g of guest.items) {
      const qty = Math.max(1, Math.min(MAX_PER_LINE, (had.get(g.sku) ?? 0) + g.qty, Math.max(1, available(g.item))));
      await tx.cartItem.upsert({ where: { cartId_sku: { cartId: mine.id, sku: g.sku } }, create: { cartId: mine.id, sku: g.sku, qty }, update: { qty } });
    }
    await tx.cart.delete({ where: { id: guest.id } });
  });
}

/** Lines and totals for the cart page and the header badge. */
export const cartView = cache(async () => {
  const c = await currentCart();
  const items = c ? await db.cartItem.findMany({
    where: { cartId: c.id }, orderBy: { sku: 'asc' },
    include: { item: { include: { images: { orderBy: { ord: 'asc' }, take: 1 }, brand: true } } },
  }) : [];
  const sales = await salesFor(items.map(ci => ci.sku));
  const lines = items.map(ci => {
    const free = Math.max(0, available(ci.item));
    const problem = !ci.item.active ? 'สินค้านี้ไม่ขายแล้ว' : free === 0 ? 'สินค้าหมด' : ci.qty > free ? `เหลือเพียง ${free} ชิ้น` : '';
    return {
      sku: ci.sku, slug: ci.item.slug ?? ci.sku.toLowerCase(), name: ci.item.name, brand: ci.item.brand?.name ?? '',
      price: sales.get(ci.sku)?.price ?? num(ci.item.price), was: sales.get(ci.sku)?.was ?? null, qty: ci.qty, available: free, problem,
      image: ci.item.images[0] ? imageUrl(ci.item.images[0].id) : null,
    };
  });
  const subtotal = Math.round(lines.reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100;
  return {
    lines, subtotal, count: lines.reduce((a, l) => a + l.qty, 0),
    toFreeShipping: Math.max(0, FREE_SHIPPING_MIN - subtotal), ok: lines.length > 0 && lines.every(l => !l.problem),
  };
});
export type CartView = Awaited<ReturnType<typeof cartView>>;
