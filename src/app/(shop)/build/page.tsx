import Link from 'next/link';
import type { Metadata } from 'next';
import { buildHref, candidates, isPickSlot, loadBuild, readSelection, type BuildPart, type Selection } from '@/server/pc-builder';
import { getCustomer } from '@/server/customer-session';
import { SLOTS, type Slot } from '@/lib/compat';
import { baht } from '@/lib/domain';
import { StockNote } from '../product-card';
import { ProductArt } from '../product-art';
import { BuildActions } from './actions';
import css from '../storefront.module.css';

export const metadata: Metadata = { title: 'จัดสเปคคอม · COREPICK' };

type SP = Record<string, string | string[] | undefined>;

function Thumb({ p }: { p: BuildPart; label?: string }) {
  return <span className={css.thumb} style={p.image ? { backgroundImage: `url(${p.image})` } : undefined}>{!p.image && <ProductArt cat={p.categorySlug} brand={p.brand} label="" />}</span>;
}

export default async function BuildPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const b = await loadBuild(readSelection(sp));
  const sel = b.selection;
  const pickRaw = Array.isArray(sp.pick) ? sp.pick[0] : sp.pick;
  const pick = isPickSlot(pickRaw) ? pickRaw : undefined;
  const [list, me] = await Promise.all([pick ? candidates(pick, b.build) : Promise.resolve([]), getCustomer()]);
  const without = (slot: Slot): Selection => { const s = { ...sel }; delete s[slot]; return s; };
  const errSlots = new Set(b.issues.filter(i => i.level === 'error').flatMap(i => i.slots));

  return (
    <div className="anim-page">
      <div className={css.listHead}>
        <h1>จัดสเปคคอม</h1>
        {b.count > 0 && <Link href="/build" style={{ marginLeft: 'auto', fontSize: 14 }}>เริ่มใหม่</Link>}
      </div>
      <p className="muted" style={{ margin: '0 0 16px', maxWidth: '70ch' }}>เลือกชิ้นส่วนทีละช่อง ระบบตรวจให้ว่าใช้ร่วมกันได้ไหม (Socket ชนิดแรม ขนาดเคส ความยาวการ์ดจอ กำลังไฟ) แล้วใส่ตะกร้าได้ทั้งชุด ลิงก์หน้านี้แชร์ให้คนอื่นดูสเปคเดียวกันได้</p>

      <div className={css.builder}>
        <ol className={css.slots} aria-label="ชิ้นส่วน">
          {SLOTS.map(s => {
            const p = b.parts[s.key];
            const open = pick === s.key;
            return (
              <li key={s.key} className={`card ${css.slot}${errSlots.has(s.key) ? ' ' + css.slotErr : ''}`} data-slot={s.key} aria-labelledby={`slot-${s.key}`}>
                <div className={css.slotHead}>
                  <h2 id={`slot-${s.key}`}>{s.label}</h2>
                  {!s.required && <span className="tag tag-outline">ไม่บังคับ</span>}
                  {!p && !open && <Link href={buildHref(sel, s.key)} className="btn btn-secondary" style={{ marginLeft: 'auto' }}>เลือก{s.label}</Link>}
                  {open && <Link href={buildHref(sel)} style={{ marginLeft: 'auto', fontSize: 14 }}>ปิดรายการ</Link>}
                </div>
                {p && (
                  <div className={css.slotPart} data-sku={p.sku}>
                    <Thumb p={p} label={s.label} />
                    <span className={css.partText}>
                      <Link href={`/p/${p.slug}`}><strong>{p.name}</strong></Link>
                      {p.specLine && <span className="muted">{p.specLine}</span>}
                      <span className={css.slotLinks}>
                        {!open && <Link href={buildHref(sel, s.key)}>เปลี่ยน</Link>}
                        <Link href={buildHref(without(s.key))} aria-label={`เอา${s.label}ออก`}>เอาออก</Link>
                      </span>
                    </span>
                    <span className={css.partSide}><span className="tnum" style={{ fontWeight: 600 }}>{baht(p.price)}</span><StockNote n={p.available} /></span>
                  </div>
                )}
                {open && (
                  <ul className={css.picker} id="pick" aria-label={`ตัวเลือก${s.label}`}>
                    {list.map(c => {
                      const bad = c.issues.length > 0, chosen = c.sku === p?.sku;
                      return (
                        <li key={c.sku} className={`${css.cand}${bad ? ' ' + css.candBad : ''}`} data-candidate={c.sku}>
                          <Thumb p={c} label={s.label} />
                          <span className={css.partText}>
                            <strong>{c.name}</strong>
                            {c.specLine && <span className="muted">{c.specLine}</span>}
                            {bad && <span className={css.why}>ใช้ไม่ได้: {c.issues.map(i => i.text).join(' · ')}</span>}
                          </span>
                          <span className={css.partSide}>
                            <span className="tnum" style={{ fontWeight: 600 }}>{baht(c.price)}</span>
                            {chosen ? <span className="tag tag-accent">เลือกอยู่</span>
                              : bad || c.available < 1 ? <StockNote n={c.available} />
                              : <Link href={buildHref({ ...sel, [s.key]: c.sku })} className="btn btn-primary" aria-label={`เลือก ${c.name}`}>เลือก</Link>}
                          </span>
                        </li>
                      );
                    })}
                    {!list.length && <li className="empty">ยังไม่มีสินค้าในหมวดนี้</li>}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>

        <aside className={`card ${css.summary}`} aria-labelledby="sum-h">
          <h2 id="sum-h">สรุปสเปค</h2>
          <div className={css.sumTotal}><span>ราคารวม ({b.count} ชิ้น)</span><strong className="tnum" data-testid="build-total">{baht(b.total)}</strong></div>
          {(b.parts.cpu || b.parts.vga) && (
            <div style={{ fontSize: 13 }} data-testid="build-power">ประเมินการใช้ไฟ <b className="tnum">{b.watts} W</b> · แนะนำพาวเวอร์ <b className="tnum">{b.recommendedPsu} W</b> ขึ้นไป</div>
          )}
          {b.issues.length > 0 && (
            <ul className={css.issues} aria-label="ข้อควรแก้">
              {b.issues.map((i, k) => <li key={k} className={i.level === 'error' ? css.issueErr : undefined}>{i.level === 'error' ? 'ใช้ร่วมกันไม่ได้: ' : 'ข้อควรรู้: '}{i.text}</li>)}
            </ul>
          )}
          {b.count > 0 && !b.hasErrors && b.missing.length === 0 && <div className={css.okBox} role="status">ชิ้นส่วนครบและเข้ากันได้ทั้งชุด</div>}
          {b.missing.length > 0 && b.count > 0 && <div style={{ fontSize: 13 }} className="muted">ยังขาด: {b.missing.map(m => SLOTS.find(x => x.key === m)!.label).join(', ')}</div>}
          {b.outOfStock.length > 0 && <div className="err">สินค้าหมด: {b.outOfStock.join(', ')}</div>}
          <BuildActions sel={sel} canAdd={b.count > 0 && !b.hasErrors && !b.outOfStock.length} signedIn={!!me} loginHref={`/account/login?next=${encodeURIComponent(buildHref(sel))}`} />
        </aside>
      </div>
    </div>
  );
}
