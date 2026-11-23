'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/toast';
import css from './storefront.module.css';

type Banner = { id: string; title: string; subtitle: string; link: string; tone: string };
const TONE: Record<string, string> = { cobalt: css.toneCobalt, slate: css.toneSlate, teal: css.toneTeal, violet: css.toneViolet };

/** Home-page banners: one at a time, changes every 6 s (paused on hover/focus and when motion is reduced). */
export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (banners.length < 2 || hold || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI(k => (k + 1) % banners.length), 6000);
    return () => clearInterval(t);
  }, [banners.length, hold]);
  const b = banners[i];
  return (
    <section className={css.carousel} aria-roledescription="carousel" aria-label="โปรโมชั่น"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <Link href={b.link} className={`${css.banner} ${TONE[b.tone] ?? css.toneCobalt}`} aria-roledescription="slide" aria-label={`${i + 1} จาก ${banners.length}: ${b.title}`}>
        <span className={css.bannerKicker}>โปรโมชั่น</span>
        <strong className={css.bannerTitle}>{b.title}</strong>
        {b.subtitle && <span className={css.bannerSub}>{b.subtitle}</span>}
        <span className={css.bannerCta}>ดูเลย ›</span>
      </Link>
      {banners.length > 1 && (
        <div className={css.dots} role="group" aria-label="เลือกแบนเนอร์">
          {banners.map((x, k) => <button key={x.id} type="button" aria-label={`แบนเนอร์ ${k + 1}: ${x.title}`} aria-pressed={k === i} className={k === i ? css.dotOn : css.dot} onClick={() => setI(k)} />)}
        </div>
      )}
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
  return (
    <span className={`${css.countdown} tnum`} role="timer" aria-label="เวลาที่เหลือ" suppressHydrationWarning>
      {d > 0 && <span>{d} วัน</span>}<span>{two(h)}</span>:<span>{two(m)}</span>:<span>{two(s % 60)}</span>
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
