import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { productBySlug } from '@/server/storefront';
import { can, getUser } from '@/server/auth';
import { baht } from '@/lib/domain';
import { ProductGrid, StockNote } from '../../product-card';
import { Gallery } from './gallery';
import { AddToCart } from './add-to-cart';
import { Countdown } from '../../home-widgets';
import css from '../../storefront.module.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await productBySlug((await params).slug);
  return { title: p ? `${p.name} · COREPICK` : 'ไม่พบสินค้า · COREPICK' };
}

export default async function ProductPage({ params }: Props) {
  const [p, staff] = await Promise.all([productBySlug((await params).slug), getUser()]);
  if (!p) notFound();
  const off = p.compareAt != null && p.compareAt > p.price ? p.compareAt - p.price : 0;
  return (
    <div className="anim-page">
      <nav className={css.crumbs} aria-label="ตำแหน่งหน้า">
        <Link href="/">หน้าแรก</Link><span aria-hidden>›</span>
        <Link href="/shop">สินค้าทั้งหมด</Link>
        {p.category && <><span aria-hidden>›</span><Link href={`/shop?cat=${p.category.slug}`}>{p.category.name}</Link></>}
      </nav>

      <div className={css.prod}>
        <Gallery images={p.images} name={p.name} category={p.category?.name ?? ''} />
        <div className={css.buy}>
          {p.brand && <Link href={`/shop?brand=${p.brand.slug}`} className="kicker">{p.brand.name}</Link>}
          <h1>{p.name}</h1>
          {can(staff, 'products') && <Link href={`/products/${encodeURIComponent(p.sku)}`} style={{ fontSize: 13 }}>แก้ไขสินค้านี้ในหลังร้าน (ราคา สต็อก รูป) ›</Link>}
          <div className={css.priceRow}>
            <span className={`${css.bigPrice} tnum`}>{baht(p.price)}</span>
            {off > 0 && <><span className={`${css.was} tnum`}>{baht(p.compareAt!)}</span><span className="tag tag-accent tnum">ลด {baht(off)}</span></>}
          </div>
          {p.saleEndsAt && <div className={css.flashTimer} data-testid="flash-note"><span className={css.flagFlash}>FLASH SALE</span><span>ราคานี้สิ้นสุดใน</span><Countdown endsAt={p.saleEndsAt} /></div>}
          <span className={css.vat}>ราคารวม VAT 7% แล้ว</span>
          <StockNote n={p.available} />
          <AddToCart sku={p.sku} max={p.available} />
          <dl className={css.facts}>
            <dt>รหัสสินค้า</dt><dd className="tnum">{p.sku}</dd>
            <dt>รับประกัน</dt><dd>{p.warrantyMonths > 0 ? `${p.warrantyMonths} เดือน นับจากวันจัดส่ง` : 'ไม่มีการรับประกัน'}</dd>
            {p.serialTracked && <><dt>Serial</dt><dd>ระบุหมายเลข Serial ในใบส่งของ ใช้ตรวจสอบประกันได้</dd></>}
          </dl>
        </div>
      </div>

      {p.specs.length > 0 && (
        <section aria-labelledby="spec-h">
          <div className={css.secHead}><h2 id="spec-h">สเปค</h2></div>
          <table className={css.specs}><tbody>{p.specs.map(s => <tr key={s.label}><th scope="row">{s.label}</th><td>{s.value}</td></tr>)}</tbody></table>
        </section>
      )}
      {p.description && (
        <section aria-labelledby="desc-h">
          <div className={css.secHead}><h2 id="desc-h">รายละเอียด</h2></div>
          <p className={css.desc}>{p.description}</p>
        </section>
      )}
      {p.related.length > 0 && (
        <section aria-labelledby="rel-h">
          <div className={css.secHead}><h2 id="rel-h">สินค้าในหมวดเดียวกัน</h2>{p.category && <Link href={`/shop?cat=${p.category.slug}`}>ดูทั้งหมด</Link>}</div>
          <ProductGrid items={p.related} />
        </section>
      )}
    </div>
  );
}
