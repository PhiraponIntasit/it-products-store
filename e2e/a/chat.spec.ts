import { test, expect, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db, loginAs, USERS } from '../helpers';
import { mails } from '../b/shop';

// Storefront live chat (signed-in customers only): a visitor is sent to sign in and comes back with the chat open;
// staff answer from หลังร้าน › แชทลูกค้า; both sides see new messages without reloading; replies are emailed when the
// customer has left the page.

const P = 'e2e-chat-';
const OUTBOX = process.env.MAIL_OUTBOX_DIR || './storage/outbox';
const PASSWORD = 'chat-pass-1234';

test.afterAll(async () => {
  await db.customer.deleteMany({ where: { email: { startsWith: P } } }); // conversations go with the account
  for (const m of mails().filter(m => m.to.startsWith(P))) rmSync(path.join(OUTBOX, m.file), { force: true });
});

async function makeCustomer(name: string) {
  return db.customer.create({ data: { email: `${P}${Date.now()}-${Math.floor(Math.random() * 1e4)}@e2e.example`, passwordHash: await bcrypt.hash(PASSWORD, 4), name } });
}
async function signIn(p: Page, email: string) {
  await p.fill('#cl-email', email);
  await p.fill('#cl-password', PASSWORD);
  await p.press('#cl-password', 'Enter');
}

const panel = (p: Page) => p.getByRole('dialog', { name: 'แชทกับร้าน' });
async function openChat(p: Page) {
  await p.getByRole('button', { name: /^แชทกับร้าน/ }).click();
  await expect(panel(p)).toBeVisible();
}
async function say(p: Page, text: string) {
  await panel(p).getByLabel('ข้อความ', { exact: true }).fill(text);
  await panel(p).getByRole('button', { name: 'ส่งข้อความ' }).click();
  await expect(panel(p).locator('[data-role="customer"]', { hasText: text })).toBeVisible();
}

test('visitor must sign in, comes back with the chat open; live replies both ways; staff close', async ({ page, browser }) => {
  const c = await makeCustomer('สมศรี แชทดี');
  await page.goto('/shop?cat=vga');
  await openChat(page);
  await expect(panel(page).getByLabel('ข้อความ', { exact: true })).toHaveCount(0); // no way to write before signing in
  await expect(page.getByTestId('chat-status')).toHaveText('สำหรับสมาชิก');
  await panel(page).getByRole('link', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/account\/login\?next=/);
  await signIn(page, c.email);
  await expect(page).toHaveURL(/\/shop\?cat=vga&chat=1$/); // same page, chat reopened
  await expect(panel(page)).toContainText('สวัสดีครับ คุณสมศรี');
  await say(page, 'RTX 4060 ใส่เคส Q300L ได้ไหมคะ');
  await panel(page).getByRole('button', { name: 'คุยกับพนักงาน' }).click(); // the assistant answers first; ask for a person
  await expect(page.getByTestId('chat-status')).toHaveText('รอพนักงานตอบ…');

  // Staff: waiting queue → open → reply (takes it).
  const sk = await (await browser.newContext()).newPage();
  await loginAs(sk, USERS.storekeeper);
  await sk.goto('/chat');
  const row = sk.locator('tr', { hasText: 'สมศรี แชทดี' });
  await expect(row).toContainText('ใหม่ 1');
  await expect(row).toContainText('ผู้ช่วย:'); // preview = last message from a person or the assistant
  await row.getByRole('link', { name: 'สมศรี แชทดี' }).click();
  await expect(sk.getByText(c.email)).toBeVisible();
  await sk.getByLabel('คำตอบ').fill('ใส่ได้ครับ การ์ดยาว 192 mm เคสรับได้ 360 mm');
  await sk.getByRole('button', { name: 'ส่ง' }).click();
  await expect(sk.getByTestId('chat-state')).toHaveText('กำลังคุย');

  // Customer sees the reply and who answered — without reloading.
  await expect(panel(page).locator('[data-role="staff"]')).toContainText('ใส่ได้ครับ การ์ดยาว 192 mm');
  await expect(panel(page).locator('[data-role="staff"]')).toContainText('วิภาดา รุ่งเรือง');
  await expect(page.getByTestId('chat-status')).toHaveText('วิภาดา รุ่งเรือง กำลังดูแลคุณ');
  await say(page, 'ขอบคุณค่ะ');
  await expect(sk.locator('[data-role="customer"]', { hasText: 'ขอบคุณค่ะ' })).toBeVisible();

  // It moved from "waiting" to the staff member's own list; closing is audited.
  await sk.goto('/chat?tab=waiting');
  await expect(sk.locator('tr', { hasText: 'สมศรี แชทดี' })).toHaveCount(0);
  await sk.goto('/chat?tab=mine');
  await sk.locator('tr', { hasText: 'สมศรี แชทดี' }).getByRole('link', { name: 'สมศรี แชทดี' }).click();
  sk.once('dialog', d => d.accept());
  await sk.getByRole('button', { name: 'ปิดแชท' }).click();
  await expect(sk.getByTestId('chat-state')).toHaveText('ปิดแล้ว');
  const t = await db.chatThread.findFirstOrThrow({ where: { customerId: c.id } });
  expect(await db.auditLog.count({ where: { cat: 'chat', target: t.id, action: 'ปิดแชทลูกค้า' } })).toBe(1);
  await expect(panel(page)).toContainText('วิภาดา รุ่งเรือง ปิดบทสนทนา');

  // The ended conversation stays visible (no "end" button); the next message starts a new one.
  await page.goto('/');
  await openChat(page);
  await expect(panel(page)).toContainText('วิภาดา รุ่งเรือง ปิดบทสนทนา');
  await expect(panel(page).getByRole('button', { name: 'จบการสนทนา' })).toHaveCount(0);
  await panel(page).getByLabel('ข้อความ', { exact: true }).fill('มีอีกเรื่องค่ะ');
  await panel(page).getByRole('button', { name: 'ส่งข้อความ' }).click();
  await expect(panel(page).locator('[data-role="customer"]')).toHaveText(['มีอีกเรื่องค่ะ'].map(t => new RegExp(t))); // fresh list
  await expect(page.getByTestId('chat-status')).toHaveText('ผู้ช่วยอัตโนมัติ · ตอบทันที'); // a new chat starts with the assistant
  expect(await db.chatThread.count({ where: { customerId: c.id } })).toBe(2);
  await sk.context().close();
});

test('a reply while the customer is away is emailed once, with a link that reopens the chat', async ({ page, browser }) => {
  const c = await makeCustomer('ทดสอบ อีเมลแชท');
  await page.goto('/account/login?next=%2F%3Fchat%3D1');
  await signIn(page, c.email);
  await expect(panel(page)).toBeVisible();
  await say(page, 'สั่งของไปเมื่อวาน ยังไม่ได้เลขพัสดุ');
  await page.close(); // customer leaves
  const t = await db.chatThread.findFirstOrThrow({ where: { customerId: c.id } });
  await db.chatThread.update({ where: { id: t.id }, data: { customerSeenAt: new Date(Date.now() - 10 * 60e3) } });

  const mg = await (await browser.newContext()).newPage();
  await loginAs(mg, USERS.manager);
  await mg.goto(`/chat/${t.id}`);
  await expect(mg.getByText('ลูกค้าไม่ได้เปิดหน้าแชท', { exact: false })).toBeVisible();
  await expect(mg.locator('aside').getByText('ยังไม่มีคำสั่งซื้อ')).toBeVisible();
  await expect(mg.getByRole('link', { name: 'ทดสอบ อีเมลแชท' })).toHaveAttribute('href', `/customers/${c.id}`);
  for (const msg of ['ขอเลขคำสั่งซื้อด้วยครับ', 'หรือดูได้ที่บัญชีของฉัน › คำสั่งซื้อครับ']) {
    await mg.getByLabel('คำตอบ').fill(msg);
    await mg.getByRole('button', { name: 'ส่ง' }).click();
    await expect(mg.locator('[data-role="staff"]', { hasText: msg })).toBeVisible();
  }
  const sent = mails().filter(m => m.to === c.email);
  expect(sent).toHaveLength(1); // one email for a burst of replies
  expect(sent[0].subject).toBe('พนักงาน COREPICK ตอบแชทของคุณแล้ว');
  expect(sent[0].text).toContain('ขอเลขคำสั่งซื้อด้วยครับ');
  expect(sent[0].text).toMatch(/\/\?chat=1/);
  await mg.context().close();
});

test('take shows the customer who is answering; the customer can end the chat', async ({ page, browser }) => {
  const c = await makeCustomer('ทดสอบ รับเรื่อง');
  await page.goto('/account/login?next=%2F%3Fchat%3D1');
  await signIn(page, c.email);
  await say(page, 'อยากเปลี่ยนที่อยู่จัดส่ง');
  const t = await db.chatThread.findFirstOrThrow({ where: { customerId: c.id } });

  const mg = await (await browser.newContext()).newPage();
  await loginAs(mg, USERS.manager);
  await mg.goto(`/chat/${t.id}`);
  await mg.getByRole('button', { name: 'รับเรื่อง' }).click();
  await expect(mg.locator('p', { hasText: 'อรุณี ธนากร เข้ามาดูแลบทสนทนานี้' })).toBeVisible();
  await expect(panel(page)).toContainText('อรุณี ธนากร เข้ามาดูแลบทสนทนานี้');
  page.once('dialog', d => d.accept());
  await panel(page).getByRole('button', { name: 'จบการสนทนา' }).click();
  await expect.poll(async () => (await db.chatThread.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('closed');
  await mg.context().close();
});

test('only signed-in customers chat, and only staff with the chat menu can read conversations', async ({ page }) => {
  const c = await makeCustomer('ทดสอบ สิทธิ์แชท');
  const t = await db.chatThread.create({ data: { customerId: c.id, status: 'waiting', messages: { create: { role: 'customer', text: 'ลับ' } } } });
  expect(await (await page.request.get('/api/chat')).json()).toMatchObject({ signedIn: false, thread: null, messages: [] });
  expect((await page.request.get(`/api/chat/${t.id}`)).status()).toBe(404);
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login/);
  await loginAs(page, USERS.itsupport);
  await page.goto('/chat');
  await expect(page).not.toHaveURL(/\/chat/);
  expect((await page.request.get(`/api/chat/${t.id}`)).status()).toBe(404);
  await loginAs(page, USERS.storekeeper);
  expect((await page.request.get(`/api/chat/${t.id}`)).status()).toBe(200);
});
