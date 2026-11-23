import { test, expect, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { db, loginAs, USERS } from '../helpers';
import { mails } from '../b/shop';

// Storefront live chat: a visitor or customer writes from the chat button, staff answer from หลังร้าน › แชทลูกค้า,
// both sides see new messages without reloading, staff replies are emailed when the customer has left.

const TAG = `E2E แชท ${Date.now().toString(36)}`;
const OUTBOX = process.env.MAIL_OUTBOX_DIR || './storage/outbox';

test.afterAll(async () => {
  await db.chatThread.deleteMany({ where: { OR: [{ guestName: { startsWith: TAG } }, { customer: { email: { startsWith: 'e2e-chat-' } } }] } });
  await db.customer.deleteMany({ where: { email: { startsWith: 'e2e-chat-' } } });
  for (const m of mails().filter(m => m.to.startsWith('e2e-chat-'))) rmSync(path.join(OUTBOX, m.file), { force: true });
});

const panel = (p: Page) => p.getByRole('dialog', { name: 'แชทกับร้าน' });
async function openChat(p: Page) {
  await p.getByRole('button', { name: /^แชทกับร้าน/ }).click();
  await expect(panel(p)).toBeVisible();
}
async function say(p: Page, text: string) {
  await panel(p).getByLabel('ข้อความ').fill(text);
  await panel(p).getByRole('button', { name: 'ส่ง' }).click();
  await expect(panel(p).locator('[data-role="customer"]', { hasText: text })).toBeVisible();
}

test('visitor ↔ staff: name first, live replies both ways, staff close, new conversation after', async ({ page, browser }) => {
  const name = `${TAG} สมศรี`;
  await page.goto('/');
  await openChat(page);
  await panel(page).getByLabel('ข้อความ').fill('สวัสดีค่ะ');
  await panel(page).getByRole('button', { name: 'ส่ง' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('กรุณาบอกชื่อเพื่อให้พนักงานเรียกได้ถูก');
  await panel(page).getByLabel('ชื่อของคุณ').fill(name);
  await say(page, 'RTX 4060 ใส่เคส Q300L ได้ไหมคะ');
  await expect(page.getByTestId('chat-status')).toHaveText('รอพนักงานตอบ…');
  await expect(panel(page).getByLabel('ชื่อของคุณ')).toHaveCount(0); // asked once

  // Staff: waiting queue → open → reply (takes it).
  const sk = await (await browser.newContext()).newPage();
  await loginAs(sk, USERS.storekeeper);
  await sk.goto('/chat');
  const row = sk.locator('tr', { hasText: name });
  await expect(row).toContainText('ใหม่ 1');
  await expect(row).toContainText('RTX 4060 ใส่เคส Q300L ได้ไหมคะ');
  await expect(sk.getByRole('link', { name: /แชทลูกค้า/ }).first()).toBeVisible();
  await row.getByRole('link', { name }).click();
  await expect(sk.getByText('ผู้เยี่ยมชม ไม่ได้เข้าสู่ระบบ', { exact: false })).toBeVisible();
  await sk.getByLabel('คำตอบ').fill('ใส่ได้ครับ การ์ดยาว 192 mm เคสรับได้ 360 mm');
  await sk.getByRole('button', { name: 'ส่ง' }).click();
  await expect(sk.getByTestId('chat-state')).toHaveText('กำลังคุย');

  // Customer sees the reply and who answered — without reloading.
  await expect(panel(page).locator('[data-role="staff"]')).toContainText('ใส่ได้ครับ การ์ดยาว 192 mm');
  await expect(panel(page).locator('[data-role="staff"]')).toContainText('วิภาดา รุ่งเรือง');
  await expect(page.getByTestId('chat-status')).toHaveText('วิภาดา รุ่งเรือง กำลังดูแลคุณ');
  await say(page, 'ขอบคุณค่ะ');
  await expect(sk.locator('[data-role="customer"]', { hasText: 'ขอบคุณค่ะ' })).toBeVisible();

  // The conversation moved from "waiting" to the staff member's own list.
  await sk.goto('/chat?tab=waiting');
  await expect(sk.locator('tr', { hasText: name })).toHaveCount(0);
  await sk.goto('/chat?tab=mine');
  await sk.locator('tr', { hasText: name }).getByRole('link', { name }).click();
  sk.once('dialog', d => d.accept());
  await sk.getByRole('button', { name: 'ปิดแชท' }).click();
  await expect(sk.getByTestId('chat-state')).toHaveText('ปิดแล้ว');
  const t = await db.chatThread.findFirstOrThrow({ where: { guestName: name } });
  expect(await db.auditLog.count({ where: { cat: 'chat', target: t.id, action: 'ปิดแชทลูกค้า' } })).toBe(1);

  // The visitor's next message starts a fresh conversation (name asked again).
  await page.reload();
  await openChat(page);
  await expect(panel(page).getByLabel('ชื่อของคุณ')).toBeVisible();
  await sk.context().close();
});

test('a reply while the customer is away is emailed once, with a link that reopens the chat', async ({ page, browser }) => {
  const name = `${TAG} อีเมล`, email = `e2e-chat-${Date.now()}@e2e.example`;
  await page.goto('/');
  await openChat(page);
  await panel(page).getByLabel('ชื่อของคุณ').fill(name);
  await panel(page).getByLabel('อีเมล').fill(email);
  await say(page, 'สั่งของไปเมื่อวาน ยังไม่ได้เลขพัสดุ');
  await page.close(); // customer leaves
  const t = await db.chatThread.findFirstOrThrow({ where: { guestName: name } });
  await db.chatThread.update({ where: { id: t.id }, data: { customerSeenAt: new Date(Date.now() - 10 * 60e3) } });

  const sk = await (await browser.newContext()).newPage();
  await loginAs(sk, USERS.manager);
  await sk.goto(`/chat/${t.id}`);
  await expect(sk.getByText('ลูกค้าไม่ได้เปิดหน้าแชท', { exact: false })).toBeVisible();
  for (const msg of ['ขอเลขคำสั่งซื้อด้วยครับ', 'หรือเข้าสู่ระบบแล้วดูที่คำสั่งซื้อของฉันได้ครับ']) {
    await sk.getByLabel('คำตอบ').fill(msg);
    await sk.getByRole('button', { name: 'ส่ง' }).click();
    await expect(sk.locator('[data-role="staff"]', { hasText: msg })).toBeVisible();
  }
  const sent = mails().filter(m => m.to === email);
  expect(sent).toHaveLength(1); // one email for a burst of replies
  expect(sent[0].subject).toBe('พนักงาน COREPICK ตอบแชทของคุณแล้ว');
  expect(sent[0].text).toContain('ขอเลขคำสั่งซื้อด้วยครับ');
  expect(sent[0].text).toMatch(/\/\?chat=1/);
  await sk.context().close();
});

test('a signed-in customer’s chat shows their orders to staff; ?chat=1 opens the window', async ({ page, browser }) => {
  const c = await db.customer.create({ data: { email: `e2e-chat-${Date.now()}@e2e.example`, passwordHash: '-', name: 'ทดสอบ แชทสมาชิก' } });
  const token = randomBytes(32).toString('base64url');
  await db.customerSession.create({ data: { id: createHash('sha256').update(token).digest('hex'), customerId: c.id, expiresAt: new Date(Date.now() + 864e5) } });
  await page.context().addCookies([{ name: 'cp_session', value: token, url: test.info().project.use.baseURL || process.env.E2E_BASE_URL || 'http://localhost:3000' }]);

  await page.goto('/?chat=1');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('คุณทดสอบ');
  await expect(panel(page).getByLabel('ชื่อของคุณ')).toHaveCount(0); // members aren't asked for a name
  await say(page, 'อยากเปลี่ยนที่อยู่จัดส่ง');
  const t = await db.chatThread.findFirstOrThrow({ where: { customerId: c.id } });

  const mg = await (await browser.newContext()).newPage();
  await loginAs(mg, USERS.manager);
  await mg.goto(`/chat/${t.id}`);
  await expect(mg.getByRole('link', { name: 'ทดสอบ แชทสมาชิก' })).toHaveAttribute('href', `/customers/${c.id}`);
  await expect(mg.getByText('ยังไม่มีคำสั่งซื้อ')).toBeVisible();
  await mg.getByRole('button', { name: 'รับเรื่อง' }).click();
  await expect(mg.locator('p', { hasText: 'อรุณี ธนากร เข้ามาดูแลบทสนทนานี้' })).toBeVisible();
  await expect(panel(page)).toContainText('อรุณี ธนากร เข้ามาดูแลบทสนทนานี้');

  // Customer can end it themselves.
  page.once('dialog', d => d.accept());
  await panel(page).getByRole('button', { name: 'จบการสนทนา' }).click();
  await expect.poll(async () => (await db.chatThread.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('closed');
  await mg.context().close();
});

test('only staff with the chat menu can read conversations', async ({ page }) => {
  const t = await db.chatThread.create({ data: { guestName: `${TAG} สิทธิ์`, status: 'waiting', messages: { create: { role: 'customer', text: 'ลับ' } } } });
  expect((await page.request.get(`/api/chat/${t.id}`)).status()).toBe(404);
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login/);
  await loginAs(page, USERS.itsupport);
  await page.goto('/chat');
  await expect(page).not.toHaveURL(/\/chat/);
  expect((await page.request.get(`/api/chat/${t.id}`)).status()).toBe(404);
  await loginAs(page, USERS.storekeeper);
  expect((await page.request.get(`/api/chat/${t.id}`)).status()).toBe(200);
  // A visitor without the thread's cookie sees nothing of it.
  const fresh = await page.context().browser()!.newContext();
  const res = await (await fresh.newPage()).request.get('/api/chat');
  expect((await res.json()).thread).toBeNull();
  await fresh.close();
});
