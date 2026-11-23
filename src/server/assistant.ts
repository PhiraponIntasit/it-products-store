import 'server-only';
import { db, num } from './db';
import { listProducts, readShopFilter } from './storefront';
import { ORDER_ST } from './orders';
import { CLAIM_ST, OPEN_CLAIM } from './claims';
import { baht, fmtD } from '@/lib/domain';
import { FREE_SHIPPING_MIN, UPCOUNTRY_FEE } from '@/lib/shipping';
import { SHOP } from '@/lib/shop';

// The storefront chat assistant without AI (person A): free, always on. It recognises common questions by keywords and
// answers from the shop's own data — the customer's orders and claims, products in stock, shipping and payment rules.
// It never changes anything. When it can't help (asked for a person, or two questions in a row it didn't understand)
// it hands the conversation to staff. A Claude-backed assistant can replace `ruleReply` later with the same contract.

export type AssistantReply = { text: string; handoff?: boolean; miss?: boolean };

/** Start of the "didn't understand" answer — two in a row hand the chat to staff. */
export const MISS = 'ขอโทษครับ ผมยังไม่เข้าใจคำถามนี้';

const has = (s: string, words: string[]) => words.some(w => s.includes(w));
// Polite endings and filler that carry no meaning for a product search.
const FILLER = /(ครับ|ค่ะ|คะ|ค่า|นะ|จ้า|จ้ะ|หน่อย|ไหม|มั้ย|มั๊ย|มีขาย|มี|ขาย|ราคา|เท่าไหร่|เท่าไร|กี่บาท|ขอ|อยากได้|อยาก|หา|ค้นหา|สินค้า|ตัว|รุ่น|ของ|ร้าน|บ้าง|ยัง|ได้|ไหน|แนะนำ|\?|\.|,)/g;

export async function ruleReply(customerId: string, textIn: string): Promise<AssistantReply> {
  const raw = textIn.trim();
  const t = raw.toLowerCase();

  if (has(t, ['พนักงาน', 'แอดมิน', 'admin', 'เจ้าหน้าที่', 'คุยกับคน', 'ติดต่อคน', 'ขอคน'])) {
    return { text: 'ได้เลยครับ กำลังส่งต่อให้พนักงาน พนักงานจะตอบในหน้าต่างนี้ (ถ้าปิดหน้าเว็บไปก่อน จะแจ้งทางอีเมล)', handoff: true };
  }

  const orderId = raw.toUpperCase().match(/ORD-\d{4}-\d{6}/)?.[0];
  if (orderId || has(t, ['คำสั่งซื้อ', 'ออเดอร์', 'order', 'พัสดุ', 'ติดตาม', 'tracking', 'ส่งของ', 'ของถึง', 'ยังไม่ได้ของ'])) {
    return orderReply(customerId, orderId);
  }
  const claimId = raw.toUpperCase().match(/CLM-\d{4}-\d{6}/)?.[0];
  if (claimId || has(t, ['เคลม', 'ประกัน', 'เสีย', 'ซ่อม', 'warranty', 'claim', 'เปิดไม่ติด', 'พัง'])) {
    return claimReply(customerId, claimId);
  }
  if (has(t, ['ค่าส่ง', 'ส่งฟรี', 'จัดส่ง', 'กี่วัน', 'ชำระ', 'จ่ายเงิน', 'โอน', 'พร้อมเพย์', 'promptpay', 'qr', 'ผ่อน', 'บัตรเครดิต', 'เก็บเงินปลายทาง', 'cod'])) {
    return { text: [
      `การจัดส่ง: กรุงเทพฯ และปริมณฑลส่งฟรี · ต่างจังหวัด ${baht(UPCOUNTRY_FEE)} · ซื้อครบ ${baht(FREE_SHIPPING_MIN)} ส่งฟรีทั่วประเทศ`,
      'ชำระเงิน: สแกน PromptPay QR ตามยอดจริงในหน้าชำระเงิน (ต้องชำระภายใน 15 นาที ไม่งั้นระบบคืนสต็อก) ยังไม่รับเก็บเงินปลายทางหรือผ่อนบัตร',
      'ร้านแพ็กและจัดส่งหลังได้รับเงิน ใส่เลขพัสดุให้ดูได้ที่ บัญชีของฉัน › คำสั่งซื้อ /account/orders',
    ].join('\n') };
  }
  if (has(t, ['จัดสเปค', 'ประกอบคอม', 'สเปคคอม', 'เข้ากันได้', 'ใช้ด้วยกัน', 'ใส่กันได้', 'compatible', 'socket', 'วัตต์', 'พาวเวอร์พอ'])) {
    return { text: 'ลองหน้า จัดสเปคคอม ครับ /build เลือกทีละชิ้น ระบบเช็กให้ว่า Socket ชนิดแรม ขนาดเคส ความยาวการ์ดจอ และกำลังไฟเข้ากันไหม แล้วใส่ตะกร้าได้ทั้งชุด ถ้าอยากให้พนักงานช่วยจัดสเปคตามงบ พิมพ์ "คุยกับพนักงาน"' };
  }
  if (has(t, ['ขอบคุณ', 'thank', 'ขอบใจ'])) return { text: 'ยินดีครับ มีอะไรถามต่อได้เลย 😊' };
  if (t.length <= 12 && has(t, ['สวัสดี', 'หวัดดี', 'hello', 'hi', 'ดีครับ', 'ดีค่ะ'])) {
    return { text: 'สวัสดีครับ ผมเป็นผู้ช่วยอัตโนมัติของ COREPICK ถามเรื่องคำสั่งซื้อ เคลม/ประกัน ค่าส่ง จัดสเปค หรือพิมพ์ชื่อสินค้าที่หาอยู่ได้เลย หรือกด "คุยกับพนักงาน"' };
  }
  if (t === 'ค้นหาสินค้า') return { text: 'พิมพ์ชื่อหรือรุ่นที่หาได้เลยครับ เช่น "RTX 4060" "Ryzen 5" "SSD 1TB"' };

  const found = await productReply(raw);
  if (found) return found;
  return { text: `${MISS} ลองพิมพ์ใหม่ หรือเลือกหัวข้อด้านล่าง ถ้ายังไม่ตรง ผมจะส่งต่อให้พนักงานครับ`, miss: true };
}

async function orderReply(customerId: string, orderId?: string): Promise<AssistantReply> {
  const orders = await db.order.findMany({
    where: { customerId, ...(orderId ? { id: orderId } : {}) }, orderBy: { createdAt: 'desc' }, take: 3,
    select: { id: true, status: true, total: true, createdAt: true, carrier: true, trackingNo: true, expiresAt: true },
  });
  if (orderId && !orders.length) return { text: `ไม่พบคำสั่งซื้อ ${orderId} ในบัญชีนี้ครับ ดูทั้งหมดได้ที่ /account/orders` };
  if (!orders.length) return { text: 'บัญชีนี้ยังไม่มีคำสั่งซื้อครับ เลือกซื้อสินค้าได้ที่ /shop' };
  const lines = orders.map(o => {
    const st = ORDER_ST[o.status]?.[0] ?? o.status;
    const more = o.status === 'pending_payment' ? ` · ชำระภายใน ${o.expiresAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`
      : o.trackingNo ? ` · ${o.carrier ?? ''} ${o.trackingNo}`.replace(' · ', ' · เลขพัสดุ ') : o.status === 'paid' || o.status === 'packing' ? ' · ร้านกำลังเตรียมจัดส่ง' : '';
    return `• ${o.id} (${fmtD(o.createdAt)}) ${baht(num(o.total))} — ${st}${more}\n  รายละเอียด /pay/${o.id}`;
  });
  return { text: `${orderId ? 'คำสั่งซื้อนี้' : 'คำสั่งซื้อล่าสุดของคุณ'}:\n${lines.join('\n')}${orderId ? '' : '\nดูทั้งหมดที่ /account/orders'}` };
}

async function claimReply(customerId: string, claimId?: string): Promise<AssistantReply> {
  const claims = await db.claim.findMany({
    where: { customerId, ...(claimId ? { id: claimId } : { status: { in: [...OPEN_CLAIM] } }) }, orderBy: { createdAt: 'desc' }, take: 3,
    select: { id: true, status: true, serial: true, staffNote: true },
  });
  const how = 'แจ้งเคลมได้ที่ /account/claims/new เลือกเครื่องจากคำสั่งซื้อ (สินค้าที่มี Serial และยังอยู่ในประกัน) แล้วส่งของมาที่ร้านพร้อมเขียนเลขเคลมหน้ากล่อง';
  if (claimId && !claims.length) return { text: `ไม่พบเคลม ${claimId} ในบัญชีนี้ครับ ดูทั้งหมดที่ /account/claims` };
  if (!claims.length) return { text: `ตอนนี้ไม่มีเคลมที่กำลังดำเนินการครับ\n${how}\nที่อยู่ส่งเครื่อง: ${SHOP.name} ${SHOP.addr}` };
  const lines = claims.map(c => `• ${c.id} Serial ${c.serial} — ${CLAIM_ST[c.status]?.[0] ?? c.status}${c.staffNote ? ` (${c.staffNote})` : ''}`);
  return { text: `เคลมของคุณ:\n${lines.join('\n')}\nติดตามรายละเอียดที่ /account/claims\nถ้าจะเคลมเครื่องอื่น: ${how}` };
}

async function productReply(raw: string): Promise<AssistantReply | null> {
  const q = raw.replace(FILLER, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return null;
  const search = async (query: string) => (await listProducts(readShopFilter({ q: query }), undefined)).rows;
  let rows = await search(q);
  if (!rows.length) {
    // Every word must match in the catalogue search; retry with the longest single word ("rtx4060" → try as typed).
    const words = q.split(' ').filter(w => w.length >= 3).sort((a, b) => b.length - a.length);
    for (const w of words) { rows = await search(w); if (rows.length) break; }
  }
  if (!rows.length) return null;
  const top = [...rows].sort((a, b) => (b.available > 0 ? 1 : 0) - (a.available > 0 ? 1 : 0)).slice(0, 3);
  const lines = top.map(p => `• ${p.name} — ${baht(p.price)} · ${p.available > 0 ? (p.available <= 3 ? `เหลือ ${p.available} ชิ้น` : 'มีสินค้า') : 'สินค้าหมด'}\n  /p/${p.slug}`);
  return { text: `เจอสินค้าที่ตรงกับ "${q}":\n${lines.join('\n')}${rows.length > 3 ? `\nดูทั้งหมด ${rows.length} รายการที่ /shop?q=${encodeURIComponent(q)}` : ''}` };
}
