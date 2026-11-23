'use client';
import { useState } from 'react';
import { saveCoupon, setCouponActive } from '@/server/actions/coupons';
import { useAction } from '@/components/use-action';
import { Dialog, Err } from '@/components/dialog';

export type CouponRow = {
  code: string; text: string; note: string; showOnShop: boolean; statusLabel: string; statusTag: string; active: boolean; periodText: string;
  usedText: string; paidOrders: number; discountText: string; salesText: string; form: Record<string, string>;
};

export function CouponsView({ rows, today }: { rows: CouponRow[]; today: string }) {
  const [edit, setEdit] = useState<CouponRow | 'new' | null>(null);
  const { run, pending } = useAction({ errorAs: 'toast' });
  return (
    <div className="anim-page stack-4">
      <div className="toolbar">
        <p className="lead" style={{ margin: 0, maxWidth: '80ch' }}>ลูกค้าใส่โค้ดตอนชำระเงิน ระบบตรวจวันใช้ ยอดขั้นต่ำ และจำนวนสิทธิ์บนเซิร์ฟเวอร์ ส่วนลดคิดจากยอดสินค้า แล้วค่าส่งคิดจากยอดหลังหักส่วนลด · คำสั่งซื้อที่ไม่ชำระเงินจะคืนสิทธิ์ให้อัตโนมัติ</p>
        <button className="btn btn-primary ml-auto" onClick={() => setEdit('new')}>+ สร้างคูปอง</button>
      </div>
      <div className="scroll-x">
        <table className="table" aria-label="คูปอง">
          <thead><tr><th>โค้ด</th><th>ส่วนลด</th><th>ช่วงเวลา</th><th className="r">ใช้ไป / สิทธิ์</th><th className="r">ออเดอร์ที่ชำระ</th><th className="r">ส่วนลดรวม</th><th>สถานะ</th><th className="r">ดำเนินการ</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.code}>
                <td className="tnum nw"><strong>{c.code}</strong>{c.showOnShop && <span className="tag tag-neutral" style={{ marginLeft: 6 }}>แสดงหน้าร้าน</span>}{c.note && <div className="muted" style={{ fontSize: 12 }}>{c.note}</div>}</td>
                <td style={{ fontSize: 13 }}>{c.text}</td>
                <td className="tnum nw" style={{ fontSize: 13 }}>{c.periodText}</td>
                <td className="r tnum">{c.usedText}</td>
                <td className="r tnum">{c.paidOrders}</td>
                <td className="r tnum">{c.discountText}<div className="muted" style={{ fontSize: 12 }}>ยอดขาย {c.salesText}</div></td>
                <td><span className={`tag ${c.statusTag}`}>{c.statusLabel}</span></td>
                <td className="r"><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setEdit(c)} aria-label={`แก้ไข ${c.code}`}>แก้ไข</button>
                  <button className="btn btn-ghost" disabled={pending} onClick={() => run(() => setCouponActive(c.code, !c.active))} aria-label={`${c.active ? 'ปิดใช้' : 'เปิดใช้'} ${c.code}`}>{c.active ? 'ปิดใช้' : 'เปิดใช้'}</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <div className="empty">ยังไม่มีคูปอง</div>}
      {edit && <CouponDialog row={edit === 'new' ? null : edit} today={today} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CouponDialog({ row, today, onClose }: { row: CouponRow | null; today: string; onClose: () => void }) {
  const [f, setF] = useState<Record<string, string>>(row?.form ?? { code: '', kind: 'percent', value: '', maxDiscount: '', minSpend: '', startsOn: today, endsOn: today, usageLimit: '', oncePerCustomer: 'true', showOnShop: 'false', note: '' });
  const { run, pending, error } = useAction();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const inp = (k: string, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label htmlFor={'cp-' + k}>{label}</label><input id={'cp-' + k} className="input" value={f[k]} onChange={set(k)} {...extra} /></div>
  );
  return (
    <Dialog title={row ? `แก้ไขคูปอง · ${row.code}` : 'สร้างคูปอง'} className="w560" onClose={onClose}>
      <div className="grid2">
        {inp('code', 'โค้ด', { maxLength: 20, readOnly: !!row, autoCapitalize: 'characters', placeholder: 'เช่น NEWYEAR10' })}
        <div className="field"><label htmlFor="cp-kind">ชนิดส่วนลด</label>
          <select id="cp-kind" className="input" value={f.kind} onChange={set('kind')}><option value="percent">เปอร์เซ็นต์ (%)</option><option value="fixed">จำนวนเงิน (บาท)</option></select></div>
        {inp('value', f.kind === 'percent' ? 'ลด (%)' : 'ลด (บาท)', { type: 'number', min: 0, step: '0.01' })}
        {f.kind === 'percent' ? inp('maxDiscount', 'ลดสูงสุด (บาท) — ว่าง = ไม่จำกัด', { type: 'number', min: 0, step: '0.01' }) : <div />}
        {inp('minSpend', 'ยอดซื้อขั้นต่ำ (บาท)', { type: 'number', min: 0, step: '0.01' })}
        {inp('usageLimit', 'จำนวนสิทธิ์ทั้งหมด — ว่าง = ไม่จำกัด', { type: 'number', min: 1 })}
        {inp('startsOn', 'ใช้ได้ตั้งแต่', { type: 'date' })}
        {inp('endsOn', 'ถึงวันที่ (รวมวันนี้)', { type: 'date' })}
        <div className="field full"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.oncePerCustomer === 'true'} onChange={e => setF(x => ({ ...x, oncePerCustomer: String(e.target.checked) }))} /> ลูกค้าหนึ่งคนใช้ได้ครั้งเดียว</label></div>
        <div className="field full"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.showOnShop === 'true'} onChange={e => setF(x => ({ ...x, showOnShop: String(e.target.checked) }))} /> แสดงโค้ดนี้บนหน้าแรกของร้าน (ลูกค้ากดคัดลอกได้)</label></div>
        <div className="field full"><label htmlFor="cp-note">หมายเหตุ (ภายใน)</label><input id="cp-note" className="input" value={f.note} onChange={set('note')} maxLength={200} /></div>
      </div>
      <Err msg={error} />
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={pending} onClick={() => run(() => saveCoupon(row ? row.code : null, f), onClose)}>บันทึก</button>
      </div>
    </Dialog>
  );
}
