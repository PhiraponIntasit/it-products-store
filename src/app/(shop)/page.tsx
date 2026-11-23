import Link from 'next/link';
import type { Metadata } from 'next';
import { homeData } from '@/server/storefront';
import { FREE_SHIPPING_MIN } from '@/lib/shipping';
import { ProductRail } from './product-card';
import { BannerCarousel, Countdown, CouponCard } from './home-widgets';
import { accentOf } from './product-art';
import css from './storefront.module.css';

export const metadata: Metadata = { title: 'COREPICK · ร้านอุปกรณ์คอมพิวเตอร์' };
export const dynamic = 'force-dynamic'; // promotions start and end on the clock

export default async function HomePage() {
  const d = await homeData();
  return (
    <div className="anim-page">
      <h1 className="sr-only">COREPICK ร้านอุปกรณ์คอมพิวเตอร์</h1>
      <div className={d.side ? css.heroWithSide : undefined}>
        {d.banners.length ? <BannerCarousel banners={d.banners} /> : (
          <section className={`${css.banner} ${css.toneCobalt}`} aria-label="ร้าน" style={{ borderRadius: 'var(--radius-lg)' }}>
            <strong className={css.bannerTitle}>อุปกรณ์คอมพิวเตอร์ของแท้ เลือกง่าย ส่งไว</strong>
            <span className={css.bannerSub}>สเปคครบทุกชิ้น ดูจำนวนคงเหลือได้ทันที ชำระด้วย PromptPay QR</span>
          </section>
        )}
        {d.side && (
          <Link href={d.side.link} className={`${css.sideBanner} ${d.side.image ? '' : css.toneSlate}`} aria-label={d.side.title}>
            {d.side.image ? <img src={d.side.image} alt={d.side.title} /> : <span className={css.bannerText} style={{ maxWidth: 'none' }}>
              <span className={css.bannerKicker}>โปรโมชั่น</span><strong className={css.bannerTitle} style={{ fontSize: 24 }}>{d.side.title}</strong>
              {d.side.subtitle && <span className={css.bannerSub}>{d.side.subtitle}</span>}<span className={css.bannerCta}>ดูเลย ›</span></span>}
          </Link>
        )}
      </div>
      <div className={css.promoTiles}>
          <Link href="/build" className={css.sideCard}>
            <strong>จัดสเปคคอมเอง</strong>
            <span>เลือกทีละชิ้น ระบบเช็ค Socket แรม ขนาดเคส และกำลังไฟให้</span>
            <span className={css.sideCta}>เริ่มจัดสเปค ›</span>
          </Link>
          <Link href={d.flash ? '#flash' : '/shop?sort=price-asc'} className={css.sideCard}>
            <strong>{d.flash ? d.flash.title : 'สินค้าราคาพิเศษ'}</strong>
            <span>{d.flash ? `ลดสูงสุด ${Math.max(...d.flash.items.map(i => Math.round((1 - i.price / (i.compareAt ?? i.price)) * 100)))}% · ${d.flash.items.length} รายการ` : 'ดูสินค้าที่ลดราคาอยู่ตอนนี้'}</span>
            <span className={css.sideCta}>{d.flash ? 'ดู Flash Sale ›' : 'ดูสินค้า ›'}</span>
          </Link>
          <Link href="/account/claims" className={css.sideCard}>
            <strong>เคลมออนไลน์</strong>
            <span>แจ้งเคลมจากคำสั่งซื้อของคุณ แนบรูปอาการ แล้วติดตามผลจากช่างได้ในบัญชี</span>
            <span className={css.sideCta}>แจ้งเคลม ›</span>
          </Link>
      </div>

      {d.brands.length > 0 && (
        <section className={css.brandWall} aria-labelledby="brands-h">
          <h2 id="brands-h">สินค้าจากแบรนด์ชั้นนำ</h2>
          <nav className={css.brands} aria-label="แบรนด์">
            {d.brands.map(b => (
              <Link key={b.slug} href={`/shop?brand=${b.slug}`} aria-label={`สินค้าแบรนด์ ${b.name}`} style={{ ['--brand' as string]: accentOf(b.name) }}>
                {b.logo ? <img src={b.logo} alt="" className={css.brandLogo} /> : <span className={css.wordmark}>{b.name}</span>}
              </Link>
            ))}
          </nav>
        </section>
      )}

      <ul className={css.services} aria-label="บริการของร้าน">
        <li><strong>ส่งฟรี</strong><span>กรุงเทพฯ และปริมณฑล · ครบ ฿{FREE_SHIPPING_MIN.toLocaleString('en-US')} ส่งฟรีทั่วประเทศ</span></li>
        <li><strong>จ่ายด้วย PromptPay QR</strong><span>ยอดตรงตามคำสั่งซื้อ ยืนยันอัตโนมัติ</span></li>
        <li><strong>รับประกันทุกชิ้น</strong><span>ตรวจด้วย Serial แจ้งเคลมออนไลน์ได้</span></li>
        <li><strong>ใบเสร็จ / ใบกำกับภาษี</strong><span>ดาวน์โหลดได้จากหน้าคำสั่งซื้อ</span></li>
      </ul>

      <div className={css.secHead}><h2>หมวดสินค้า</h2><Link href="/shop">ดูทั้งหมด</Link></div>
      <nav className={css.cats} aria-label="หมวดสินค้า">
        {d.categories.map(c => <Link key={c.slug} href={`/shop?cat=${c.slug}`} className={css.cat}>{c.name}<span className="tnum">{c.count} รายการ</span></Link>)}
      </nav>

      {d.flash && (
        <section id="flash" className={css.flash} aria-labelledby="flash-h">
          <div className={css.flashHead}>
            <div>
              <h2 id="flash-h">{d.flash.title}</h2>
              {d.flash.subtitle && <p>{d.flash.subtitle}</p>}
            </div>
            <div className={css.flashTimer}><span>สิ้นสุดใน</span><Countdown endsAt={d.flash.endsAt} /></div>
          </div>
          <ProductRail items={d.flash.items} />
        </section>
      )}

      {d.coupons.length > 0 && <>
        <div className={css.secHead}><h2>โค้ดส่วนลด</h2><span className="muted" style={{ fontSize: 14 }}>คัดลอกแล้วใส่ตอนชำระเงิน</span></div>
        <div className={css.coupons}>{d.coupons.map(c => <CouponCard key={c.code} code={c.code} text={c.text} once={c.oncePerCustomer} />)}</div>
      </>}

      {d.best.length > 0 && <>
        <div className={css.secHead}><h2>สินค้าขายดี 30 วัน</h2><Link href="/shop">ดูทั้งหมด</Link></div>
        <ProductRail items={d.best} />
      </>}

      {d.deals.length > 0 && <>
        <div className={css.secHead}><h2>ราคาพิเศษ</h2></div>
        <ProductRail items={d.deals} />
      </>}

      {d.rows.map(r => (
        <section key={r.slug} aria-labelledby={`row-${r.slug}`}>
          <div className={css.secHead}><h2 id={`row-${r.slug}`}>{r.name}</h2><Link href={`/shop?cat=${r.slug}`}>ดูทั้งหมด</Link></div>
          <ProductRail items={r.items} />
        </section>
      ))}

      <div className={css.secHead}><h2>สินค้ามาใหม่</h2><Link href="/shop?sort=new">ดูทั้งหมด</Link></div>
      {d.newest.length ? <ProductRail items={d.newest} /> : <div className="empty">ยังไม่มีสินค้าขึ้นหน้าร้าน</div>}


    </div>
  );
}
