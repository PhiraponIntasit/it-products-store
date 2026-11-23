import 'server-only';
import { db } from './db';
import { cardInclude, cardOf, type ProductCard } from './storefront';
import { checkBuild, estimateWatts, issuesIfChosen, isSlot, missingSlots, recommendedPsu, SLOTS, type Build, type Issue, type Slot } from '@/lib/compat';
import { specFieldsFor, specText, type Specs } from '@/lib/specs';
import { salesFor, type Sale } from './pricing';

// PC builder (person A). The build lives in the URL (/build?cpu=SKU&mainboard=SKU…), so it works for guests,
// can be shared as a link, and survives reloads. Customers can also save it as a PcBuild.

export type Selection = Partial<Record<Slot, string>>;
export type BuildPart = ProductCard & { specs: Specs; specLine: string };

const MAX_SKU = 40;

/** Slot → SKU from the query string; anything else is ignored. */
export function readSelection(sp: Record<string, string | string[] | undefined>): Selection {
  const sel: Selection = {};
  for (const { key } of SLOTS) {
    const v = sp[key];
    const sku = (Array.isArray(v) ? v[0] : v ?? '').trim().toUpperCase().slice(0, MAX_SKU);
    if (sku) sel[key] = sku;
  }
  return sel;
}

/** /build URL for a selection, optionally opening the picker for one slot. */
export function buildHref(sel: Selection, pick?: Slot) {
  const q = new URLSearchParams();
  for (const { key } of SLOTS) if (sel[key]) q.set(key, sel[key]!);
  if (pick) q.set('pick', pick);
  const s = q.toString();
  return `/build${s ? `?${s}` : ''}${pick ? '#pick' : ''}`;
}

/** Two or three key specs on one line, e.g. "AM5 · DDR5 · ATX". */
function specLine(slug: string, specs: Specs) {
  return specFieldsFor(slug).filter(f => specs[f.key] != null && specs[f.key] !== '').slice(0, 4)
    // a bare number means nothing on its own ("10"), so unit-less numbers carry their label ("จำนวนคอร์ 10")
    .map(f => f.type === 'number' && !f.unit ? `${f.label} ${specs[f.key]}` : specText(f, specs[f.key])).join(' · ');
}

function partOf(row: Parameters<typeof cardOf>[0]): BuildPart {
  const specs = (row.specs ?? {}) as Specs;
  return { ...cardOf(row), specs, specLine: specLine(row.category?.slug ?? '', specs) };
}

/** A part with a running flash-sale price applied (see pricing.ts). */
function onSale(p: BuildPart, sales: Map<string, Sale>): BuildPart {
  const s = sales.get(p.sku);
  return s ? { ...p, price: s.price, compareAt: Math.max(p.compareAt ?? 0, s.was) } : p;
}

/** Loads the selected parts. A SKU that is unknown, hidden, or from another category is dropped. */
export async function loadBuild(sel: Selection) {
  const skus = Object.values(sel).filter(Boolean) as string[];
  const rows = skus.length ? await db.inventoryItem.findMany({ where: { sku: { in: skus }, active: true }, include: cardInclude }) : [];
  const parts: Partial<Record<Slot, BuildPart>> = {};
  const sales = await salesFor(rows.map(r => r.sku));
  for (const { key } of SLOTS) {
    const r = rows.find(x => x.sku === sel[key] && x.category?.slug === key);
    if (r) parts[key] = onSale(partOf(r), sales);
  }
  const build: Build = Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, { sku: p!.sku, name: p!.name, specs: p!.specs }]));
  const issues = checkBuild(build);
  const chosen = Object.values(parts) as BuildPart[];
  return {
    parts, build, issues,
    selection: Object.fromEntries(chosen.map(p => [p.categorySlug, p.sku])) as Selection,
    total: chosen.reduce((a, p) => a + p.price, 0),
    watts: estimateWatts(build), recommendedPsu: recommendedPsu(build),
    missing: missingSlots(build),
    outOfStock: chosen.filter(p => p.available < 1).map(p => p.name),
    hasErrors: issues.some(i => i.level === 'error'),
    count: chosen.length,
  };
}
export type LoadedBuild = Awaited<ReturnType<typeof loadBuild>>;

export type Candidate = BuildPart & { issues: Issue[] };

/** Every active product for `slot`: compatible and in stock first, then by price. */
export async function candidates(slot: Slot, build: Build): Promise<Candidate[]> {
  const rows = await db.inventoryItem.findMany({ where: { active: true, category: { slug: slot } }, include: cardInclude, orderBy: [{ price: 'asc' }, { sku: 'asc' }] });
  const rank = (c: Candidate) => (c.issues.length ? 2 : 0) + (c.available < 1 ? 1 : 0);
  const sales = await salesFor(rows.map(r => r.sku));
  return rows.map(r => {
    const p = onSale(partOf(r), sales);
    return { ...p, issues: issuesIfChosen(build, slot, { sku: p.sku, name: p.name, specs: p.specs }) };
  }).sort((a, z) => rank(a) - rank(z) || a.price - z.price);
}

export const isPickSlot = (s: string | undefined): s is Slot => isSlot(s);

/** A customer's saved builds with today's prices (prices change; the saved build keeps only the parts). */
export async function myBuilds(customerId: string) {
  const rows = await db.pcBuild.findMany({
    where: { customerId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    include: { items: { include: { item: { select: { name: true, price: true, active: true } } } } },
  });
  const sales = await salesFor(rows.flatMap(b => b.items.map(i => i.sku)));
  return rows.map(b => {
    const sel = Object.fromEntries(b.items.map(i => [i.slot, i.sku])) as Selection;
    const items = SLOTS.map(s => b.items.find(i => i.slot === s.key)).filter(i => !!i);
    return {
      id: b.id, name: b.name, createdAt: b.createdAt, href: buildHref(sel),
      parts: items.map(i => ({ slot: i.slot as Slot, name: i.item.name, gone: !i.item.active })),
      total: items.filter(i => i.item.active).reduce((a, i) => a + (sales.get(i.sku)?.price ?? Number(i.item.price)) * i.qty, 0),
    };
  });
}
