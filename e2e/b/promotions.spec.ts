import { test, expect, type Page } from '@playwright/test';
import { db, loginAs, USERS } from '../helpers';
import { checkout, cleanupShop, customer, product, stamp } from './shop';

// Promotions: a flash sale set up in the back office changes the price everywhere — card, product page (with the
// countdown), cart, checkout and the order line actually charged — and switching it off (or its end) restores the
// normal price. Banners and coupons marked "show on shop" appear on the home page.

const made: string[] = [];
test.afterAll(async () => {
  await db.promotion.deleteMany({ where: { id: { in: made } } });
  await db.promotion.deleteMany({ where: { title: { startsWith: 'E2E ' } } });
  await cleanupShop();
});

const local = (d: Date) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 16); // Asia/Bangkok wall clock for datetime-local

async function newFlash(page: Page, title: string, sku: string, sale: string, ends = new Date(Date.now() + 2 * 864e5)) {
  await page.goto('/coupons?tab=promotions');
  await page.getByRole('button', { name: '+ Flash sale' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#pm-title').fill(title);
  await dlg.locator('#pm-startsAt').fill(local(new Date(Date.now() - 3600e3)));
  await dlg.locator('#pm-endsAt').fill(local(ends));
  await dlg.getByLabel('เลือกสินค้าเข้า Flash sale').selectOption(sku);
  await dlg.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
  await dlg.getByLabel(/^ราคาลด /).fill(sale);
  await dlg.getByRole('button', { name: 'บันทึก' }).click();
  return dlg;
}

test('a flash sale is the price shown and charged; switching it off restores the normal price', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const s = stamp().toUpperCase(), name = `E2E SSD โปร ${s}`, title = `E2E Flash ${s}`;
  const sku = await product(2000, 5, undefined, name);
  await db.inventoryItem.update({ where: { sku }, data: { slug: sku.toLowerCase() } });
  await loginAs(page, USERS.manager);

  // Back office: a sale price at or above the normal price is refused, then 1,500 is saved.
  let dlg = await newFlash(page, title, sku, '2000');
  await expect(dlg.getByText('ต้องต่ำกว่าราคาปกติ')).toBeVisible();
  await dlg.getByLabel(/^ราคาลด /).fill('1500');
  await dlg.getByRole('button', { name: 'บันทึก' }).click();
  await expect(dlg).toBeHidden();
  const row = page.locator(`tr[data-promo="${title}"]`);
  await expect(row).toContainText('กำลังจัด');
  await expect(row).toContainText('฿2,000 → ฿1,500 (−25%)');
  made.push((await db.promotion.findFirstOrThrow({ where: { title } })).id);

  // Storefront: card and product page show the sale with the countdown.
  const shop = await (await browser.newContext()).newPage();
  await shop.goto(`/shop?q=${encodeURIComponent(s)}`);
  const card = shop.locator(`[data-sku="${sku}"]`);
  await expect(card).toContainText('FLASH SALE');
  await expect(card).toContainText('−25%');
  await expect(card).toContainText('฿1,500.00');
  await expect(card).toContainText('฿2,000.00');
  await shop.goto(`/p/${sku.toLowerCase()}`);
  await expect(shop.getByTestId('flash-note')).toContainText('ราคานี้สิ้นสุดใน');
  await expect(shop.getByRole('timer')).toHaveAttribute('aria-label', /เหลือเวลา [12] วัน/);

  // Cart and checkout charge the sale price; the order line keeps it.
  await customer(shop, { [sku]: 2 });
  await shop.goto('/cart');
  await expect(shop.locator('main')).toContainText('฿3,000.00');
  const id = await checkout(shop, 'กรุงเทพมหานคร');
  const order = await db.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  expect(order.lines.map(l => [l.sku, Number(l.price), l.qty])).toEqual([[sku, 1500, 2]]);
  expect(Number(order.total)).toBe(3000);

  // Switch it off → normal price again everywhere.
  await row.getByRole('button', { name: `ปิด ${title}` }).click();
  await expect(row).toContainText('ปิดอยู่');
  await shop.goto(`/p/${sku.toLowerCase()}`);
  await expect(shop.getByTestId('flash-note')).toHaveCount(0);
  await expect(shop.locator('main')).toContainText('฿2,000.00');
  expect(await db.auditLog.count({ where: { cat: 'coupon', target: title, action: { in: ['สร้างโปรโมชั่น', 'ปิดโปรโมชั่น'] } } })).toBe(2);
  await shop.context().close();
});

test('a flash sale that has ended no longer changes the price', async ({ page }) => {
  const s = stamp().toUpperCase(), name = `E2E เมาส์ โปรจบ ${s}`;
  const sku = await product(990, 3, undefined, name);
  await db.inventoryItem.update({ where: { sku }, data: { slug: sku.toLowerCase() } });
  const p = await db.promotion.create({ data: { kind: 'flash', title: `E2E จบแล้ว ${s}`, startsAt: new Date(Date.now() - 3 * 864e5), endsAt: new Date(Date.now() - 60e3), items: { create: { sku, salePrice: 500 } } } });
  made.push(p.id);
  await page.goto(`/p/${sku.toLowerCase()}`);
  await expect(page.getByTestId('flash-note')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('฿990.00');
});

test('home page: banners, the running flash sale and coupons marked for the shop', async ({ page }) => {
  const s = stamp().toUpperCase();
  const b = await db.promotion.create({ data: { kind: 'banner', title: `E2E แบนเนอร์ ${s}`, subtitle: 'ทดสอบ', link: '/build', sort: 0, startsAt: new Date(Date.now() - 3600e3), endsAt: new Date(Date.now() + 3600e3) } });
  made.push(b.id);
  const code = `E2E${s}`.slice(0, 20);
  await db.coupon.create({ data: { code, kind: 'fixed', value: 100, minSpend: 1000, startsAt: new Date(Date.now() - 864e5), endsAt: new Date(Date.now() + 864e5), showOnShop: true } });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const carousel = page.getByRole('region', { name: 'โปรโมชั่น' });
    await carousel.getByRole('button', { name: new RegExp(`E2E แบนเนอร์ ${s}`) }).click();
    await carousel.getByRole('link', { name: new RegExp(`E2E แบนเนอร์ ${s}`) }).click();
    await expect(page).toHaveURL(/\/build$/);
    await page.goto('/');
    await expect(page.locator(`[data-coupon="${code}"]`)).toContainText('ลด ฿100');
    // the seeded flash sale is running: its section has a countdown and sale cards
    const flash = page.locator('#flash');
    await expect(flash.getByRole('timer')).toBeVisible();
    await expect(flash.locator('[data-sku]').first()).toContainText('FLASH SALE');
  } finally {
    await db.coupon.delete({ where: { code } });
  }
});

test('banner links must stay inside the shop', async ({ page }) => {
  await loginAs(page, USERS.manager);
  await page.goto('/coupons?tab=promotions');
  await page.getByRole('button', { name: '+ แบนเนอร์' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#pm-title').fill(`E2E ลิงก์ ${stamp()}`);
  await dlg.locator('#pm-startsAt').fill(local(new Date()));
  await dlg.locator('#pm-endsAt').fill(local(new Date(Date.now() + 864e5)));
  await dlg.locator('#pm-link').fill('https://evil.example.com');
  await dlg.getByRole('button', { name: 'บันทึก' }).click();
  await expect(dlg.getByText('ลิงก์ต้องเป็นหน้าในร้าน')).toBeVisible();
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

test('brand tiles lead to that brand; the staff icon shows only with a back-office session', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'แบรนด์' }).getByRole('link', { name: 'สินค้าแบรนด์ AMD' }).click();
  await expect(page).toHaveURL(/\/shop\?brand=amd$/);
  await expect(page.locator('[data-sku="CPU-R5-7600"]')).toBeVisible();
  const staffIcon = page.getByRole('navigation', { name: 'เมนูร้าน' }).getByRole('link', { name: 'พนักงาน · ระบบหลังร้าน' });
  await expect(staffIcon).toHaveCount(0);                       // visitors and customers: no way in from the shop
  await loginAs(page, USERS.storekeeper);
  await page.goto('/');
  await staffIcon.click();
  await expect(page).toHaveURL(/\/inventory$/);                 // straight back to their back-office home
});

test('a poster uploaded for a banner shows on the home page; a brand logo replaces its wordmark', async ({ page }) => {
  const s = stamp().toUpperCase(), title = `E2E โปสเตอร์ ${s}`;
  const b = await db.promotion.create({ data: { kind: 'banner', title, link: '/shop', sort: 0, startsAt: new Date(Date.now() - 3600e3), endsAt: new Date(Date.now() + 3600e3) } });
  made.push(b.id);
  await loginAs(page, USERS.manager);
  await page.goto('/coupons?tab=promotions');
  await page.getByLabel(`โปสเตอร์ ${title}`).setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: `โปสเตอร์ ${title}` })).toBeVisible();
  await page.goto('/');
  const poster = page.getByRole('region', { name: 'โปรโมชั่น' }).locator(`img[alt="${title}"]`);   // may be a slide not on screen yet
  await expect(poster).toHaveCount(1);
  const src = await poster.getAttribute('src');
  expect((await page.request.get(src!)).headers()['content-type']).toBe('image/png');

  await loginAs(page, USERS.storekeeper);
  await page.goto('/products/catalog');
  await page.getByLabel('โลโก้ TeamGroup').setInputFiles({ name: 'teamgroup.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'โลโก้ TeamGroup' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'สินค้าแบรนด์ TeamGroup' }).locator('img')).toHaveCount(1);
  // put it back as it was
  await page.goto('/products/catalog');
  await page.getByRole('button', { name: 'ลบโลโก้ TeamGroup' }).click();
  await expect(page.getByRole('img', { name: 'โลโก้ TeamGroup' })).toHaveCount(0);
});

test('seeded posters and logos: a tall side poster beside the slides, brand logos that lead to the brand', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const side = page.getByRole('link', { name: 'จัดสเปคเองไม่ต้องกลัวพลาด' });
  await expect(side.locator('img')).toHaveCount(1);
  const slides = page.getByRole('region', { name: 'โปรโมชั่น' });
  await expect(slides.locator('img[alt="การ์ดจอรุ่นใหม่ RTX 50 Series"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'สินค้าแบรนด์ MSI' }).locator('img')).toHaveCount(1);
  await side.click();
  await expect(page).toHaveURL(/\/build$/);
  await page.goto('/');
  await page.getByRole('link', { name: 'สินค้าแบรนด์ MSI' }).click();
  await expect(page).toHaveURL(/\/shop\?brand=msi$/);
});
