import { test, expect, type Page } from '@playwright/test';
import { db, loginAs, USERS } from '../helpers';
import { cleanupShop, customer, paidOrder, product, stamp } from '../b/shop';

// The chat assistant without AI: answers common questions from the customer's own data and the catalogue, offers
// quick-reply topics, and hands the chat to staff when asked or after two questions it didn't understand.

test.afterAll(cleanupShop); // the test customers go, and their chats with them

const panel = (p: Page) => p.getByRole('dialog', { name: 'แชทกับร้าน' });
const bot = (p: Page) => panel(p).locator('[data-role="bot"]');
async function openChat(p: Page) {
  await p.goto('/');
  await p.getByRole('button', { name: /^แชทกับร้าน/ }).click();
  await expect(panel(p)).toBeVisible();
}
async function ask(p: Page, text: string) {
  const n = await bot(p).count();
  await panel(p).getByLabel('ข้อความ', { exact: true }).fill(text);
  await panel(p).getByRole('button', { name: 'ส่งข้อความ' }).click();
  await expect(bot(p)).toHaveCount(n + 1);
  return bot(p).last();
}
async function tap(p: Page, label: string) {
  const n = await bot(p).count();
  await panel(p).getByRole('group', { name: 'หัวข้อที่ถามบ่อย' }).getByRole('button', { name: label }).click();
  await expect(bot(p)).toHaveCount(n + 1);
  return bot(p).last();
}

test('answers orders, shipping, claims and product questions from real data, with links', async ({ page, browser }) => {
  const s = stamp().toUpperCase();
  const sku = await product(2500, 4, undefined, `E2E การ์ดจอ ${s}`);
  const { id } = await paidOrder(page, { [sku]: 1 });
  await openChat(page);
  await expect(page.getByTestId('chat-status')).toHaveText('ผู้ช่วยอัตโนมัติ · ตอบทันที');

  const order = await tap(page, 'ติดตามคำสั่งซื้อ');
  await expect(order).toContainText(id);
  await expect(order).toContainText('ชำระแล้ว');
  await expect(order).toContainText('ร้านกำลังเตรียมจัดส่ง');
  await expect(order.getByRole('link', { name: `/pay/${id}` })).toHaveAttribute('href', `/pay/${id}`);
  await expect(await ask(page, `ขอสถานะ ${id} หน่อยครับ`)).toContainText('คำสั่งซื้อนี้');
  await expect(await ask(page, 'ORD-2000-000001 ถึงไหนแล้ว')).toContainText('ไม่พบคำสั่งซื้อ ORD-2000-000001 ในบัญชีนี้');

  await expect(await tap(page, 'ค่าส่งและการชำระเงิน')).toContainText('ต่างจังหวัด ฿150.00');
  const claim = await tap(page, 'เคลม / ประกัน');
  await expect(claim).toContainText('ตอนนี้ไม่มีเคลมที่กำลังดำเนินการ');
  await expect(claim.getByRole('link', { name: '/account/claims/new' })).toBeVisible();
  await expect(await tap(page, 'จัดสเปคคอม')).toContainText('/build');

  const found = await ask(page, `มีการ์ดจอ ${s} ไหมครับ ราคาเท่าไหร่`);
  await expect(found).toContainText(`E2E การ์ดจอ ${s} — ฿2,500.00 · เหลือ 3 ชิ้น`);
  await found.getByRole('link', { name: /^\/p\// }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`E2E การ์ดจอ ${s}`);

  // Staff see the chat under "all open" while the assistant handles it — not in the waiting queue.
  const t = await db.chatThread.findFirstOrThrow({ where: { customer: { orders: { some: { id } } } } });
  expect(t.status).toBe('bot');
  const sk = await (await browser.newContext()).newPage();
  await loginAs(sk, USERS.storekeeper);
  await sk.goto('/chat?tab=waiting');
  await expect(sk.locator(`tr[data-chat="${t.id}"]`)).toHaveCount(0);
  await sk.goto('/chat?tab=open');
  await expect(sk.locator(`tr[data-chat="${t.id}"]`)).toContainText('ผู้ช่วยอัตโนมัติกำลังตอบ');
  await sk.context().close();
});

test('two questions it does not understand hand the chat to staff; then the assistant stays quiet', async ({ page, browser }) => {
  await customer(page, {});
  await openChat(page);
  await expect(await ask(page, 'zxqv plmok')).toContainText('ขอโทษครับ ผมยังไม่เข้าใจคำถามนี้');
  await expect(await ask(page, 'qwzx vbnm')).toContainText('ขอส่งต่อให้พนักงานช่วยดู');
  await expect(panel(page).locator('p', { hasText: 'ส่งต่อให้พนักงานแล้ว' })).toBeVisible();
  await expect(page.getByTestId('chat-status')).toHaveText('รอพนักงานตอบ…');
  await expect(panel(page).getByRole('group', { name: 'หัวข้อที่ถามบ่อย' })).toHaveCount(0);

  const t = await db.chatThread.findFirstOrThrow({ where: { status: 'waiting', messages: { some: { text: 'qwzx vbnm' } } } });
  const sk = await (await browser.newContext()).newPage();
  await loginAs(sk, USERS.storekeeper);
  await sk.goto(`/chat/${t.id}`);
  await expect(sk.locator('[data-role="bot"]')).toHaveCount(2); // staff see what the assistant said
  await sk.getByLabel('คำตอบ').fill('สวัสดีครับ มีอะไรให้ช่วยครับ');
  await sk.getByRole('button', { name: 'ส่ง' }).click();
  await expect(panel(page).locator('[data-role="staff"]')).toContainText('มีอะไรให้ช่วยครับ');

  // With a person on the chat, the assistant no longer answers.
  await panel(page).getByLabel('ข้อความ', { exact: true }).fill('ค่าส่งเท่าไหร่ครับ');
  await panel(page).getByRole('button', { name: 'ส่งข้อความ' }).click();
  await expect(panel(page).locator('[data-role="customer"]', { hasText: 'ค่าส่งเท่าไหร่ครับ' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(bot(page)).toHaveCount(2);
  await sk.context().close();
});

test('asking for a person — by button or in words — goes straight to the staff queue', async ({ page, browser }) => {
  const c1 = await customer(page, {});
  await openChat(page);
  await panel(page).getByRole('group', { name: 'หัวข้อที่ถามบ่อย' }).getByRole('button', { name: 'คุยกับพนักงาน' }).click();
  await expect(page.getByTestId('chat-status')).toHaveText('รอพนักงานตอบ…');
  expect((await db.chatThread.findFirstOrThrow({ where: { customerId: c1.id } })).status).toBe('waiting');

  const other = await (await browser.newContext()).newPage();
  const c2 = await customer(other, {});
  await openChat(other);
  await expect(await ask(other, 'ขอคุยกับพนักงานหน่อยครับ')).toContainText('กำลังส่งต่อให้พนักงาน');
  await expect(other.getByTestId('chat-status')).toHaveText('รอพนักงานตอบ…');
  expect((await db.chatThread.findFirstOrThrow({ where: { customerId: c2.id } })).status).toBe('waiting');
  await other.context().close();
});
