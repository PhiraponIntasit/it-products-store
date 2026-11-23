import Link from 'next/link';
import { getCustomer } from '@/server/customer-session';
import { getUser, homePath } from '@/server/auth';
import { cartView } from '@/server/cart';
import { Logo } from '@/components/logo';
import { SHOP } from '@/lib/shop';
import { FREE_SHIPPING_MIN, UPCOUNTRY_FEE } from '@/lib/shipping';
import css from './storefront.module.css';

// Storefront frame: header with search, the page, and a footer with the shop's details and policies.
// Staff signed in to the back office (a separate session) get a thin bar back to it.
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [me, cart, staff] = await Promise.all([getCustomer(), cartView(), getUser()]);
  return (
    <div className={css.shop}>
      {staff && (
        <div className={css.staffBar} role="region" aria-label="แถบพนักงาน">
          <span>กำลังดูหน้าร้านขณะเข้าสู่ระบบหลังร้านเป็น <strong>{staff.name}</strong></span>
          <Link href={homePath(staff)}>กลับไปหลังร้าน ›</Link>
        </div>
      )}
      <header className={css.head}>
        <div className={css.headIn}>
          <Link href="/" className={css.logo} aria-label="COREPICK หน้าแรก"><Logo height={34} tagline={false} /></Link>
          <form action="/shop" className={css.search} role="search">
            <input name="q" type="search" className="input" placeholder="ค้นหาสินค้า เช่น Ryzen, RTX 4060, SSD 1TB" aria-label="ค้นหาสินค้า" enterKeyHint="search" />
            <button className="btn btn-primary">ค้นหา</button>
          </form>
          <nav className={css.nav} aria-label="เมนูร้าน">
            <Link href="/shop" className={css.navLink}>สินค้าทั้งหมด</Link>
            <Link href="/build" className={css.navLink}>จัดสเปคคอม</Link>
            {me
              ? <Link href="/account" className={css.navLink} title={me.email}>บัญชีของฉัน · {me.name.split(' ')[0]}</Link>
              : <Link href="/account/login" className={css.navLink}>เข้าสู่ระบบ</Link>}
            <Link href="/cart" className={`${css.navLink} ${css.cartLink}`} aria-label={`ตะกร้าสินค้า ${cart.count} ชิ้น`}>
              ตะกร้า{cart.count > 0 && <span className={`${css.badge} tnum`} aria-hidden>{cart.count}</span>}
            </Link>
          </nav>
        </div>
      </header>
      <main className={css.main}>{children}</main>
      <footer className={css.foot}>
        <div className={css.footIn}>
          <div><h2>{SHOP.brand}</h2><p>{SHOP.name}<br />{SHOP.addr}<br />โทร {SHOP.phone}</p></div>
          <div><h2>การจัดส่ง</h2><p>กรุงเทพฯ และปริมณฑลส่งฟรี · ต่างจังหวัด ฿{UPCOUNTRY_FEE}<br />ซื้อครบ ฿{FREE_SHIPPING_MIN.toLocaleString('en-US')} ส่งฟรีทั่วประเทศ</p></div>
          <div><h2>การชำระเงินและประกัน</h2><p>ชำระผ่าน PromptPay QR · ราคารวม VAT 7%<br />สินค้ารับประกันตามระยะที่ระบุ นับจากวันจัดส่ง</p></div>
        </div>
        <div className={css.footStaff}><Link href="/login">ระบบหลังร้านสำหรับพนักงาน</Link></div>
      </footer>
    </div>
  );
}
