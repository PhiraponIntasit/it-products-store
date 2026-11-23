'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { CatalogOptions } from '@/server/products';
import { deleteCatalogEntry, saveCatalogEntry, setBrandLogo } from '@/server/actions/products';
import { useAction } from '@/components/use-action';
import { SPEC_FIELDS } from '@/lib/specs';
import { Err } from '@/components/dialog';
import css from '../products.module.css';

type Kind = 'category' | 'brand';
type Entry = CatalogOptions['categories'][number];

export function CatalogView({ options }: { options: CatalogOptions }) {
  return (
    <div className="anim-page stack-4">
      <div className="toolbar">
        <p className="lead" style={{ margin: 0 }}>หมวดและยี่ห้อที่หน้าร้านใช้จัดกลุ่มและกรองสินค้า ลบได้เฉพาะรายการที่ไม่มีสินค้าแล้ว</p>
        <Link href="/products" className="btn btn-secondary ml-auto" style={{ textDecoration: 'none' }}>← กลับไปหน้าสินค้า</Link>
      </div>
      <div className={css.list}>
        <Section kind="category" title="หมวดสินค้า" rows={options.categories} />
        <Section kind="brand" title="ยี่ห้อ" rows={options.brands} />
      </div>
    </div>
  );
}

function Section({ kind, title, rows }: { kind: Kind; title: string; rows: Entry[] }) {
  const { run, pending, error } = useAction();
  const [name, setName] = useState(''), [slug, setSlug] = useState('');
  return (
    <section className="card stack-4">
      <h3 className="section-h">{title} <span className="muted tnum" style={{ fontSize: 13 }}>({rows.length})</span></h3>
      <div>{rows.map(r => <Row key={r.id} kind={kind} r={r} />)}</div>
      <form className={css.entry} onSubmit={e => { e.preventDefault(); run(() => saveCatalogEntry(kind, null, name, slug), () => { setName(''); setSlug(''); }); }}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={`ชื่อ${kind === 'category' ? 'หมวด' : 'ยี่ห้อ'}ใหม่`} aria-label={`ชื่อ${title}ใหม่`} maxLength={60} />
        <input className="input" value={slug} onChange={e => setSlug(e.target.value)} placeholder="slug (ไม่บังคับ)" aria-label={`slug ${title}ใหม่`} maxLength={40} style={{ maxWidth: 150 }} />
        <button className="btn btn-primary" disabled={pending || !name.trim()}>เพิ่ม</button>
      </form>
      <Err msg={error} />
    </section>
  );
}

function Row({ kind, r }: { kind: Kind; r: Entry }) {
  const { run, pending } = useAction({ errorAs: 'toast' });
  const [name, setName] = useState(r.name), [slug, setSlug] = useState(r.slug);
  const dirty = name !== r.name || slug !== r.slug;
  return (
    <div className={css.entry}>
      <input className="input" value={name} onChange={e => setName(e.target.value)} aria-label={`ชื่อ ${r.name}`} maxLength={60} />
      <input className="input tnum" value={slug} onChange={e => setSlug(e.target.value)} aria-label={`slug ${r.name}`} maxLength={40} style={{ maxWidth: 150 }}
        readOnly={kind === 'category' && !!SPEC_FIELDS[r.slug]} title={kind === 'category' && SPEC_FIELDS[r.slug] ? 'ผูกกับช่องสเปค เปลี่ยนไม่ได้' : undefined} />
      {kind === 'brand' && <BrandLogo r={r} />}
      <span className="muted tnum" style={{ fontSize: 12, width: 56, textAlign: 'right' }}>{r.count} ชิ้น</span>
      {dirty
        ? <button className="btn btn-primary" disabled={pending} onClick={() => run(() => saveCatalogEntry(kind, r.id, name, slug))}>บันทึก</button>
        : <button className="btn btn-ghost" disabled={pending || r.count > 0} title={r.count ? 'ยังมีสินค้าอยู่' : undefined} onClick={() => run(() => deleteCatalogEntry(kind, r.id))} aria-label={`ลบ ${r.name}`}>ลบ</button>}
    </div>
  );
}

/** Logo shown in the storefront brand strip (otherwise the name is shown as a wordmark). */
function BrandLogo({ r }: { r: Entry }) {
  const { run, pending } = useAction({ errorAs: 'toast' });
  const send = (file?: File) => { const fd = new FormData(); if (file) fd.append('logo', file); run(() => setBrandLogo(r.id, fd)); };
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {r.logo && <img src={r.logo} alt={`โลโก้ ${r.name}`} width={64} height={28} style={{ objectFit: 'contain', background: '#fff', borderRadius: 4 }} />}
      <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
        {r.logo ? 'เปลี่ยนโลโก้' : 'ใส่โลโก้'}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={pending} aria-label={`โลโก้ ${r.name}`}
          onChange={e => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ''; }} />
      </label>
      {r.logo && <button className="btn btn-ghost" disabled={pending} onClick={() => send()} aria-label={`ลบโลโก้ ${r.name}`}>ลบโลโก้</button>}
    </span>
  );
}
