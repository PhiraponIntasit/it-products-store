'use server';
import { Prisma } from '@prisma/client';
import { db, num } from '../db';
import { audit, requireAction } from '../auth';
import { act, Fail, int, str } from '../act';
import { MAX_IMAGE_BYTES, removeUpload, saveUpload, sniffImage } from '../uploads';
import { parseSpecs, SPEC_FIELDS, specFieldsFor, specText } from '@/lib/specs';
import { baht } from '@/lib/domain';
import { slugify } from '@/lib/slug';
import { dropPhotos, savePhotos } from '../photos';

/** Photos per product (the storefront gallery). */
const MAX_PRODUCT_IMAGES = 8;
const SKU_RE = /^[A-Z0-9._-]{1,32}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const money = (v: unknown, label: string, required = true) => {
  const s = str(v).replace(/,/g, '');
  if (!s) { if (required) throw new Fail(`กรุณากรอก${label}`); return null; }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) throw new Fail(`${label}ต้องเป็นตัวเลข 0 – 9,999,999`);
  return Math.round(n * 100) / 100;
};

/** What a product needs before it can be shown on the storefront. */
function listingProblem(p: { price: number; categoryId: string | null; brandId: string | null; slug: string | null }) {
  if (!(p.price > 0)) return 'ตั้งราคาขายก่อนเปิดขาย';
  if (!p.categoryId) return 'เลือกหมวดสินค้าก่อนเปิดขาย';
  if (!p.brandId) return 'เลือกยี่ห้อก่อนเปิดขาย';
  if (!p.slug) return 'ตั้งชื่อลิงก์ (slug) ก่อนเปิดขาย';
  return null;
}

const LABEL: Record<string, string> = {
  name: 'ชื่อ', slug: 'ลิงก์', unit: 'หน่วย', loc: 'ที่เก็บ', min: 'จุดสั่งซื้อ', price: 'ราคาขาย', cost: 'ราคาทุน', compareAt: 'ราคาก่อนลด',
  warrantyMonths: 'ประกัน (เดือน)', description: 'รายละเอียด', serialTracked: 'เก็บ Serial', category: 'หมวด', brand: 'ยี่ห้อ',
};

/** Create (sku = null) or update a product. Stock quantity is not edited here: it moves only through
 *  receiving, withdrawals and sales so that every change has a StockMove. */
export async function saveProduct(sku: string | null, f: Record<string, string>, rawSpecs: Record<string, string | string[]>) {
  return act(async () => {
    const me = await requireAction('products');
    const name = str(f.name).slice(0, 200);
    if (!name) throw new Fail('กรุณากรอกชื่อสินค้า');
    const categoryId = str(f.categoryId) || null, brandId = str(f.brandId) || null;
    const [category, brand] = await Promise.all([
      categoryId ? db.category.findUnique({ where: { id: categoryId } }) : null,
      brandId ? db.brand.findUnique({ where: { id: brandId } }) : null,
    ]);
    if (categoryId && !category) throw new Fail('ไม่พบหมวดสินค้าที่เลือก');
    if (brandId && !brand) throw new Fail('ไม่พบยี่ห้อที่เลือก');
    const price = money(f.price, 'ราคาขาย')!, cost = money(f.cost, 'ราคาทุน')!, compareAt = money(f.compareAt, 'ราคาก่อนลด', false);
    if (compareAt != null && compareAt <= price) throw new Fail('ราคาก่อนลดต้องสูงกว่าราคาขาย');
    const warrantyMonths = int(f.warrantyMonths);
    if (!(warrantyMonths >= 0 && warrantyMonths <= 120)) throw new Fail('ประกันต้องอยู่ระหว่าง 0 – 120 เดือน');
    const min = int(f.min);
    if (!(min >= 0)) throw new Fail('จุดสั่งซื้อต้องเป็นจำนวนเต็มไม่ติดลบ');
    const slug = str(f.slug).toLowerCase() || slugify(name) || slugify(sku ?? str(f.sku));
    if (!SLUG_RE.test(slug) || slug.length > 80) throw new Fail('ลิงก์ (slug) ใช้ได้เฉพาะ a–z, 0–9 และ - ไม่เกิน 80 ตัว');
    const { specs, error } = parseSpecs(category?.slug, rawSpecs ?? {});
    if (error) throw new Fail(error);
    const data = {
      name, slug, categoryId, brandId, price, cost, compareAt, warrantyMonths, min, specs,
      unit: str(f.unit).slice(0, 20) || 'ชิ้น', loc: str(f.loc).slice(0, 40) || '-',
      description: str(f.description).slice(0, 5000), serialTracked: f.serialTracked === 'true',
      cat: category?.name ?? 'ทั่วไป', // legacy text column the inventory page still shows
    };
    const taken = await db.inventoryItem.findFirst({ where: { slug, NOT: sku ? { sku } : undefined }, select: { sku: true } });
    if (taken) throw new Fail(`ลิงก์ "${slug}" ถูกใช้แล้วโดย ${taken.sku}`);

    if (!sku) {
      const newSku = str(f.sku).toUpperCase();
      if (!SKU_RE.test(newSku)) throw new Fail('SKU ใช้ได้เฉพาะ A–Z, 0–9, . _ - ไม่เกิน 32 ตัว');
      if (await db.inventoryItem.findUnique({ where: { sku: newSku } })) throw new Fail('SKU นี้มีอยู่แล้ว');
      const qty = Math.max(0, int(f.qty) || 0);
      await db.$transaction(async tx => {
        await tx.inventoryItem.create({ data: { ...data, sku: newSku, qty, active: false } });
        if (qty) await tx.stockMove.create({ data: { sku: newSku, type: 'in', qty, ref: 'ยอดตั้งต้น', by: me.name } });
        await audit(tx, me, 'product', 'เพิ่มสินค้าใหม่', newSku, `${name} · ราคาขาย ${baht(price)} · ทุน ${baht(cost)} · ตั้งต้น ${qty}`);
      });
      return `เพิ่ม ${name} แล้ว — ใส่รูปและสเปค แล้วกดเปิดขายเมื่อพร้อม`;
    }

    const cur = await db.inventoryItem.findUnique({ where: { sku }, include: { category: true, brand: true } });
    if (!cur) throw new Fail('ไม่พบสินค้า');
    if (cur.active) { const why = listingProblem({ price, categoryId, brandId, slug }); if (why) throw new Fail(`สินค้านี้ขายอยู่ — ${why}`); }
    const changes: string[] = [];
    const cmp = (k: string, a: unknown, b: unknown, show = (v: unknown) => String(v ?? '—')) => { if (String(a ?? '') !== String(b ?? '')) changes.push(`${LABEL[k]} ${show(a)} → ${show(b)}`); };
    const m = (v: unknown) => (v == null ? '—' : baht(Number(v)));
    cmp('name', cur.name, name); cmp('slug', cur.slug, slug); cmp('unit', cur.unit, data.unit); cmp('loc', cur.loc, data.loc); cmp('min', cur.min, min);
    cmp('price', num(cur.price), price, m); cmp('cost', num(cur.cost), cost, m); cmp('compareAt', cur.compareAt == null ? null : num(cur.compareAt), compareAt, m);
    cmp('warrantyMonths', cur.warrantyMonths, warrantyMonths); cmp('serialTracked', cur.serialTracked, data.serialTracked, v => (v ? 'ใช่' : 'ไม่'));
    cmp('category', cur.category?.name, category?.name); cmp('brand', cur.brand?.name, brand?.name);
    if (cur.description !== data.description) changes.push('แก้รายละเอียดสินค้า');
    const fields = specFieldsFor(category?.slug), before = (cur.specs ?? {}) as Record<string, unknown>;
    for (const sf of fields) if (JSON.stringify(before[sf.key] ?? null) !== JSON.stringify(specs[sf.key] ?? null)) changes.push(`${sf.label} ${specText(sf, before[sf.key])} → ${specText(sf, specs[sf.key])}`);
    if (!changes.length) return 'ไม่มีอะไรเปลี่ยน';
    await db.$transaction(async tx => {
      await tx.inventoryItem.update({ where: { sku }, data });
      await audit(tx, me, 'product', 'แก้ไขสินค้า', sku, changes.join(' · ').slice(0, 2000));
    });
    return 'บันทึกแล้ว';
  });
}

export async function setProductActive(sku: string, active: boolean) {
  return act(async () => {
    const me = await requireAction('products');
    const p = await db.inventoryItem.findUnique({ where: { sku } });
    if (!p) throw new Fail('ไม่พบสินค้า');
    if (active) { const why = listingProblem({ price: num(p.price), categoryId: p.categoryId, brandId: p.brandId, slug: p.slug }); if (why) throw new Fail(why); }
    if (p.active === active) return;
    await db.$transaction(async tx => {
      await tx.inventoryItem.update({ where: { sku }, data: { active } });
      await audit(tx, me, 'product', active ? 'เปิดขายบนหน้าร้าน' : 'ซ่อนจากหน้าร้าน', sku, p.name);
    });
    return active ? `${p.name} ขึ้นหน้าร้านแล้ว` : `ซ่อน ${p.name} จากหน้าร้านแล้ว`;
  });
}

export async function uploadProductImages(sku: string, fd: FormData) {
  return act(async () => {
    const me = await requireAction('products');
    const p = await db.inventoryItem.findUnique({ where: { sku }, include: { images: { orderBy: { ord: 'desc' }, take: 1 } } });
    if (!p) throw new Fail('ไม่พบสินค้า');
    const files = fd.getAll('photos').filter((x): x is File => x instanceof File && x.size > 0);
    if (!files.length) throw new Fail('เลือกรูปอย่างน้อย 1 รูป');
    const have = await db.productImage.count({ where: { sku } });
    if (have + files.length > MAX_PRODUCT_IMAGES) throw new Fail(`สินค้าหนึ่งรายการมีรูปได้สูงสุด ${MAX_PRODUCT_IMAGES} รูป`);
    const saved: string[] = [];
    try {
      for (const f of files) {
        if (f.size > MAX_IMAGE_BYTES) throw new Fail('ไฟล์รูปใหญ่เกิน 5 MB');
        const buf = Buffer.from(await f.arrayBuffer());
        const mime = sniffImage(buf);
        if (!mime) throw new Fail('รองรับเฉพาะไฟล์รูป JPG, PNG, WebP หรือ GIF');
        saved.push(await saveUpload(buf, mime));
      }
      let ord = (p.images[0]?.ord ?? -1) + 1;
      await db.$transaction(async tx => {
        await tx.productImage.createMany({ data: saved.map(file => ({ sku, file, ord: ord++ })) });
        await audit(tx, me, 'product', 'เพิ่มรูปสินค้า', sku, `${p.name} · ${saved.length} รูป`);
      });
    } catch (e) {
      await Promise.all(saved.map(removeUpload));
      throw e;
    }
    return `เพิ่มรูป ${saved.length} รูปแล้ว`;
  });
}

export async function deleteProductImage(id: string) {
  return act(async () => {
    const me = await requireAction('products');
    const img = await db.productImage.findUnique({ where: { id } });
    if (!img) throw new Fail('ไม่พบรูป');
    await db.$transaction(async tx => {
      await tx.productImage.delete({ where: { id } });
      await audit(tx, me, 'product', 'ลบรูปสินค้า', img.sku);
    });
    await removeUpload(img.file);
    return 'ลบรูปแล้ว';
  });
}

/** Moves a photo one place earlier (-1) or later (+1); the first photo is the cover. */
export async function moveProductImage(id: string, dir: -1 | 1) {
  return act(async () => {
    await requireAction('products');
    const img = await db.productImage.findUnique({ where: { id } });
    if (!img) throw new Fail('ไม่พบรูป');
    const all = await db.productImage.findMany({ where: { sku: img.sku }, orderBy: { ord: 'asc' } });
    const i = all.findIndex(x => x.id === id), j = i + dir;
    if (j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    await db.$transaction(all.map((x, k) => db.productImage.update({ where: { id: x.id }, data: { ord: k } })));
  });
}

// ── categories & brands ──

type Kind = 'category' | 'brand';
const KIND_LABEL: Record<Kind, string> = { category: 'หมวด', brand: 'ยี่ห้อ' };

export async function saveCatalogEntry(kind: Kind, id: string | null, rawName: string, rawSlug: string) {
  return act(async () => {
    const me = await requireAction('products');
    const name = str(rawName).slice(0, 60), slug = (str(rawSlug).toLowerCase() || slugify(name));
    if (!name) throw new Fail(`กรุณากรอกชื่อ${KIND_LABEL[kind]}`);
    if (!SLUG_RE.test(slug) || slug.length > 40) throw new Fail('ลิงก์ (slug) ใช้ได้เฉพาะ a–z, 0–9 และ - ไม่เกิน 40 ตัว');
    if (kind === 'category' && id) {
      // Spec fields are keyed by category slug (src/lib/specs.ts), so those slugs stay put
      const cur = await db.category.findUnique({ where: { id } });
      if (cur && cur.slug !== slug && SPEC_FIELDS[cur.slug]) throw new Fail(`หมวดนี้มีช่องสเปคผูกกับ "${cur.slug}" — เปลี่ยนได้เฉพาะชื่อ`);
    }
    try {
      await db.$transaction(async tx => {
        if (kind === 'category') {
          if (id) await tx.category.update({ where: { id }, data: { name, slug } });
          else await tx.category.create({ data: { name, slug, sort: await tx.category.count() } });
        } else if (id) await tx.brand.update({ where: { id }, data: { name, slug } });
        else await tx.brand.create({ data: { name, slug } });
        if (kind === 'category' && id) await tx.inventoryItem.updateMany({ where: { categoryId: id }, data: { cat: name } });
        await audit(tx, me, 'product', id ? `แก้ไข${KIND_LABEL[kind]}` : `เพิ่ม${KIND_LABEL[kind]}`, slug, name);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Fail(`ลิงก์ "${slug}" ถูกใช้แล้ว`);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new Fail(`ไม่พบ${KIND_LABEL[kind]}`);
      throw e;
    }
    return id ? 'บันทึกแล้ว' : `เพิ่ม${KIND_LABEL[kind]} "${name}" แล้ว`;
  });
}

/** Only an empty category or brand can be deleted, so no product loses its place. */
export async function deleteCatalogEntry(kind: Kind, id: string) {
  return act(async () => {
    const me = await requireAction('products');
    const used = await db.inventoryItem.count({ where: kind === 'category' ? { categoryId: id } : { brandId: id } });
    if (used) throw new Fail(`ยังมีสินค้า ${used} รายการใน${KIND_LABEL[kind]}นี้ — ย้ายสินค้าออกก่อน`);
    await db.$transaction(async tx => {
      const row = kind === 'category' ? await tx.category.delete({ where: { id } }) : await tx.brand.delete({ where: { id } });
      await audit(tx, me, 'product', `ลบ${KIND_LABEL[kind]}`, row.slug, row.name);
    }).catch(e => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new Fail(`ไม่พบ${KIND_LABEL[kind]}`);
      throw e;
    });
    return `ลบ${KIND_LABEL[kind]}แล้ว`;
  });
}

/** A brand's logo for the storefront brand strip (one image; an empty form removes it). */
export async function setBrandLogo(id: string, fd: FormData) {
  return act(async () => {
    const me = await requireAction('products');
    const b = await db.brand.findUnique({ where: { id } });
    const [photo] = await savePhotos(fd.getAll('logo'), 1);
    if (!b) { if (photo) await dropPhotos([photo]); throw new Fail('ไม่พบยี่ห้อ'); }
    await db.$transaction(async tx => {
      await tx.brand.update({ where: { id }, data: { logo: photo?.file ?? null } });
      await audit(tx, me, 'product', photo ? 'อัปโหลดโลโก้ยี่ห้อ' : 'ลบโลโก้ยี่ห้อ', b.slug, b.name);
    });
    if (b.logo) await removeUpload(b.logo);
    return photo ? `อัปโหลดโลโก้ ${b.name} แล้ว` : `ลบโลโก้ ${b.name} แล้ว`;
  });
}
