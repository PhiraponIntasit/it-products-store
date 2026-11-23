import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../helpers';

// Storefront ↔ back office: nothing on the shop leads customers to the back office (staff open /login themselves);
// a "back to the back office" bar while a staff session is open, "edit in the back office" on a product for people who manage products, and the way back from
// the back office (sidebar, product page). Customers never see the staff bar or the edit link.

test('visitors and customers see no way into the back office', async ({ page }) => {
  await page.goto('/p/cpu-r5-7600');
  await expect(page.getByRole('region', { name: 'แถบพนักงาน' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /แก้ไขสินค้านี้ในหลังร้าน|ระบบหลังร้าน|พนักงาน/ })).toHaveCount(0);
  expect(await page.locator('a[href="/login"]').count()).toBe(0);
  await page.goto('/login');                                     // staff still sign in at /login directly
  await expect(page.locator('#u')).toBeVisible();
});

test('store keeper: back office → storefront → edit the product → back', async ({ page, context }) => {
  await loginAs(page, USERS.storekeeper);
  await page.goto('/products/CPU-R5-7600');
  const [shop] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'ดูหน้าสินค้าบนหน้าร้าน ↗' }).click()]);
  await shop.waitForLoadState();
  await expect(shop).toHaveURL(/\/p\/cpu-r5-7600$/);
  await expect(shop.getByRole('region', { name: 'แถบพนักงาน' })).toContainText('วิภาดา รุ่งเรือง');
  await shop.getByRole('link', { name: /แก้ไขสินค้านี้ในหลังร้าน/ }).click();
  await expect(shop).toHaveURL(/\/products\/CPU-R5-7600$/);
  await shop.goto('/');
  await shop.getByRole('region', { name: 'แถบพนักงาน' }).getByRole('link', { name: 'กลับไปหลังร้าน ›' }).click();
  await expect(shop).toHaveURL(/\/inventory$/);   // the store keeper's home
  await expect(page.getByRole('link', { name: 'เปิดหน้าร้าน ↗' })).toHaveAttribute('href', '/');
});

test('staff without the products menu get the bar but no edit link', async ({ page }) => {
  await loginAs(page, USERS.manager);
  await page.goto('/p/cpu-r5-7600');
  await page.getByRole('region', { name: 'แถบพนักงาน' }).getByRole('link', { name: 'กลับไปหลังร้าน ›' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/p/cpu-r5-7600');
  await expect(page.getByRole('link', { name: /แก้ไขสินค้านี้ในหลังร้าน/ })).toHaveCount(0);
});
