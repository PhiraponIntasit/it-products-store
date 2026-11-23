// Sample data for development and demos.
// All dates are relative to "now" so SLA timers and the 7-day chart look alive.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_PERMS, type Role } from '../src/lib/domain';
import { seedSales, seedStore, seedPromotions } from './seed-store';
import { seedDemo } from './seed-demo';

const db = new PrismaClient();
const TZ = process.env.DISPLAY_TZ || 'Asia/Bangkok';

/** Offset (minutes) of TZ from UTC at the given instant */
function tzOffset(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUTC - at.getTime()) / 6e4);
}
/** n days ago at h:m wall-clock time in TZ */
function daysAgo(n: number, h = 9, m = 0) {
  const now = new Date();
  const local = new Date(now.getTime() + tzOffset(now) * 6e4); // shift so UTC fields read as TZ wall clock
  const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - n, h, m);
  return new Date(wall - tzOffset(new Date(wall)) * 6e4);
}

async function main() {
  const hash = await bcrypt.hash('1234', 10);

  // Work contact details of the staff accounts (email gets notifications and reset links)
  const contacts: { id: string; name: string; position: string; dept: string; phone: string; email: string }[] = [
    { id: 'EMP-0001', name: 'กรภัทร ศรีวงศ์', position: 'System Administrator', dept: 'IT', phone: '081-000-1001', email: 'korapat.s@corepick.co.th' },
    { id: 'EMP-0002', name: 'ประภาส วงศ์ใหญ่', position: 'Chief Operating Officer', dept: 'Operations', phone: '081-000-2002', email: 'prapas.w@corepick.co.th' },
    { id: 'EMP-0015', name: 'ธนภัทร เจริญสุข', position: 'IT Infrastructure Manager', dept: 'IT', phone: '084-556-6778', email: 'tanapat.c@corepick.co.th' },
    { id: 'EMP-0042', name: 'สมชาย สายชล', position: 'IT Support Engineer', dept: 'IT', phone: '089-123-4567', email: 'somchai.s@corepick.co.th' },
    { id: 'EMP-0043', name: 'ปกรณ์ มีสุข', position: 'IT Support Technician', dept: 'IT', phone: '086-222-3344', email: 'pakorn.m@corepick.co.th' },
    { id: 'EMP-0063', name: 'อรุณี ธนากร', position: 'Operations Manager', dept: 'Operations', phone: '081-777-2020', email: 'arunee.t@corepick.co.th' },
    { id: 'EMP-0108', name: 'วิภาดา รุ่งเรือง', position: 'Marketing Lead · ผู้ดูแลคลัง', dept: 'Marketing', phone: '081-998-8776', email: 'wiphada.r@corepick.co.th' },
    { id: 'EMP-0131', name: 'สุรชัย ทองดี', position: 'Accountant', dept: 'Finance', phone: '082-444-5566', email: 'surachai.t@corepick.co.th' },
    { id: 'EMP-0144', name: 'ณัฐธิดา แก้วใส', position: 'HR Officer', dept: 'HR', phone: '083-111-9090', email: 'natthida.k@corepick.co.th' },
  ];
  // `employee` accounts (requesters of the retired helpdesk) are kept for history but suspended, with no menus.
  const U = (id: string, username: string, name: string, role: Role | 'employee', contactId: string) => {
    const c = contacts.find(x => x.id === contactId)!;
    const live = role !== 'employee';
    return { id, username, passwordHash: hash, name, role, email: c.email, phone: c.phone, dept: c.dept, active: live, perms: live ? [...ROLE_PERMS[role]] : [] };
  };

  const users = [
    U('u1', 'admin', 'กรภัทร ศรีวงศ์', 'admin', 'EMP-0001'), U('u2', 'manager', 'อรุณี ธนากร', 'manager', 'EMP-0063'),
    U('u3', 'itmanager', 'ธนภัทร เจริญสุข', 'itmanager', 'EMP-0015'), U('u4', 'somchai', 'สมชาย สายชล', 'itsupport', 'EMP-0042'),
    U('u5', 'pakorn', 'ปกรณ์ มีสุข', 'itsupport', 'EMP-0043'), U('u6', 'wiphada', 'วิภาดา รุ่งเรือง', 'storekeeper', 'EMP-0108'),
    U('u7', 'surachai', 'สุรชัย ทองดี', 'employee', 'EMP-0131'), U('u8', 'executive', 'ประภาส วงศ์ใหญ่', 'executive', 'EMP-0002'),
    U('u9', 'natthida', 'ณัฐธิดา แก้วใส', 'employee', 'EMP-0144'),
  ];
  for (const u of users) await db.user.create({ data: u });

  const inv: [string, string, string, string, number, number, number, string][] = [
    ['PWR-065W', 'Dell 65W USB-C Adapter', 'อุปกรณ์ไฟฟ้า', 'ชิ้น', 3, 5, 1450, 'B-04'],
    ['RAM-16D5', 'Kingston 16GB DDR5 SODIMM', 'หน่วยความจำ', 'ชิ้น', 8, 4, 1890, 'A-12'],
    ['SSD-1TB', 'Samsung 980 Pro 1TB NVMe', 'Storage', 'ชิ้น', 2, 3, 3290, 'A-02'],
    ['CBL-TB4', 'Thunderbolt 4 Cable 1.8m', 'สายเชื่อมต่อ', 'เส้น', 12, 4, 890, 'C-01'],
    ['MOU-M720', 'Logitech M720 Mouse', 'อุปกรณ์ต่อพ่วง', 'ชิ้น', 6, 5, 1190, 'C-03'],
    ['KB-K380', 'Logitech K380 Keyboard', 'อุปกรณ์ต่อพ่วง', 'ชิ้น', 4, 3, 1290, 'C-03'],
    ['TON-HP26', 'HP 26A Toner Cartridge', 'วัสดุสิ้นเปลือง', 'กล่อง', 1, 3, 2750, 'D-01'],
    ['BAT-X1', 'ThinkPad X1 Battery 57Wh', 'แบตเตอรี่', 'ก้อน', 2, 2, 3450, 'A-07'],
    ['HDMI-2M', 'HDMI 2.1 Cable 2m', 'สายเชื่อมต่อ', 'เส้น', 20, 6, 250, 'C-02'],
    ['MON-U27', 'Dell UltraSharp 27" 4K', 'จอภาพ', 'เครื่อง', 3, 2, 12900, 'คลังใหญ่'],
  ];
  await db.inventoryItem.createMany({ data: inv.map(([sku, name, cat, unit, qty, min, price, loc]) => ({ sku, name, cat, unit, qty, min, cost: price, price, loc })) });
  await seedStore(db, daysAgo(30), 'วิภาดา รุ่งเรือง');
  // Demo storefront customer (fictitious) — signs in on the storefront, not the back office
  await db.customer.create({ data: { id: 'cus-demo', email: 'customer@example.com', passwordHash: hash, name: 'มานี ใจดี', phone: '0899999999',
    addresses: { create: { name: 'มานี ใจดี', phone: '0899999999', line1: '99/1 ถนนนิมมานเหมินท์', subdistrict: 'สุเทพ', district: 'เมืองเชียงใหม่', province: 'เชียงใหม่', postcode: '50200', isDefault: true } } } });
  await seedSales(db, hash);
  await seedDemo(db);
  await seedPromotions(db);

  const prs = [
    { id: 'PR-2026-0014', date: daysAgo(1, 16, 0), requesterId: 'u6', vendor: 'บจก. ออฟฟิศเมท ซัพพลาย', note: 'หมึกใกล้หมด', status: 'pending', lines: [{ sku: 'TON-HP26', name: 'HP 26A Toner Cartridge', unit: 'กล่อง', qty: 6, price: 2750 }] },
    { id: 'PR-2026-0013', date: daysAgo(2, 11, 0), requesterId: 'u6', vendor: 'Dell Thailand', note: 'จอสำหรับทีม Finance ที่ขยายเพิ่ม', status: 'pending_exec', approver1Id: 'u2', decided1: daysAgo(1, 9, 30), lines: [{ sku: 'MON-U27', name: 'Dell UltraSharp 27" 4K', unit: 'เครื่อง', qty: 5, price: 12900 }] },
    { id: 'PR-2026-0012', date: daysAgo(6, 10, 0), requesterId: 'u6', vendor: 'บจก. ไอทีซัพพลาย', note: 'สต็อกสำหรับห้องประชุมใหม่', status: 'approved', approverId: 'u2', decided: daysAgo(5, 9, 0), lines: [{ sku: 'HDMI-2M', name: 'HDMI 2.1 Cable 2m', unit: 'เส้น', qty: 10, price: 250 }, { sku: 'CBL-TB4', name: 'Thunderbolt 4 Cable 1.8m', unit: 'เส้น', qty: 4, price: 890 }] },
    { id: 'PR-2026-0009', date: daysAgo(15, 10, 0), requesterId: 'u6', vendor: 'บจก. ไอทีซัพพลาย', note: '', status: 'received', approverId: 'u2', decided: daysAgo(14, 9, 0), received: daysAgo(5, 10, 0), lines: [{ sku: 'RAM-16D5', name: 'Kingston 16GB DDR5 SODIMM', unit: 'ชิ้น', qty: 6, price: 1890 }] },
    { id: 'PR-2026-0007', date: daysAgo(20, 10, 0), requesterId: 'u6', vendor: 'Dell Thailand', note: 'จอสำรอง', status: 'rejected', approverId: 'u2', decided: daysAgo(19, 9, 0), reason: 'เกินงบไตรมาส ให้ขอใหม่ไตรมาสหน้า', lines: [{ sku: 'MON-U27', name: 'Dell UltraSharp 27" 4K', unit: 'เครื่อง', qty: 5, price: 12900 }] },
  ];
  for (const { lines, ...p } of prs)
    await db.purchaseRequest.create({ data: { ...p, lines: { create: lines.map((l, ord) => ({ ...l, ord })) } } });

  await db.stockMove.createMany({ data: [
    { t: daysAgo(0, 8, 40), sku: 'MOU-M720', type: 'out', qty: 1, ref: 'เบิกใช้ภายในร้าน', by: 'ปกรณ์ มีสุข' },
    { t: daysAgo(1, 13, 0), sku: 'HDMI-2M', type: 'out', qty: 2, ref: 'เบิกใช้ภายในร้าน', by: 'สมชาย สายชล' },
    { t: daysAgo(2, 11, 0), sku: 'SSD-1TB', type: 'out', qty: 1, ref: 'เบิกใช้ภายในร้าน', by: 'สมชาย สายชล' },
    { t: daysAgo(3, 9, 0), sku: 'KB-K380', type: 'in', qty: 3, ref: 'รับเข้าด้วยตนเอง', by: 'วิภาดา รุ่งเรือง' },
    { t: daysAgo(4, 15, 0), sku: 'PWR-065W', type: 'out', qty: 2, ref: 'เบิกใช้ภายในร้าน', by: 'ปกรณ์ มีสุข' },
    { t: daysAgo(5, 10, 0), sku: 'RAM-16D5', type: 'in', qty: 6, ref: 'PR-2026-0009', by: 'วิภาดา รุ่งเรือง' },
    { t: daysAgo(6, 14, 0), sku: 'TON-HP26', type: 'out', qty: 2, ref: 'เบิกใช้ภายในร้าน', by: 'สมชาย สายชล' },
  ] });

  const A = (t: Date, userId: string | null, by: string, role: string, cat: string, action: string, target: string, detail = '') => ({ t, userId, by, role, cat, action, target, detail });
  await db.auditLog.createMany({ data: [
    A(daysAgo(19, 9, 0), 'u2', 'อรุณี ธนากร', 'Manager', 'purchase', 'ไม่อนุมัติใบขอซื้อ', 'PR-2026-0007', 'เกินงบไตรมาส ให้ขอใหม่ไตรมาสหน้า'),
    A(daysAgo(14, 9, 0), 'u2', 'อรุณี ธนากร', 'Manager', 'purchase', 'อนุมัติใบขอซื้อ', 'PR-2026-0009', '฿12,133.80'),
    A(daysAgo(5, 9, 0), 'u2', 'อรุณี ธนากร', 'Manager', 'purchase', 'อนุมัติใบขอซื้อ', 'PR-2026-0012', '฿6,485.40'),
    A(daysAgo(5, 10, 0), 'u6', 'วิภาดา รุ่งเรือง', 'Store Keeper', 'purchase', 'รับสินค้าเข้าคลังตามใบขอซื้อ', 'PR-2026-0009', 'Kingston 16GB DDR5 SODIMM +6'),
    A(daysAgo(3, 10, 40), 'u3', 'ธนภัทร เจริญสุข', 'IT Manager', 'ticket', 'มอบหมายงาน', 'TCK-1042', 'สมชาย สายชล'),
    A(daysAgo(2, 11, 0), 'u4', 'สมชาย สายชล', 'IT Support', 'stock', 'เบิกสต็อก', 'SSD-1TB', 'Samsung 980 Pro 1TB NVMe −1 · คงเหลือ 3 → 2 · อ้างอิง TCK-1042'),
    A(daysAgo(1, 9, 30), 'u2', 'อรุณี ธนากร', 'Manager', 'purchase', 'อนุมัติขั้นที่ 1 (ส่งต่อผู้บริหาร)', 'PR-2026-0013', '฿69,015.00'),
    A(daysAgo(1, 18, 12), null, '(ไม่ระบุตัวตน)', '—', 'auth', 'เข้าสู่ระบบไม่สำเร็จ', 'admin', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'),
    A(daysAgo(1, 18, 13), null, '(ไม่ระบุตัวตน)', '—', 'auth', 'เข้าสู่ระบบไม่สำเร็จ', 'admin', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'),
    A(daysAgo(0, 8, 2), 'u1', 'กรภัทร ศรีวงศ์', 'Admin', 'user', 'แก้ไขสิทธิ์ผู้ใช้', 'pakorn', '+คลังสินค้า'),
    A(daysAgo(0, 9, 12), 'u6', 'วิภาดา รุ่งเรือง', 'Store Keeper', 'ticket', 'เปิดคำร้อง', 'TCK-1049', 'Wi-Fi ชั้น 4 หลุดทั้งฟลอร์ · วิกฤต'),
  ] });

  await db.counter.createMany({ data: [{ key: 'tck', value: 1050 }, { key: 'pr', value: 15 }, { key: 'ord', value: 1 }], skipDuplicates: true });
  console.log('Seeded sample data. Demo accounts use password 1234.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
