'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/toast';
import { ProductArt } from './product-art';
import css from './storefront.module.css';

type Banner = { id: string; title: string; subtitle: string; link: string; tone: string; image: string | null };
const TONE: Record<string, string> = { cobalt: css.toneCobalt, slate: css.toneSlate, teal: css.toneTeal, violet: css.toneViolet };
/** The part drawn on a designed poster, from where the banner leads (/shop?cat=vga → a graphics card). */
const artFor = (link: string) => /[?&]cat=([a-z-]+)/.exec(link)?.[1] ?? (link.startsWith('/build') ? 'case' : 'vga');

/** Home-page posters sliding left every 5 s (arrows, dots and swipe; paused on hover/focus; no motion when reduced). */
export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const n = banners.length;
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const [still, setStill] = useState(false);
  const [x0, setX0] = useState<number | null>(null);
  useEffect(() => { setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  useEffect(() => {
    if (n < 2 || hold || still) return;
    const t = setInterval(() => setI(k => (k + 1) % n), 5000);
    return () => clearInterval(t);
  }, [n, hold, still]);
  const go = (k: number) => setI(((k % n) + n) % n);
  return (
    <section className={css.carousel} aria-roledescription="carousel" aria-label="โปรโมชั่น"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}
      onTouchStart={e => setX0(e.touches[0].clientX)} onTouchEnd={e => { if (x0 != null) { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); } setX0(null); }}>
      <div className={css.track} style={{ transform: `translateX(-${i * 100}%)`, transition: still ? 'none' : undefined }}>
        {banners.map((b, k) => (
          <Link key={b.id} href={b.link} className={`${css.banner} ${b.image ? css.bannerImg : TONE[b.tone] ?? css.toneCobalt}`}
            aria-roledescription="slide" aria-label={`${k + 1} จาก ${n}: ${b.title}`} aria-hidden={k !== i} tabIndex={k === i ? 0 : -1}>
            {b.image ? <img src={b.image} alt={b.title} className={css.bannerPic} /> : <>
              <span className={css.bannerText}>
                <span className={css.bannerKicker}>โปรโมชั่น</span>
                <strong className={css.bannerTitle}>{b.title}</strong>
                {b.subtitle && <span className={css.bannerSub}>{b.subtitle}</span>}
                <span className={css.bannerCta}>ช้อปเลย ›</span>
              </span>
              <span className={css.bannerArt} aria-hidden><ProductArt cat={artFor(b.link)} brand="" label="" /></span>
            </>}
          </Link>
        ))}
      </div>
      {n > 1 && <>
        <button type="button" className={`${css.arrow} ${css.arrowL}`} onClick={() => go(i - 1)} aria-label="แบนเนอร์ก่อนหน้า">‹</button>
        <button type="button" className={`${css.arrow} ${css.arrowR}`} onClick={() => go(i + 1)} aria-label="แบนเนอร์ถัดไป">›</button>
        <div className={css.dots} role="group" aria-label="เลือกแบนเนอร์">
          {banners.map((x, k) => <button key={x.id} type="button" aria-label={`แบนเนอร์ ${k + 1}: ${x.title}`} aria-pressed={k === i} className={k === i ? css.dotOn : css.dot} onClick={() => go(k)} />)}
        </div>
      </>}
    </section>
  );
}

const two = (n: number) => String(n).padStart(2, '0');
/** "2 วัน 13:45:10" until `endsAt`; the page refreshes when it reaches zero so prices go back to normal. */
export function Countdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= end) { clearInterval(t); window.location.reload(); }
    }, 1000);
    return () => clearInterval(t);
  }, [end]);
  const s = Math.max(0, Math.floor((end - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  const box = (v: string | number, unit: string) => <span className={css.cdBox}><strong>{v}</strong><small>{unit}</small></span>;
  return (
    <span className={`${css.countdown} tnum`} role="timer" aria-label={`เหลือเวลา ${d} วัน ${h} ชั่วโมง ${m} นาที`} suppressHydrationWarning>
      {box(d, 'วัน')}{box(two(h), 'ชั่วโมง')}{box(two(m), 'นาที')}{box(two(s % 60), 'วินาที')}
    </span>
  );
}

/** A coupon customers can copy, to paste at checkout. */
export function CouponCard({ code, text, once }: { code: string; text: string; once: boolean }) {
  const toast = useToast();
  return (
    <div className={css.coupon} data-coupon={code}>
      <div>
        <strong className="tnum">{code}</strong>
        <span>{text}{once ? ' · ใช้ได้คนละครั้ง' : ''}</span>
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => {
        navigator.clipboard?.writeText(code).then(() => toast(`คัดลอกโค้ด ${code} แล้ว ใส่ตอนชำระเงิน`), () => toast(`โค้ด: ${code}`));
      }}>คัดลอก</button>
    </div>
  );
}
