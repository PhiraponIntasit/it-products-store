import { test, expect, type Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { db } from '../helpers';

// Storefront customer sign-up / sign-in / sign-out. Customers are a separate table from staff,
// so a customer session must never open the back office. Accounts here use @e2e-auth.example and are deleted afterwards.
const DOMAIN = '@e2e-auth.example';
const n = Date.now().toString(36);
const PW = 'shop-pass-123';
test.afterAll(async () => { await db.customer.deleteMany({ where: { email: { endsWith: DOMAIN } } }); });

const nav = (page: Page) => page.getByRole('navigation', { name: 'เมนูร้าน' });

async function register(page: Page, f: { name?: string; email: string; phone?: string; password?: string; confirm?: string }) {
  await page.fill('#cr-name', f.name ?? 'ลูกค้า ทดสอบ');
  await page.fill('#cr-email', f.email);
  await page.fill('#cr-phone', f.phone ?? '');
  await page.fill('#cr-password', f.password ?? PW);
  await page.fill('#cr-confirm', f.confirm ?? f.password ?? PW);
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();
}

test('sign up: checks the form, then signs the new customer in', async ({ page }) => {
  const email = `new-${n}${DOMAIN}`;
  await page.goto('/');
  await nav(page).getByRole('link', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/account\/login/);                     // let the navigation settle before the next click
  await page.getByRole('link', { name: 'สมัครสมาชิก' }).click();
  await expect(page).toHaveURL(/\/account\/register/);

  const err = page.locator('form [role=alert]');
  await register(page, { email: 'not-an-email' });
  await expect(err).toHaveText('อีเมลไม่ถูกต้อง');
  await expect(page.locator('#cr-email')).toHaveValue('not-an-email');   // what was typed stays
  await register(page, { email, password: '1234567' });
  await expect(err).toContainText('อย่างน้อย 8');
  await register(page, { email, confirm: 'something-else' });
  await expect(err).toHaveText('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  await register(page, { email, phone: '12345' });
  await expect(err).toContainText('เบอร์โทรไม่ถูกต้อง');

  await register(page, { name: 'สมชาย ใจดี', email: email.toUpperCase(), phone: '081-234-5678' });
  await expect(page).toHaveURL(/\/$/);
  await expect(nav(page).getByRole('link', { name: /บัญชีของฉัน · สมชาย/ })).toBeVisible();
  const c = await db.customer.findUniqueOrThrow({ where: { email } });           // stored lower-case
  expect(c.passwordHash).not.toBe(PW);
  expect(await bcrypt.compare(PW, c.passwordHash)).toBe(true);

  // the same email can't sign up twice
  await nav(page).getByRole('link', { name: /บัญชีของฉัน/ }).click();
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await page.goto('/account/register');
  await register(page, { email });
  await expect(err).toContainText('สมัครสมาชิกแล้ว');
});

test('sign in / out, the account page, and suspended accounts', async ({ page }) => {
  const email = `login-${n}${DOMAIN}`;
  const c = await db.customer.create({ data: { email, name: 'มานะ ทดสอบ', phone: '0812345678', passwordHash: await bcrypt.hash(PW, 10) } });

  await page.goto('/account');
  await expect(page).toHaveURL(/\/account\/login\?next=(%2F|\/)account$/);   // the account page needs a sign-in
  await page.fill('#cl-email', email);
  await page.fill('#cl-password', 'wrong-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.locator('form [role=alert]')).toHaveText('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  await page.fill('#cl-password', PW);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('main')).toContainText(email);
  await expect(page.locator('main')).toContainText('0812345678');

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(nav(page).getByRole('link', { name: 'เข้าสู่ระบบ' })).toBeVisible();
  expect(await db.customerSession.count({ where: { customerId: c.id } })).toBe(0);

  await db.customer.update({ where: { id: c.id }, data: { active: false } });
  await page.goto('/account/login');
  await page.fill('#cl-email', email);
  await page.fill('#cl-password', PW);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.locator('form [role=alert]')).toContainText('ถูกระงับ');
});

test('after signing in: back to checkout, never to another site; no way into the back office', async ({ page }) => {
  const email = `next-${n}${DOMAIN}`;
  await db.customer.create({ data: { email, name: 'ทดสอบ ปลายทาง', passwordHash: await bcrypt.hash(PW, 10) } });
  const signIn = async (next: string) => {
    await page.context().clearCookies();
    await page.goto('/account/login?next=' + encodeURIComponent(next));
    await page.fill('#cl-email', email);
    await page.fill('#cl-password', PW);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  };

  await page.goto('/checkout');
  await page.getByRole('link', { name: 'เข้าสู่ระบบ' }).last().click();
  await expect(page).toHaveURL(/next=(%2F|\/)checkout/);
  await signIn('/checkout');
  await expect(page).toHaveURL(/\/checkout$/);

  for (const bad of ['//evil.example.com', 'https://evil.example.com/', '/\\evil.example.com']) {
    await signIn(bad);
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\/$/);
  }

  // a customer session is not a staff session
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=/);
});
