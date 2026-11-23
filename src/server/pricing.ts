import 'server-only';
import { db, num } from './db';

// The price a customer pays right now (B). A running flash promotion lowers a product's price for its period;
// the storefront, cart, PC builder and checkout all read prices through here, so what is shown is what is charged.
// The order line keeps the price at the moment of ordering (a sale that ends during the 15-minute payment window
// doesn't change an order already placed).

export type Sale = { price: number; was: number; endsAt: Date; promotionId: string; title: string };

/** Lowest running flash-sale price per SKU (only when below the regular price). */
export async function salesFor(skus: string[], at = new Date()): Promise<Map<string, Sale>> {
  const out = new Map<string, Sale>();
  if (!skus.length) return out;
  const rows = await db.promotionItem.findMany({
    where: { sku: { in: [...new Set(skus)] }, promotion: { kind: 'flash', active: true, startsAt: { lte: at }, endsAt: { gt: at } } },
    include: { promotion: { select: { id: true, title: true, endsAt: true } }, item: { select: { price: true } } },
  });
  for (const r of rows) {
    const price = num(r.salePrice), was = num(r.item.price);
    if (!(price < was)) continue;
    const cur = out.get(r.sku);
    if (!cur || price < cur.price) out.set(r.sku, { price, was, endsAt: r.promotion.endsAt, promotionId: r.promotion.id, title: r.promotion.title });
  }
  return out;
}

/** Overlay running sale prices on rows that carry `price` / `compareAt`: the sale price becomes the price and the
 *  regular (or higher list) price is shown struck through. `saleEndsAt` (ISO) drives the countdown. */
export async function withSales<T extends { sku: string; price: number; compareAt?: number | null }>(rows: T[], at = new Date()) {
  const sales = await salesFor(rows.map(r => r.sku), at);
  return rows.map(r => {
    const s = sales.get(r.sku);
    if (!s) return { ...r, saleEndsAt: null as string | null };
    return { ...r, price: s.price, compareAt: Math.max(r.compareAt ?? 0, s.was), saleEndsAt: s.endsAt.toISOString() };
  });
}
