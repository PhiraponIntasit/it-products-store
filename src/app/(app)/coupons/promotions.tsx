'use client';
import { useMemo, useState } from 'react';
import { savePromo, setPromoActive } from '@/server/actions/promotions';
import { useAction } from '@/components/use-action';
import { Dialog, Err } from '@/components/dialog';
import { baht, bahtS } from '@/lib/domain';
import type { PromotionRow } from '@/server/promotions';

type Product = { sku: string; name: string; price: number; cost: number };
const TONES: [string, string][] = [['cobalt', 'น้ำเงิน'], ['slate', 'เทาเข้ม'], ['teal', 'เขียวน้ำทะเล'], ['violet', 'ม่วง']];

export function PromotionsView({ rows, products, now }: { rows: PromotionRow[]; products: Product[]; now: string }) {
  const [edit, setEdit] = useState<PromotionRow | 'flash' | 'banner' | null>(null);
  const { run, pending } = useAction({ errorAs: 'toast' });
  return (
    <div className="stack-4">
      <div className="toolbar">
        <p className="lead" style={{ margin: 0, maxWidth: '80ch' }}>
          <strong>Flash sale</strong> ลดราคาสินค้าตามช่วงเวลา ราคาลดขึ้นทุกที่บนหน้าร้าน ตะกร้า และตอนชำระเงินโดยอัตโนมัติ หมดเวลาแล้วกลับเป็นราคาปกติเอง ·
          <strong> แบนเนอร์</strong> ขึ้นบนหน้าแรกของร้านตามช่วงเวลา
        </p>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-secondary" onClick={() => setEdit('banner')}>+ แบนเนอร์</button>
          <button className="btn btn-primary" onClick={() => setEdit('flash')}>+ Flash sale</button>
        </div>
      </div>
      <div className="scroll-x">
        <table className="table" aria-label="โปรโมชั่น">
          <thead><tr><th>โปรโมชั่น</th><th>ชนิด</th><th>ช่วงเวลา</th><th>สินค้า / ลิงก์</th><th>สถานะ</th><th className="r">ดำเนินการ</th></tr></thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} data-promo={p.title}>
                <td><strong>{p.title}</strong>{p.subtitle && <div className="muted" style={{ fontSize: 12 }}>{p.subtitle}</div>}</td>
                <td>{p.kind === 'flash' ? 'Flash sale' : 'แบนเนอร์'}</td>
                <td className="tnum nw" style={{ fontSize: 13 }}>{p.periodText}</td>
                <td style={{ fontSize: 13 }}>
                  {p.kind === 'flash' ? p.items.map(i => (
                    <div key={i.sku} className="tnum">{i.name} · <s className="muted">{bahtS(i.price)}</s> → <strong>{bahtS(i.sale)}</strong> (−{i.off}%)
                      {i.margin < 0 && <span className="err"> · ต่ำกว่าทุน {bahtS(-i.margin)}</span>}</div>
                  )) : <code>{p.link || '/shop'}</code>}
                </td>
                <td><span className={`tag ${p.statusTag}`}>{p.statusLabel}</span></td>
                <td className="r"><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setEdit(p)} aria-label={`แก้ไข ${p.title}`}>แก้ไข</button>
                  <button className="btn btn-ghost" disabled={pending} onClick={() => run(() => setPromoActive(p.id, !p.active))} aria-label={`${p.active ? 'ปิด' : 'เปิด'} ${p.title}`}>{p.active ? 'ปิด' : 'เปิด'}</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <div className="empty">ยังไม่มีโปรโมชั่น</div>}
      {edit && <PromoDialog row={typeof edit === 'string' ? null : edit} kind={typeof edit === 'string' ? edit : edit.kind} products={products} now={now} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PromoDialog({ row, kind, products, now, onClose }: { row: PromotionRow | null; kind: string; products: Product[]; now: string; onClose: () => void }) {
  const [f, setF] = useState<Record<string, string>>(row?.form ?? { kind, title: '', subtitle: '', link: '', tone: 'cobalt', sort: '0', startsAt: now, endsAt: now });
  const [items, setItems] = useState<{ sku: string; sale: string }[]>(row?.items.map(i => ({ sku: i.sku, sale: String(i.sale) })) ?? []);
  const [pick, setPick] = useState('');
  const { run, pending, error } = useAction();
  const bySku = useMemo(() => new Map(products.map(p => [p.sku, p])), [products]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const inp = (k: string, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label htmlFor={'pm-' + k}>{label}</label><input id={'pm-' + k} className="input" value={f[k]} onChange={set(k)} {...extra} /></div>
  );
  const flash = f.kind === 'flash';
  return (
    <Dialog title={row ? `แก้ไข · ${row.title}` : flash ? 'สร้าง Flash sale' : 'สร้างแบนเนอร์'} className="w560" onClose={onClose}>
      <div className="grid2">
        <div className="field full"><label htmlFor="pm-title">ชื่อ{flash ? 'โปรโมชั่น' : 'แบนเนอร์ (ข้อความใหญ่)'}</label><input id="pm-title" className="input" value={f.title} onChange={set('title')} maxLength={80} /></div>
        <div className="field full"><label htmlFor="pm-subtitle">ข้อความรอง</label><input id="pm-subtitle" className="input" value={f.subtitle} onChange={set('subtitle')} maxLength={160} /></div>
        {inp('startsAt', 'เริ่ม', { type: 'datetime-local' })}
        {inp('endsAt', 'สิ้นสุด', { type: 'datetime-local' })}
        {!flash && <>
          {inp('link', 'ลิงก์เมื่อกด (หน้าในร้าน)', { placeholder: '/shop?cat=gpu', maxLength: 200 })}
          <div className="field"><label htmlFor="pm-tone">สีแบนเนอร์</label>
            <select id="pm-tone" className="input" value={f.tone} onChange={set('tone')}>{TONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          {inp('sort', 'ลำดับ (น้อยขึ้นก่อน)', { type: 'number', min: 0, max: 99 })}
        </>}
      </div>
      {flash && (
        <div className="stack-4" style={{ gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <select aria-label="เลือกสินค้าเข้า Flash sale" className="input" style={{ flex: 1 }} value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">— เลือกสินค้า —</option>
              {products.filter(p => !items.some(i => i.sku === p.sku)).map(p => <option key={p.sku} value={p.sku}>{p.name} ({bahtS(p.price)})</option>)}
            </select>
            <button type="button" className="btn btn-secondary" disabled={!pick} onClick={() => { const p = bySku.get(pick)!; setItems([...items, { sku: pick, sale: String(Math.round(p.price * 0.9)) }]); setPick(''); }}>เพิ่ม</button>
          </div>
          {items.map((it, k) => {
            const p = bySku.get(it.sku), sale = Number(it.sale);
            return (
              <div key={it.sku} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 220px', fontSize: 14 }}>{p?.name ?? it.sku} <span className="muted tnum">ปกติ {p ? baht(p.price) : '—'}</span></span>
                <input aria-label={`ราคาลด ${p?.name ?? it.sku}`} className="input tnum" type="number" min={1} step="0.01" style={{ width: 130 }} value={it.sale}
                  onChange={e => setItems(items.map((x, i) => (i === k ? { ...x, sale: e.target.value } : x)))} />
                {p && sale > 0 && <span className={`tnum ${sale / 1.07 < p.cost ? 'err' : 'muted'}`} style={{ fontSize: 12, width: 110 }}>−{Math.round((1 - sale / p.price) * 100)}%{sale / 1.07 < p.cost ? ' · ต่ำกว่าทุน' : ''}</span>}
                <button type="button" className="btn btn-ghost" onClick={() => setItems(items.filter((_, i) => i !== k))} aria-label={`เอา ${p?.name ?? it.sku} ออก`}>ลบ</button>
              </div>
            );
          })}
          {!items.length && <div className="muted" style={{ fontSize: 13 }}>ยังไม่มีสินค้า — เลือกแล้วกด “เพิ่ม” (ตั้งราคาลดเริ่มต้น 10%)</div>}
        </div>
      )}
      <Err msg={error} />
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={pending} onClick={() => run(() => savePromo(row ? row.id : null, f, Object.fromEntries(items.map(i => [i.sku, i.sale]))), onClose)}>บันทึก</button>
      </div>
    </Dialog>
  );
}
