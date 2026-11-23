import 'server-only';
import type { Prisma } from '@prisma/client';
import { db, num } from './db';
import { pageOf } from '@/lib/paging';
import type { Specs } from '@/lib/specs';

export const PRODUCTS_PER_PAGE = 20;
export const STATUS_FILTERS = { all: 'ทั้งหมด', active: 'ขายอยู่', hidden: 'ยังไม่ขึ้นหน้าร้าน' } as const;
export type StatusFilter = keyof typeof STATUS_FILTERS;

export type ProductFilter = { q: string; cat: string; brand: string; status: StatusFilter };

export function readFilter(sp: { q?: string; cat?: string; brand?: string; status?: string }): ProductFilter {
  const status = (sp.status && sp.status in STATUS_FILTERS ? sp.status : 'all') as StatusFilter;
  return { q: (sp.q ?? '').trim().slice(0, 100), cat: sp.cat ?? '', brand: sp.brand ?? '', status };
}

function whereOf(f: ProductFilter): Prisma.InventoryItemWhereInput {
  const where: Prisma.InventoryItemWhereInput = {};
  if (f.q) where.OR = [{ sku: { contains: f.q, mode: 'insensitive' } }, { name: { contains: f.q, mode: 'insensitive' } }];
  if (f.cat) where.categoryId = f.cat === 'none' ? null : f.cat;
  if (f.brand) where.brandId = f.brand;
  if (f.status !== 'all') where.active = f.status === 'active';
  return where;
}

/** One page of the product table plus the counts the status chips show. */
export async function productPage(f: ProductFilter, rawPage: string | undefined) {
  const where = whereOf(f);
  const [total, byStatus] = await Promise.all([
    db.inventoryItem.count({ where }),
    db.inventoryItem.groupBy({ by: ['active'], where: whereOf({ ...f, status: 'all' }), _count: true }),
  ]);
  const page = pageOf(rawPage, total, PRODUCTS_PER_PAGE);
  const items = await db.inventoryItem.findMany({
    where, orderBy: [{ createdAt: 'desc' }, { sku: 'asc' }], skip: page.skip, take: page.size,
    include: { category: true, brand: true, images: { orderBy: { ord: 'asc' }, take: 1 } },
  });
  const n = new Map(byStatus.map(r => [r.active, r._count]));
  return {
    page,
    counts: { all: (n.get(true) ?? 0) + (n.get(false) ?? 0), active: n.get(true) ?? 0, hidden: n.get(false) ?? 0 },
    rows: items.map(i => ({
      sku: i.sku, name: i.name, active: i.active,
      category: i.category?.name ?? '—', brand: i.brand?.name ?? '—',
      price: num(i.price), cost: num(i.cost), qty: i.qty, reserved: i.reserved, min: i.min, unit: i.unit,
      thumb: i.images[0] ? imageUrl(i.images[0].id) : null,
    })),
  };
}
export type ProductRow = Awaited<ReturnType<typeof productPage>>['rows'][number];

export async function catalogOptions() {
  const [categories, brands] = await Promise.all([
    db.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], include: { _count: { select: { items: true } } } }),
    db.brand.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } }),
  ]);
  return {
    categories: categories.map(c => ({ id: c.id, slug: c.slug, name: c.name, count: c._count.items, logo: null as string | null })),
    brands: brands.map(b => ({ id: b.id, slug: b.slug, name: b.name, count: b._count.items, logo: b.logo ? `/api/brands/${b.slug}/logo?v=${b.logo.slice(0, 8)}` : null })),
  };
}
export type CatalogOptions = Awaited<ReturnType<typeof catalogOptions>>;

export async function productDetail(sku: string) {
  const i = await db.inventoryItem.findUnique({ where: { sku }, include: { category: true, images: { orderBy: { ord: 'asc' } } } });
  if (!i) return null;
  return {
    sku: i.sku, name: i.name, slug: i.slug ?? '', unit: i.unit, loc: i.loc, min: i.min, qty: i.qty, reserved: i.reserved,
    categoryId: i.categoryId ?? '', categorySlug: i.category?.slug ?? '', brandId: i.brandId ?? '',
    price: num(i.price), cost: num(i.cost), compareAt: i.compareAt == null ? null : num(i.compareAt),
    warrantyMonths: i.warrantyMonths, description: i.description, active: i.active, serialTracked: i.serialTracked,
    specs: (i.specs ?? {}) as Specs,
    images: i.images.map(im => ({ id: im.id, src: imageUrl(im.id) })),
  };
}
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof productDetail>>>;

export const imageUrl = (id: string) => `/api/products/images/${id}`;
