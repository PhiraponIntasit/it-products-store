// Chat wording shared by the server assistant and the storefront widget.

/** Quick-reply buttons under the conversation while the assistant is answering (each sends its label as a message). */
export const QUICK_REPLIES = ['ติดตามคำสั่งซื้อ', 'เคลม / ประกัน', 'ค่าส่งและการชำระเงิน', 'จัดสเปคคอม', 'ค้นหาสินค้า'] as const;
/** The button that hands the chat to staff straight away. */
export const ASK_STAFF = 'คุยกับพนักงาน';

/** Splits a message into text and links: shop paths (/p/…, /pay/…, /account/…, /build, /shop…) and http(s) URLs. */
export function linkParts(text: string): { text: string; href?: string }[] {
  const re = /(https?:\/\/[^\s]+|\/(?:p|pay|account|build|shop|cart)(?:[/?][^\s]*)?)(?=\s|$)/g;
  const out: { text: string; href?: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > 0 && !/\s/.test(text[i - 1])) continue; // part of a word, e.g. "TB/s"
    if (i > at) out.push({ text: text.slice(at, i) });
    out.push({ text: m[0], href: m[0] });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
