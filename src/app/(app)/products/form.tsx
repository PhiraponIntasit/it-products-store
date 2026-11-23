'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CatalogOptions, ProductDetail } from '@/server/products';
import { deleteProductImage, moveProductImage, saveProduct, setProductActive, uploadProductImages } from '@/server/actions/products';
import { useAction } from '@/components/use-action';
import { Err } from '@/components/dialog';
import { shrink } from '@/components/photo-shrink';
import { specFieldsFor, type SpecField } from '@/lib/specs';
import { slugify } from '@/lib/slug';
import { bahtS } from '@/lib/domain';
import css from './products.module.css';

const MAX_IMAGES = 8;
type Raw = Record<string, string | string[]>;

/** Create (no `product`) or edit form. Stock is shown but changed only on the inventory page. */
export function ProductForm({ product, options }: { product?: ProductDetail; options: CatalogOptions }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [f, setF] = useState<Record<string, string>>((): Record<string, string> => product ? {
    name: product.name, slug: product.slug, categoryId: product.categoryId, brandId: product.brandId, unit: product.unit, loc: product.loc,
    min: String(product.min), cost: String(product.cost), price: String(product.price), compareAt: product.compareAt == null ? '' : String(product.compareAt),
    warrantyMonths: String(product.warrantyMonths), description: product.description, serialTracked: String(product.serialTracked),
  } : { sku: '', name: '', slug: '', categoryId: '', brandId: '', unit: 'ชิ้น', loc: '', min: '2', cost: '', price: '', compareAt: '', warrantyMonths: '12', description: '', serialTracked: 'false', qty: '0' });
  const [specs, setSpecs] = useState<Raw>(() => Object.fromEntries(Object.entries(product?.specs ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v : String(v)])));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const catSlug = options.categories.find(c => c.id === f.categoryId)?.slug;
  const fields = specFieldsFor(catSlug);
  const price = Number(f.price) || 0, cost = Number(f.cost) || 0;
  const margin = price > 0 ? (price - cost) / price * 100 : null;

  const save = () => {
    const sku = product?.sku ?? f.sku.trim().toUpperCase();
    run(() => saveProduct(product?.sku ?? null, f, specs), () => { if (!product) router.push(`/products/${encodeURIComponent(sku)}`); });
  };
  const inp = (k: string, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="field"><label htmlFor={'p-' + k}>{label}</label><input id={'p-' + k} className="input" value={f[k] ?? ''} onChange={set(k)} {...extra} />{hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}</div>
  );

  return (
    <div className={`anim-page ${css.layout}`}>
      <div className="stack-4">
        <section className="card stack-4">
          <h3 className="section-h">ข้อมูลสินค้า</h3>
          <div className="grid2">
            {product ? <div className="field"><label>SKU</label><div className="input tnum" aria-readonly>{product.sku}</div></div>
              : inp('sku', 'SKU', { maxLength: 32, placeholder: 'เช่น CPU-R5-7600', style: { textTransform: 'uppercase' } })}
            {inp('name', 'ชื่อสินค้า', { maxLength: 200, onBlur: () => { if (!f.slug) setF(x => ({ ...x, slug: slugify(x.name) })); } })}
            <div className="field"><label htmlFor="p-cat">หมวด</label>
              <select id="p-cat" className="input" value={f.categoryId} onChange={set('categoryId')}>
                <option value="">— เลือกหมวด —</option>
                {options.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="p-brand">ยี่ห้อ</label>
              <select id="p-brand" className="input" value={f.brandId} onChange={set('brandId')}>
                <option value="">— เลือกยี่ห้อ —</option>
                {options.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            {inp('slug', 'ลิงก์หน้าสินค้า (slug)', { maxLength: 80, placeholder: 'เช่น amd-ryzen-5-7600' }, 'ใช้ใน URL หน้าร้าน: a–z, 0–9 และ -')}
            {inp('unit', 'หน่วย', { maxLength: 20 })}
          </div>
          <div className="field"><label htmlFor="p-desc">รายละเอียด</label>
            <textarea id="p-desc" className="input" rows={4} value={f.description} onChange={set('description')} maxLength={5000} placeholder="จุดเด่น สิ่งที่อยู่ในกล่อง เงื่อนไขประกัน" />
          </div>
        </section>

        <section className="card stack-4">
          <h3 className="section-h">ราคา</h3>
          <div className="grid2">
            {inp('price', 'ราคาขาย (รวม VAT)', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}
            {inp('cost', 'ราคาทุน (ใช้ในใบขอซื้อ)', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}
            {inp('compareAt', 'ราคาก่อนลด (ไม่บังคับ)', { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' }, 'แสดงเป็นราคาขีดฆ่า ต้องสูงกว่าราคาขาย')}
            {inp('warrantyMonths', 'ประกัน (เดือน)', { type: 'number', min: 0, max: 120 })}
          </div>
          <div className="muted tnum" style={{ fontSize: 13 }}>
            {margin == null ? 'ยังไม่ได้ตั้งราคาขาย' : `กำไรต่อชิ้น ${bahtS(price - cost)} (${margin.toFixed(1)}%)`}
            {margin != null && margin < 0 && <span className="err" style={{ display: 'inline', marginLeft: 8 }}>ราคาขายต่ำกว่าทุน</span>}
          </div>
        </section>

        <section className="card stack-4">
          <h3 className="section-h">สเปค</h3>
          {!f.categoryId ? <div className="muted">เลือกหมวดก่อน แล้วช่องสเปคของหมวดนั้นจะขึ้นที่นี่</div>
            : !fields.length ? <div className="muted">หมวดนี้ยังไม่มีช่องสเปค (เพิ่มได้ที่ src/lib/specs.ts)</div>
              : <div className={css.specGrid}>{fields.map(sf => <SpecInput key={sf.key} f={sf} value={specs[sf.key]} onChange={v => setSpecs(s => ({ ...s, [sf.key]: v }))} />)}</div>}
          <div className="muted" style={{ fontSize: 12 }}>หน้าร้านใช้สเปคเหล่านี้กรองสินค้าและตรวจความเข้ากันตอนจัดสเปคคอม</div>
        </section>

        <section className="card stack-4">
          <h3 className="section-h">คลัง</h3>
          <div className="grid2">
            {!product && inp('qty', 'จำนวนตั้งต้น', { type: 'number', min: 0 })}
            {inp('min', 'จุดสั่งซื้อ', { type: 'number', min: 0 })}
            {inp('loc', 'ที่เก็บ', { maxLength: 40 })}
            <div className="field"><label htmlFor="p-serial">เก็บ Serial รายชิ้น</label>
              <select id="p-serial" className="input" value={f.serialTracked} onChange={set('serialTracked')}><option value="false">ไม่</option><option value="true">ใช่ (สแกนตอนรับเข้าและแพ็ก)</option></select>
            </div>
          </div>
        </section>

        {product && <Gallery sku={product.sku} images={product.images} />}

        <Err msg={error} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Link href="/products" className="btn btn-secondary" style={{ textDecoration: 'none' }}>กลับ</Link>
          <button className="btn btn-primary" disabled={pending} onClick={save}>{product ? 'บันทึก' : 'เพิ่มสินค้า'}</button>
        </div>
      </div>

      <aside className={css.side}>
        {product ? <ListingCard product={product} saved={{ price: product.price, categoryId: product.categoryId, brandId: product.brandId, slug: product.slug }} onToggle={a => run(() => setProductActive(product.sku, a))} pending={pending} />
          : <div className="card" style={{ fontSize: 13 }}>สินค้าใหม่จะยังไม่ขึ้นหน้าร้าน — เพิ่มรูปและตรวจข้อมูลก่อน แล้วกด “เปิดขาย”</div>}
        {product && (
          <div className="card">
            <div className="card-kicker" style={{ marginBottom: 8 }}>สต็อก</div>
            <div className={css.stat}><span>คงเหลือ</span><span className="tnum">{product.qty} {product.unit}</span></div>
            <div className={css.stat}><span>จองให้คำสั่งซื้อ</span><span className="tnum">{product.reserved}</span></div>
            <div className={css.stat}><span>พร้อมขาย</span><span className="tnum">{product.qty - product.reserved}</span></div>
            <Link href="/inventory" className="btn btn-ghost" style={{ textDecoration: 'none', marginTop: 8 }}>ไปหน้าคลังสินค้า →</Link>
          </div>
        )}
      </aside>
    </div>
  );
}

function SpecInput({ f, value, onChange }: { f: SpecField; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const id = 'spec-' + f.key;
  const label = <label htmlFor={id}>{f.label}{'unit' in f && f.unit ? ` (${f.unit})` : ''}</label>;
  if (f.type === 'multi') {
    const list = Array.isArray(value) ? value : [];
    return (
      <div className="field"><label>{f.label}</label>
        <div className={css.multi} role="group" aria-label={f.label}>
          {f.options.map(o => <button key={o} type="button" className={`chip sm${list.includes(o) ? ' on' : ''}`} aria-pressed={list.includes(o)} onClick={() => onChange(list.includes(o) ? list.filter(x => x !== o) : [...list, o])}>{o}</button>)}
        </div>
      </div>
    );
  }
  const v = Array.isArray(value) ? value[0] ?? '' : value ?? '';
  if (f.type === 'select') return (
    <div className="field">{label}
      <select id={id} className="input" value={v} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
  return <div className="field">{label}<input id={id} className="input" value={v} onChange={e => onChange(e.target.value)} type={f.type === 'number' ? 'number' : 'text'} min={0} /></div>;
}

function ListingCard({ product, saved, onToggle, pending }: { product: ProductDetail; saved: { price: number; categoryId: string; brandId: string; slug: string }; onToggle: (active: boolean) => void; pending: boolean }) {
  const checks: [boolean, string][] = [
    [saved.price > 0, 'ตั้งราคาขายแล้ว'], [!!saved.categoryId, 'เลือกหมวดแล้ว'], [!!saved.brandId, 'เลือกยี่ห้อแล้ว'], [!!saved.slug, 'มีลิงก์หน้าสินค้า'],
  ];
  const ready = checks.every(c => c[0]);
  return (
    <div className="card stack-4">
      <div>
        <div className="card-kicker">หน้าร้าน</div>
        <div style={{ fontSize: 20, marginTop: 4 }}>{product.active ? 'ขายอยู่' : 'ซ่อนอยู่'}</div>
      </div>
      <div className="col" style={{ gap: 4 }}>
        {checks.map(([ok, label]) => <div key={label} className={css.check}><span className={ok ? css.ok : css.miss}>{ok ? '✓' : '○'}</span>{label}</div>)}
        <div className={css.check}><span className={product.images.length ? css.ok : css.miss}>{product.images.length ? '✓' : '○'}</span>มีรูปสินค้า (แนะนำ)</div>
      </div>
      {product.active && saved.slug && <a className="btn btn-secondary" href={`/p/${saved.slug}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>ดูหน้าสินค้าบนหน้าร้าน ↗</a>}
      {product.active
        ? <button className="btn btn-secondary" disabled={pending} onClick={() => onToggle(false)}>ซ่อนจากหน้าร้าน</button>
        : <button className="btn btn-primary" disabled={pending || !ready} onClick={() => onToggle(true)}>เปิดขาย</button>}
      {!ready && !product.active && <div className="muted" style={{ fontSize: 12 }}>บันทึกข้อมูลที่ยังขาดก่อน แล้วจึงเปิดขายได้</div>}
    </div>
  );
}

function Gallery({ sku, images }: { sku: string; images: ProductDetail['images'] }) {
  const { run, pending, error } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: File[]) => {
    const shrunk = (await Promise.all(files.slice(0, MAX_IMAGES - images.length).map(shrink))).filter(x => !!x);
    if (!shrunk.length) return;
    const fd = new FormData();
    shrunk.forEach((img, i) => fd.append('photos', img!.blob, `photo-${i}.jpg`));
    run(() => uploadProductImages(sku, fd));
  };
  return (
    <section className="card stack-4">
      <h3 className="section-h">รูปสินค้า <span className="muted tnum" style={{ fontSize: 13 }}>({images.length}/{MAX_IMAGES})</span></h3>
      <div className={css.gallery}>
        {images.map((im, i) => (
          <div key={im.id} className={css.tile}>
            <img src={im.src} alt={`รูปที่ ${i + 1}`} />
            {i === 0 && <span className={css.cover}>รูปหน้าปก</span>}
            <div className={css.tileBar}>
              <button disabled={pending || i === 0} onClick={() => run(() => moveProductImage(im.id, -1))} aria-label={`เลื่อนรูปที่ ${i + 1} ไปก่อน`}>←</button>
              <button disabled={pending} onClick={() => run(() => deleteProductImage(im.id))} aria-label={`ลบรูปที่ ${i + 1}`}>✕</button>
              <button disabled={pending || i === images.length - 1} onClick={() => run(() => moveProductImage(im.id, 1))} aria-label={`เลื่อนรูปที่ ${i + 1} ไปหลัง`}>→</button>
            </div>
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <label className={css.addTile}>
            <span>+ เพิ่มรูป<br /><span style={{ fontSize: 11 }}>JPG / PNG / WebP</span></span>
            <input ref={input} type="file" accept="image/*" multiple hidden aria-label="เพิ่มรูปสินค้า" disabled={pending}
              onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; add(files); }} />
          </label>
        )}
      </div>
      <Err msg={error} />
      <div className="muted" style={{ fontSize: 12 }}>รูปแรกเป็นรูปหน้าปกบนหน้าร้าน ใช้รูปที่ถ่ายเองหรือได้รับอนุญาตเท่านั้น</div>
    </section>
  );
}
