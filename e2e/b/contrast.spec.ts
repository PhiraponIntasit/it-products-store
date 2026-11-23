import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../helpers';

// Text contrast, measured in the browser: every visible text element on the main pages, in light and dark mode,
// against the background actually behind it (translucent layers and opacity blended). WCAG AA is the floor
// (4.5:1, large text 3:1); the theme aims for 7:1 on body text. A new pale grey anywhere fails here.

type Hit = { el: string; text: string; cr: number; large: boolean; fg: string; bg: string };

/** Runs inside the page. */
function measure(): Hit[] {
  type C = [number, number, number, number];
  const parse = (c: string): C => {
    const k = c.match(/color\(srgb ([^)]+)\)/);
    if (k) { const p = k[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top: C, bot: C): C => {
    const a = top[3] + bot[3] * (1 - top[3]);
    if (!a) return [0, 0, 0, 0];
    const ch = (i: number) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a;
    return [ch(0), ch(1), ch(2), a];
  };
  const lum = (c: C) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a: C, b: C) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el: Element): C => {
    const stack: C[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; }
    let bg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (bg[3] < 1) bg = over(bg, [255, 255, 255, 1]);
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  };
  const out: Hit[] = [], seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement, txt = (walker.currentNode.textContent ?? '').trim();
    if (!txt || !el || seen.has(el) || el.closest('svg,script,style,noscript,option')) continue;
    seen.add(el);
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || !r.height || s.visibility === 'hidden') continue;
    if (el.closest('button:disabled, [disabled], [aria-disabled]')) continue; // inactive controls are exempt (WCAG 1.4.3)
    let op = 1;
    for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const bg = bgOf(el), f0 = parse(s.color), fg = over([f0[0], f0[1], f0[2], f0[3] * op], bg);
    const size = parseFloat(s.fontSize), large = size >= 24 || (Number(s.fontWeight) >= 600 && size >= 18.66);
    out.push({ el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''),
      text: txt.slice(0, 40), cr: Math.round(ratio(fg, bg) * 100) / 100, large, fg: fg.slice(0, 3).map(Math.round).join(','), bg: bg.slice(0, 3).map(Math.round).join(',') });
  }
  return out;
}

const PAGES = ['/dashboard', '/sales?p=90d', '/inventory', '/products', '/products/CPU-R5-7600', '/orders?tab=all', '/coupons', '/customers', '/customers/cus-demo', '/chat', '/claims',
  '/warranty?q=CPU-R5-7600-SN0001', '/purchase', '/purchase/suppliers', '/approvals', '/users', '/audit',
  '/', '/shop', '/shop?cat=cpu', '/p/cpu-r5-7600', '/account/login', '/account/register', '/cart', '/build?cpu=CPU-I5-14400F&mainboard=MB-TUF-B650&pick=ram'];

for (const theme of ['light', 'dark'] as const) {
  test(`text contrast meets WCAG AA on every main page (${theme})`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const bad: string[] = [];
    let n = 0;
    const check = async (path: string) => {
      await page.goto(path);
      await page.waitForTimeout(150);
      const rows = await page.evaluate(measure);
      n += rows.length;
      for (const r of rows) if (r.cr < (r.large ? 3 : 4.5)) bad.push(`${path} ${r.el} "${r.text}" ${r.cr}:1 (fg ${r.fg} on ${r.bg})`);
    };
    await page.context().addCookies([{ name: 'erp_theme', value: theme, url: baseURL! }]);
    await check('/login');
    await loginAs(page, USERS.admin); // keeps the theme cookie: loginAs clears cookies, so set it again
    await page.context().addCookies([{ name: 'erp_theme', value: theme, url: baseURL! }]);
    for (const path of PAGES) await check(path);
    expect(n).toBeGreaterThan(500);
    expect(bad).toEqual([]);
  });
}
