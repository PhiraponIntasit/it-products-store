import Link from 'next/link';
import type { ProductCard as BaseCard } from '@/server/storefront';

type Card = BaseCard & { saleEndsAt?: string | null };
import { LogoMark } from '@/components/logo';
import { ProductArt } from './product-art';
import { baht } from '@/lib/domain';
import css from './storefront.module.css';

/** "In stock" wording shared by cards and the product page. */
export function StockNote({ n }: { n: number }) {
  if (n <= 0) return <span className={css.stockOut}>สินค้าหมด</span>;
  if (n <= 3) return <span className={css.stockLow}>เหลือ {n} ชิ้น</span>;
  return <span className={css.stock}>มีสินค้า</span>;
}

/** Placeholder until the team's own photos are uploaded. */
export function NoPicture({ label, size = 40 }: { label: string; size?: number }) {
  return <span className={css.noPic}><LogoMark size={size} />{label}</span>;
}

const off = (p: Card) => (p.compareAt != null && p.compareAt > p.price ? Math.round((1 - p.price / p.compareAt) * 100) : 0);

export function ProductCard({ p, copy = false }: { p: Card; copy?: boolean }) {
  return (
    <Link href={`/p/${p.slug}`} className={css.card} data-sku={copy ? undefined : p.sku}>
      <div className={`${css.pic}${p.image ? ` ${css.picPhoto}` : ''}`} style={p.image ? { backgroundImage: `url(${p.image})` } : undefined}>
        {!p.image && <ProductArt cat={p.categorySlug} brand={p.brand} label={`ภาพประกอบ ${p.name}`} />}
        {(p.saleEndsAt || off(p) > 0) && (
          <span className={css.flags}>
            {p.saleEndsAt && <span className={css.flagFlash}>FLASH SALE</span>}
            {off(p) > 0 && <span className={css.flagOff}>−{off(p)}%</span>}
          </span>
        )}
      </div>
      <div className={css.cardBody}>
        {p.brand && <span className={css.cardBrand}>{p.brand}</span>}
        <span className={css.cardName}>{p.name}</span>
        <span className={css.priceRow}>
          <span className={`${css.price} tnum`}>{baht(p.price)}</span>
          {p.compareAt != null && p.compareAt > p.price && <span className={`${css.was} tnum`}>{baht(p.compareAt)}</span>}
        </span>
        <StockNote n={p.available} />
      </div>
    </Link>
  );
}

export function ProductGrid({ items }: { items: Card[] }) {
  return <div className={css.grid}>{items.map(p => <ProductCard key={p.sku} p={p} />)}</div>;
}

/** Home-page row: five cards across (three on tablets, two on phones). With more than five the row glides left on a
 *  loop, pausing under the pointer or keyboard focus; the second copy that closes the loop is hidden from screen
 *  readers and the keyboard. With reduced motion it stays still and scrolls by hand. */
export function ProductRail({ items }: { items: Card[] }) {
  const moving = items.length > 5;
  return (
    <div className={`${css.rail}${moving ? ` ${css.railMoving}` : ''}`} data-rail>
      <div className={css.railTrack} style={moving ? { ['--rail-dur' as string]: `${items.length * 4}s` } : undefined}>
        {items.map(p => <div key={p.sku} className={css.railItem}><ProductCard p={p} /></div>)}
        {moving && items.map(p => <div key={`copy-${p.sku}`} className={`${css.railItem} ${css.railCopy}`} aria-hidden inert><ProductCard p={p} copy /></div>)}
      </div>
    </div>
  );
}
