import 'server-only';
import type { Prisma } from '@prisma/client';
import { db, num } from './db';
import { available } from './stock-reserve';
import { imageUrl } from './products';
import { withSales } from './pricing';
import { livePromotions } from './promotions';
import { ruleOf } from './coupons';
import { describe } from '@/lib/coupon';
import { pageOf } from '@/lib/paging';
import { specFieldsFor, specText, type Specs } from '@/lib/specs';

// Storefront catalogue: only products marked `active` are ever shown. Prices come from the database
// (VAT included, with a running flash sale applied by withSales) and "in stock" is qty − reserved, the same number checkout uses.

export const SHOP_PAGE_SIZE = 24;
export const SORTS = { new: 'มาใหม่', 'price-asc': 'ราคาต่ำ → สูง', 'price-desc': 'ราคาสูง → ต่ำ' } as const;
export type SortKey = keyof typeof SORTS;
export type ShopFilter = { q: string; cat: string; brand: string; sort: SortKey; inStock: boolean };

const clean = (s: string | undefined, max = 60) => (s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export function readShopFilter(sp: { q?: string; cat?: string; brand?: string; sort?: string; stock?: string }): ShopFilter {
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : 'new') as SortKey;
  return { q: clean(sp.q), cat: clean(sp.cat, 40), brand: clean(sp.brand, 40), sort, inStock: sp.stock === '1' };
}

export const cardInclude = { brand: true, category: true, images: { orderBy: { ord: 'asc' }, take: 1 } } satisfies Prisma.InventoryItemInclude;
type CardRow = Prisma.InventoryItemGetPayload<{ include: typeof cardInclude }>;

export function cardOf(i: CardRow) {
  return {
    sku: i.sku, slug: i.slug ?? i.sku.toLowerCase(), name: i.name,
    brand: i.brand?.name ?? '', category: i.category?.name ?? i.cat, categorySlug: i.category?.slug ?? '',
    price: num(i.price), compareAt: i.compareAt == null ? null : num(i.compareAt),
    available: Math.max(0, available(i)), image: i.images[0] ? imageUrl(i.images[0].id) : null,
  };
}
export type ProductCard = ReturnType<typeof cardOf>;

function searchWhere(q: string): Prisma.InventoryItemWhereInput {
  if (!q) return {};
  const words = q.split(' ').filter(Boolean).slice(0, 5);
  // every word must match the name, SKU or brand ("ryzen 7600" finds "AMD Ryzen 5 7600")
  return { AND: words.map(w => ({ OR: [
    { name: { contains: w, mode: 'insensitive' } }, { sku: { contains: w, mode: 'insensitive' } },
    { brand: { name: { contains: w, mode: 'insensitive' } } },
  ] })) };
}

const ORDER: Record<SortKey, Prisma.InventoryItemOrderByWithRelationInput[]> = {
  new: [{ createdAt: 'desc' }, { sku: 'asc' }], 'price-asc': [{ price: 'asc' }, { sku: 'asc' }], 'price-desc': [{ price: 'desc' }, { sku: 'asc' }],
};

export async function listProducts(f: ShopFilter, rawPage: string | undefined) {
  const base: Prisma.InventoryItemWhereInput = { active: true, ...searchWhere(f.q) };
  const byCat: Prisma.InventoryItemWhereInput = f.cat ? { category: { slug: f.cat } } : {};
  const byBrand: Prisma.InventoryItemWhereInput = f.brand ? { brand: { slug: f.brand } } : {};
  // "in stock" compares two columns, which Prisma can't express in a where — filter the matching SKUs first
  let stockSkus: string[] | null = null;
  if (f.inStock) {
    const rows = await db.inventoryItem.findMany({ where: { AND: [base, byCat, byBrand] }, select: { sku: true, qty: true, reserved: true } });
    stockSkus = rows.filter(r => available(r) > 0).map(r => r.sku);
  }
  const where: Prisma.InventoryItemWhereInput = { AND: [base, byCat, byBrand, stockSkus ? { sku: { in: stockSkus } } : {}] };
  const [total, cats, brands] = await Promise.all([
    db.inventoryItem.count({ where }),
    db.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { slug: true, name: true, _count: { select: { items: { where: { AND: [base, byBrand] } } } } } }),
    db.brand.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true, _count: { select: { items: { where: { AND: [base, byCat] } } } } } }),
  ]);
  const page = pageOf(rawPage, total, SHOP_PAGE_SIZE);
  let cards;
  if (f.sort === 'new') {
    const rows = await db.inventoryItem.findMany({ where, include: cardInclude, orderBy: ORDER.new, skip: page.skip, take: page.size });
    cards = await withSales(rows.map(cardOf));
  } else {
    // Sort by the price the customer sees (a flash sale lowers it), so the matching set is priced first, then paged.
    const all = await withSales((await db.inventoryItem.findMany({ where, include: cardInclude, orderBy: ORDER[f.sort] })).map(cardOf));
    const dir = f.sort === 'price-asc' ? 1 : -1;
    cards = all.sort((a, b) => dir * (a.price - b.price) || a.sku.localeCompare(b.sku)).slice(page.skip, page.skip + page.size);
  }
  return {
    rows: cards, page,
    categories: cats.filter(c => c._count.items > 0 || c.slug === f.cat).map(c => ({ slug: c.slug, name: c.name, count: c._count.items })),
    brands: brands.filter(b => b._count.items > 0 || b.slug === f.brand).map(b => ({ slug: b.slug, name: b.name, count: b._count.items })),
  };
}

/** Home page: running promotions (banners, flash sale), coupons shown on the shop, best sellers, a row per main
 *  category, brands and new arrivals. Every price goes through withSales, so a flash sale shows everywhere at once. */
export async function homeData() {
  const now = new Date();
  const [cats, newest, deals, live, coupons, top, brands] = await Promise.all([
    db.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { slug: true, name: true, _count: { select: { items: { where: { active: true } } } } } }),
    db.inventoryItem.findMany({ where: { active: true }, include: cardInclude, orderBy: ORDER.new, take: 8 }),
    db.inventoryItem.findMany({ where: { active: true, compareAt: { not: null } }, include: cardInclude, orderBy: { price: 'desc' }, take: 8 }),
    livePromotions(now),
    db.coupon.findMany({ where: { showOnShop: true, active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { code: 'asc' } }),
    db.orderLine.groupBy({ by: ['sku'], where: { order: { status: { in: ['paid', 'packing', 'shipped', 'completed'] }, paidAt: { gte: new Date(now.getTime() - 30 * 864e5) } } }, _sum: { qty: true }, orderBy: { _sum: { qty: 'desc' } }, take: 12 }),
    db.brand.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true, logo: true, _count: { select: { items: { where: { active: true } } } } } }),
  ]);
  const ROW_CATS = ['vga', 'cpu', 'mainboard', 'monitor'];
  const [flashRows, bestRows, rowItems] = await Promise.all([
    live.flash ? db.inventoryItem.findMany({ where: { active: true, sku: { in: live.flash.skus } }, include: cardInclude }) : [],
    db.inventoryItem.findMany({ where: { active: true, sku: { in: top.map(t => t.sku) } }, include: cardInclude }),
    Promise.all(ROW_CATS.map(slug => db.inventoryItem.findMany({ where: { active: true, category: { slug } }, include: cardInclude, orderBy: [{ price: 'asc' }, { sku: 'asc' }], take: 4 }))),
  ]);
  const order = new Map(top.map((t, k) => [t.sku, k]));
  const flash = live.flash ? (await withSales(flashRows.map(cardOf), now)).filter(c => c.saleEndsAt) : [];
  return {
    categories: cats.filter(c => c._count.items > 0).map(c => ({ slug: c.slug, name: c.name, count: c._count.items })),
    banners: live.banners,
    flash: live.flash && flash.length ? { title: live.flash.title, subtitle: live.flash.subtitle, endsAt: live.flash.endsAt, items: flash.sort((x, y) => (y.compareAt ?? 0) - y.price - ((x.compareAt ?? 0) - x.price)) } : null,
    coupons: coupons.filter(c => c.usageLimit == null || c.used < c.usageLimit).map(c => ({ code: c.code, text: describe(ruleOf(c)), oncePerCustomer: c.oncePerCustomer, endsAt: c.endsAt.toISOString() })),
    best: (await withSales(bestRows.map(cardOf), now)).sort((x, y) => order.get(x.sku)! - order.get(y.sku)!).slice(0, 8),
    rows: (await Promise.all(rowItems.map(r => withSales(r.map(cardOf), now)))).map((items, k) => ({ slug: ROW_CATS[k], name: cats.find(c => c.slug === ROW_CATS[k])?.name ?? ROW_CATS[k], items })).filter(r => r.items.length),
    brands: brands.filter(b => b._count.items > 0 && b.slug !== 'generic').map(b => ({ slug: b.slug, name: b.name, logo: b.logo ? `/api/brands/${b.slug}/logo?v=${b.logo.slice(0, 8)}` : null })),
    newest: await withSales(newest.map(cardOf), now),
    deals: (await withSales(deals.map(cardOf), now)).filter(d => !d.saleEndsAt && d.compareAt != null && d.compareAt > d.price).slice(0, 4),
  };
}

export async function productBySlug(slug: string) {
  const i = await db.inventoryItem.findFirst({
    where: { active: true, slug: slug.toLowerCase() },
    include: { brand: true, category: true, images: { orderBy: { ord: 'asc' } } },
  });
  if (!i) return null;
  const specs = (i.specs ?? {}) as Specs;
  const related = i.categoryId
    ? await db.inventoryItem.findMany({ where: { active: true, categoryId: i.categoryId, NOT: { sku: i.sku } }, include: cardInclude, orderBy: ORDER.new, take: 4 })
    : [];
  const [sale] = await withSales([{ sku: i.sku, price: num(i.price), compareAt: i.compareAt == null ? null : num(i.compareAt) }]);
  return {
    sku: i.sku, slug: i.slug ?? '', name: i.name, unit: i.unit, description: i.description,
    brand: i.brand ? { slug: i.brand.slug, name: i.brand.name } : null,
    category: i.category ? { slug: i.category.slug, name: i.category.name } : null,
    price: sale.price, compareAt: sale.compareAt ?? null, saleEndsAt: sale.saleEndsAt,
    available: Math.max(0, available(i)), warrantyMonths: i.warrantyMonths, serialTracked: i.serialTracked,
    images: i.images.map(im => ({ id: im.id, src: imageUrl(im.id) })),
    specs: specFieldsFor(i.category?.slug).filter(fl => specs[fl.key] != null && specs[fl.key] !== '').map(fl => ({ label: fl.label, value: specText(fl, specs[fl.key]) })),
    related: await withSales(related.map(cardOf)),
  };
}
export type ProductPage = NonNullable<Awaited<ReturnType<typeof productBySlug>>>;
