// Domain constants & pure helpers shared by server and client.

export const MODULES = [
  ['dashboard', 'แดชบอร์ดภาพรวม'], ['inventory', 'คลังสินค้า'], ['products', 'สินค้า & ราคาขาย'], ['orders', 'คำสั่งซื้อ & จัดส่ง'], ['coupons', 'คูปอง & โปรโมชั่น'], ['warranty', 'ตรวจประกัน & เปลี่ยนสินค้า'], ['claims', 'เคลมสินค้า'], ['chat', 'แชทลูกค้า'], ['customers', 'ลูกค้า'], ['sales', 'รายงานยอดขาย'],
  ['purchase', 'ใบขอซื้อ / ใบสั่งซื้อ'], ['approvals', 'อนุมัติการสั่งซื้อ'],
  ['users', 'บัญชีผู้ใช้ & สิทธิ์'], ['audit', 'Audit Log'],
] as const;
export type Module = (typeof MODULES)[number][0];
export const MOD_LABEL = Object.fromEntries(MODULES) as Record<Module, string>;
export const ALL: Module[] = MODULES.map(m => m[0]);
export const isModule = (m: string): m is Module => (ALL as string[]).includes(m);

export const MOD_PATH: Record<Module, string> = {
  dashboard: '/dashboard', inventory: '/inventory', products: '/products', orders: '/orders', coupons: '/coupons', warranty: '/warranty', claims: '/claims', chat: '/chat', customers: '/customers', sales: '/sales', purchase: '/purchase', approvals: '/approvals',
  users: '/users', audit: '/audit',
};

export const HDR: Record<Module, [string, string]> = {
  dashboard: ['ภาพรวมระบบ', 'แดชบอร์ดผู้บริหาร'], inventory: ['Inventory', 'คลังสินค้า & สต็อก'],
  products: ['Catalog', 'สินค้า & ราคาขาย'], orders: ['Sales', 'คำสั่งซื้อ & การจัดส่ง'], coupons: ['Promotion', 'คูปองส่วนลด & โปรโมชั่นหน้าร้าน'], warranty: ['After-sales', 'ตรวจประกันและเปลี่ยนสินค้าตาม Serial'], claims: ['After-sales', 'เคลมสินค้าจากลูกค้า'], chat: ['Support', 'แชทกับลูกค้าหน้าร้าน'], customers: ['CRM', 'บัญชีลูกค้าหน้าร้าน'], sales: ['Sales Report', 'ยอดขาย กำไร และสินค้าขายดี'],
  purchase: ['Procurement', 'ใบขอซื้อ & ใบสั่งซื้อ'], approvals: ['Procurement', 'อนุมัติการสั่งซื้อ'],
  users: ['Administration', 'บัญชีผู้ใช้ & สิทธิ์การเข้าถึง'], audit: ['Compliance', 'Audit Log · บันทึกการใช้งานระบบ'],
};

// Role keys `itsupport` / `itmanager` are kept from the old helpdesk so existing accounts stay valid; they are now the
// shop's technicians. `employee` (helpdesk requesters) is retired: those accounts are suspended and it can't be assigned.
export const ROLES = [
  ['storekeeper', 'Store Keeper'], ['itsupport', 'ช่างเทคนิค'], ['itmanager', 'หัวหน้าช่าง'],
  ['manager', 'Manager'], ['executive', 'Executive'], ['admin', 'Admin'],
] as const;
export type Role = (typeof ROLES)[number][0];
export const ROLE_LABEL = Object.fromEntries([...ROLES, ['employee', 'พนักงานทั่วไป (ปิดใช้งานแล้ว)']]) as Record<Role | 'employee', string>;
export const isRole = (r: string): r is Role => ROLES.some(x => x[0] === r);

export const ROLE_PERMS: Record<Role, Module[]> = {
  storekeeper: ['inventory', 'products', 'orders', 'warranty', 'claims', 'chat', 'purchase'],
  itsupport: ['claims', 'warranty', 'inventory'],
  itmanager: ['claims', 'warranty', 'inventory'],
  manager: ['dashboard', 'sales', 'orders', 'coupons', 'warranty', 'claims', 'chat', 'customers', 'approvals', 'audit'],
  executive: ['dashboard', 'sales', 'approvals', 'audit'],
  admin: ALL,
};

export const AUDIT_CATS: Record<string, string> = {
  auth: 'เข้าสู่ระบบ', user: 'ผู้ใช้ & สิทธิ์', ticket: 'งานซ่อม', stock: 'คลังสินค้า', product: 'สินค้า & ราคา', purchase: 'จัดซื้อ', order: 'คำสั่งซื้อ & ชำระเงิน', coupon: 'คูปอง', warranty: 'ประกัน & เคลม', customer: 'ลูกค้า', chat: 'แชทลูกค้า',
  employee: 'พนักงาน', asset: 'ทรัพย์สิน', // older records only: the employee & asset registers were removed
  system: 'ระบบ',
};

export const PRST: Record<string, [string, string]> = {
  pending: ['รอ Manager อนุมัติ', 'tag-outline'], pending_exec: ['รอผู้บริหารอนุมัติ', 'tag-outline'],
  approved: ['อนุมัติแล้ว', 'tag-accent'], rejected: ['ไม่อนุมัติ', 'tag-neutral'], received: ['รับเข้าคลังแล้ว', 'tag-neutral'],
};
export const isPendingPR = (status: string) => status === 'pending' || status === 'pending_exec';

export const DEPTS = ['IT', 'Operations', 'Marketing', 'Finance', 'HR'];
export const VAT = 0.07;

// ── formatting ───────────────────────────────────────────────────────────────
export const DISPLAY_TZ = process.env.DISPLAY_TZ || process.env.NEXT_PUBLIC_DISPLAY_TZ || 'Asia/Bangkok';
type D = Date | string | number;
const toDate = (d: D) => (d instanceof Date ? d : new Date(d));
export const fmt = (n: number) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
export const baht = (n: number) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const bahtS = (n: number) => '฿' + Math.round(n).toLocaleString('th-TH');
export const fmtDT = (d: D) => toDate(d).toLocaleString('th-TH', { timeZone: DISPLAY_TZ, day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtD = (d: D) => toDate(d).toLocaleDateString('th-TH', { timeZone: DISPLAY_TZ, day: 'numeric', month: 'short', year: 'numeric' });
/** Calendar day key (YYYY-MM-DD) in the display time zone */
export const dayKey = (d: D) => toDate(d).toLocaleDateString('en-CA', { timeZone: DISPLAY_TZ });

// ── SLA ──────────────────────────────────────────────────────────────────────
export const config = {
  approvalLimit: () => Number(process.env.APPROVAL_LIMIT ?? 50000) || 50000,
  reorderFactor: () => Math.min(6, Math.max(1, Number(process.env.REORDER_FACTOR ?? 3) || 3)),
  defaultTheme: (): 'light' | 'dark' => (process.env.DEFAULT_THEME === 'dark' ? 'dark' : 'light'),
  showDemo: () => (process.env.SHOW_DEMO_ACCOUNTS ?? 'false').toLowerCase() === 'true',
};

// ── purchase approval rules (segregation of duties) ─────────────────────────
export function canDecide(p: { requesterId: string; status: string; approver1Id: string | null }, me: { id: string; role: string }): { ok: boolean; why?: string } {
  if (p.requesterId === me.id) return { ok: false, why: 'คุณเป็นผู้ขอซื้อใบนี้ — ต้องให้ผู้อื่นอนุมัติ (แบ่งแยกหน้าที่)' };
  if (p.status === 'pending' && !['manager', 'admin'].includes(me.role)) return { ok: false, why: 'รอ Manager อนุมัติขั้นที่ 1' };
  if (p.status === 'pending_exec') {
    if (!['executive', 'admin'].includes(me.role)) return { ok: false, why: 'ยอดเกินวงเงิน — รอผู้บริหารอนุมัติขั้นสุดท้าย' };
    if (p.approver1Id === me.id) return { ok: false, why: 'คุณอนุมัติขั้นที่ 1 แล้ว — ขั้นสุดท้ายต้องเป็นผู้บริหารคนอื่น' };
  }
  return { ok: true };
}
/** Roles that see every PR on the purchase page (others see only their own) */
export const PR_SEE_ALL = ['admin', 'manager', 'executive'];
/** Who may cancel a paid order and return the customer's money. */
export const REFUND_ROLES = ['admin', 'manager'];

/** Wall-clock `ymd` + `hms` in DISPLAY_TZ → the instant (works for any zone, with or without DST). */
export function zonedTime(ymd: string, hms = '00:00:00', tz = DISPLAY_TZ): Date {
  const guess = new Date(`${ymd}T${hms}Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(guess).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}
