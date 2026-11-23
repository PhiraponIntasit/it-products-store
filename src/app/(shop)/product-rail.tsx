'use client';
import { useEffect, useRef, useState } from 'react';
import { ProductCard, type Card } from './product-card';
import css from './storefront.module.css';

const STEP_MS = 10_000;

/** Home-page row: five cards across (three on tablets, two on phones). With more than fit, every 10 seconds the row
 *  slides left by one screenful and loops round; it waits while the pointer or keyboard focus is on it. Two hidden
 *  copies of the cards follow the real ones so the loop never shows a gap; after passing the end it jumps back by one
 *  set without animating, which looks identical. With reduced motion it stays still and scrolls by hand. */
export function ProductRail({ items }: { items: Card[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const [moving, setMoving] = useState(false);
  const [offset, setOffset] = useState(0);
  const [jump, setJump] = useState(false);
  const n = items.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const per = () => Number(getComputedStyle(el).getPropertyValue('--per')) || 5;
    const fits = () => reduce.matches || n <= per();
    const check = () => { const m = !fits(); setMoving(m); if (!m) setOffset(0); };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    reduce.addEventListener('change', check);
    const t = setInterval(() => { if (!paused.current && !document.hidden && !fits()) setOffset(o => o + per()); }, STEP_MS);
    return () => { ro.disconnect(); reduce.removeEventListener('change', check); clearInterval(t); };
  }, [n]);

  useEffect(() => {
    if (!jump) return;
    let r = requestAnimationFrame(() => { r = requestAnimationFrame(() => setJump(false)); });
    return () => cancelAnimationFrame(r);
  }, [jump]);

  const slid = (e: React.TransitionEvent) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform' || offset < n) return;
    setJump(true);
    setOffset(o => o - n);
  };
  const hold = (on: boolean) => () => { paused.current = on; };

  return (
    <div ref={ref} className={css.rail} data-rail data-moving={moving || undefined}
      onMouseEnter={hold(true)} onMouseLeave={hold(false)} onFocus={hold(true)} onBlur={hold(false)}>
      <div className={`${css.railTrack}${jump ? ` ${css.railJump}` : ''}`} style={{ ['--offset' as string]: offset }} onTransitionEnd={slid}>
        {items.map(p => <div key={p.sku} className={css.railItem}><ProductCard p={p} /></div>)}
        {n > 2 && [1, 2].flatMap(k => items.map(p => (
          <div key={`${k}-${p.sku}`} className={`${css.railItem} ${css.railCopy}`} aria-hidden inert><ProductCard p={p} copy /></div>
        )))}
      </div>
    </div>
  );
}
