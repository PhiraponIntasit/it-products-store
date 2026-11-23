// Storefront sample data: categories, brands, suppliers and PC parts with the specs the
// filters and the PC builder read. Prices are demo figures (THB, VAT included), not quotes.
import type { Prisma, PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

type Specs = Prisma.InputJsonObject;

export const CATEGORIES: [string, string][] = [
  ['cpu', 'ซีพียู (CPU)'], ['mainboard', 'เมนบอร์ด'], ['ram', 'แรม (RAM)'], ['vga', 'การ์ดจอ'],
  ['ssd', 'SSD / สตอเรจ'], ['psu', 'พาวเวอร์ซัพพลาย'], ['case', 'เคส'], ['cooler', 'ชุดระบายความร้อน'],
  ['monitor', 'จอภาพ'], ['peripheral', 'คีย์บอร์ด & เมาส์'], ['cable', 'สายและอะแดปเตอร์'],
  ['notebook-parts', 'อะไหล่โน้ตบุ๊ก'], ['consumable', 'วัสดุสิ้นเปลือง'],
];

export const BRANDS = [
  'AMD', 'Intel', 'ASUS', 'MSI', 'Gigabyte', 'Kingston', 'Corsair', 'G.Skill', 'Sapphire', 'WD', 'Crucial', 'Samsung',
  'Cooler Master', 'Seasonic', 'Lian Li', 'Montech', 'DeepCool', 'Thermalright', 'NZXT', 'LG', 'Dell', 'Logitech', 'HP', 'Lenovo', 'Generic',
  'ASRock', 'Zotac', 'TeamGroup', 'AOC', 'Razer', 'SteelSeries', 'Fractal Design', 'Arctic', 'be quiet!',
];

export const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Typical gross margin by category (share of the selling price before VAT) — thin on CPUs and graphics
 *  cards, wide on cables and accessories, as in Thai IT retail. Purchase cost is ex-VAT. */
const MARGIN: Record<string, number> = { cpu: .07, vga: .07, mainboard: .09, ram: .13, ssd: .12, psu: .15, case: .18, cooler: .22, monitor: .12, peripheral: .30, cable: .45, 'notebook-parts': .28, consumable: .22 };
const costOf = (cat: string, price: number) => Math.round(price / 1.07 * (1 - MARGIN[cat]) / 10) * 10;

/** Existing back-office items: category, brand, selling price and specs. */
const EXISTING: Record<string, [string, string, number, Specs]> = {
  'PWR-065W': ['notebook-parts', 'Dell', 1790, { wattage: 65, connector: 'USB-C' }],
  'RAM-16D5': ['ram', 'Kingston', 2290, { ramType: 'DDR5', capacityGB: 16, module: 'SODIMM' }],
  'SSD-1TB': ['ssd', 'Samsung', 3890, { interface: 'NVMe PCIe 4.0', capacityGB: 1000, formFactor: 'M.2 2280' }],
  'CBL-TB4': ['cable', 'Generic', 1090, { lengthM: 1.8 }],
  'MOU-M720': ['peripheral', 'Logitech', 1390, { connection: 'Bluetooth / USB receiver' }],
  'KB-K380': ['peripheral', 'Logitech', 1490, { connection: 'Bluetooth' }],
  'TON-HP26': ['consumable', 'HP', 3190, { model: '26A' }],
  'BAT-X1': ['notebook-parts', 'Lenovo', 3990, { capacityWh: 57 }],
  'HDMI-2M': ['cable', 'Generic', 290, { lengthM: 2, version: 'HDMI 2.1' }],
  'MON-U27': ['monitor', 'Dell', 14900, { sizeInch: 27, resolution: '3840x2160', refreshHz: 60 }],
};

/** [sku, name, category, brand, unit, qty, min, cost, price, location, specs] */
type New = [string, string, string, string, string, number, number, number, number, string, Specs];
const PRODUCTS: New[] = [
  ['CPU-R5-7600', 'AMD Ryzen 5 7600', 'cpu', 'AMD', 'ชิ้น', 8, 3, 6080, 6990, 'S-01', { socket: 'AM5', cores: 6, threads: 12, tdpW: 65, igpu: 'มี' }],
  ['CPU-R7-7800X3D', 'AMD Ryzen 7 7800X3D', 'cpu', 'AMD', 'ชิ้น', 5, 2, 13030, 14990, 'S-01', { socket: 'AM5', cores: 8, threads: 16, tdpW: 120, igpu: 'มี' }],
  ['CPU-I5-14400F', 'Intel Core i5-14400F', 'cpu', 'Intel', 'ชิ้น', 7, 3, 5900, 6790, 'S-01', { socket: 'LGA1700', cores: 10, threads: 16, tdpW: 65, igpu: 'ไม่มี' }],
  ['CPU-I7-14700K', 'Intel Core i7-14700K', 'cpu', 'Intel', 'ชิ้น', 4, 2, 12420, 14290, 'S-01', { socket: 'LGA1700', cores: 20, threads: 28, tdpW: 125, igpu: 'มี' }],
  ['MB-TUF-B650', 'ASUS TUF GAMING B650-PLUS WIFI', 'mainboard', 'ASUS', 'ชิ้น', 5, 2, 6460, 7590, 'S-02', { socket: 'AM5', chipset: 'B650', ramType: 'DDR5', formFactor: 'ATX', m2Slots: 3 }],
  ['MB-MSI-B650M', 'MSI PRO B650M-A WIFI', 'mainboard', 'MSI', 'ชิ้น', 6, 2, 4920, 5790, 'S-02', { socket: 'AM5', chipset: 'B650', ramType: 'DDR5', formFactor: 'mATX', m2Slots: 2 }],
  ['MB-GB-B760M', 'Gigabyte B760M DS3H DDR4', 'mainboard', 'Gigabyte', 'ชิ้น', 6, 2, 3390, 3990, 'S-02', { socket: 'LGA1700', chipset: 'B760', ramType: 'DDR4', formFactor: 'mATX', m2Slots: 2 }],
  ['MB-ASUS-Z790P', 'ASUS PRIME Z790-P', 'mainboard', 'ASUS', 'ชิ้น', 3, 1, 6800, 7990, 'S-02', { socket: 'LGA1700', chipset: 'Z790', ramType: 'DDR5', formFactor: 'ATX', m2Slots: 3 }],
  ['RAM-KF-32D5', 'Kingston FURY Beast 32GB (2x16GB) DDR5-5600', 'ram', 'Kingston', 'ชุด', 10, 4, 3000, 3690, 'S-03', { ramType: 'DDR5', capacityGB: 32, modules: 2, speedMHz: 5600 }],
  ['RAM-GS-32D5', 'G.Skill Trident Z5 RGB 32GB (2x16GB) DDR5-6000', 'ram', 'G.Skill', 'ชุด', 6, 2, 3810, 4690, 'S-03', { ramType: 'DDR5', capacityGB: 32, modules: 2, speedMHz: 6000 }],
  ['RAM-CR-16D4', 'Corsair Vengeance LPX 16GB (2x8GB) DDR4-3200', 'ram', 'Corsair', 'ชุด', 9, 3, 1210, 1490, 'S-03', { ramType: 'DDR4', capacityGB: 16, modules: 2, speedMHz: 3200 }],
  ['VGA-GB-4060', 'GIGABYTE GeForce RTX 4060 WINDFORCE OC 8GB', 'vga', 'Gigabyte', 'ชิ้น', 6, 2, 9550, 10990, 'S-04', { chip: 'RTX 4060', vramGB: 8, tdpW: 115, lengthMm: 192 }],
  ['VGA-ASUS-4070S', 'ASUS DUAL GeForce RTX 4070 SUPER 12GB', 'vga', 'ASUS', 'ชิ้น', 4, 1, 19980, 22990, 'S-04', { chip: 'RTX 4070 SUPER', vramGB: 12, tdpW: 220, lengthMm: 267 }],
  ['VGA-SAP-7800XT', 'Sapphire PULSE Radeon RX 7800 XT 16GB', 'vga', 'Sapphire', 'ชิ้น', 3, 1, 17370, 19990, 'S-04', { chip: 'RX 7800 XT', vramGB: 16, tdpW: 263, lengthMm: 280 }],
  ['SSD-WD-SN850X', 'WD Black SN850X 1TB NVMe', 'ssd', 'WD', 'ชิ้น', 10, 3, 2710, 3290, 'A-02', { interface: 'NVMe PCIe 4.0', capacityGB: 1000, formFactor: 'M.2 2280' }],
  ['SSD-CR-P3P2T', 'Crucial P3 Plus 2TB NVMe', 'ssd', 'Crucial', 'ชิ้น', 7, 2, 3770, 4590, 'A-02', { interface: 'NVMe PCIe 4.0', capacityGB: 2000, formFactor: 'M.2 2280' }],
  ['PSU-CM-650B', 'Cooler Master MWE 650 Bronze V2', 'psu', 'Cooler Master', 'ชิ้น', 6, 2, 1660, 2090, 'S-05', { wattage: 650, efficiency: '80 PLUS Bronze' }],
  ['PSU-CO-RM750E', 'Corsair RM750e 750W', 'psu', 'Corsair', 'ชิ้น', 6, 2, 3090, 3890, 'S-05', { wattage: 750, efficiency: '80 PLUS Gold' }],
  ['PSU-SS-GX850', 'Seasonic FOCUS GX-850', 'psu', 'Seasonic', 'ชิ้น', 3, 1, 3730, 4690, 'S-05', { wattage: 850, efficiency: '80 PLUS Gold' }],
  ['CASE-LL-216', 'Lian Li LANCOOL 216', 'case', 'Lian Li', 'ชิ้น', 4, 1, 2750, 3590, 'คลังใหญ่', { formFactors: ['ATX', 'mATX', 'ITX'], maxGpuLengthMm: 392 }],
  ['CASE-MT-903', 'Montech AIR 903 MAX', 'case', 'Montech', 'ชิ้น', 4, 1, 2210, 2890, 'คลังใหญ่', { formFactors: ['E-ATX', 'ATX', 'mATX', 'ITX'], maxGpuLengthMm: 400 }],
  ['CASE-CM-Q300L', 'Cooler Master MasterBox Q300L', 'case', 'Cooler Master', 'ชิ้น', 5, 2, 1140, 1490, 'คลังใหญ่', { formFactors: ['mATX', 'ITX'], maxGpuLengthMm: 360 }],
  ['COOL-DC-AK400', 'DeepCool AK400', 'cooler', 'DeepCool', 'ชิ้น', 8, 3, 870, 1190, 'S-06', { sockets: ['AM5', 'AM4', 'LGA1700'], maxTdpW: 220 }],
  ['COOL-TR-PA120', 'Thermalright Peerless Assassin 120 SE', 'cooler', 'Thermalright', 'ชิ้น', 6, 2, 940, 1290, 'S-06', { sockets: ['AM5', 'AM4', 'LGA1700'], maxTdpW: 250 }],
  ['COOL-NZ-K240', 'NZXT Kraken 240 AIO', 'cooler', 'NZXT', 'ชิ้น', 3, 1, 3200, 4390, 'S-06', { sockets: ['AM5', 'AM4', 'LGA1700'], maxTdpW: 250, radiatorMm: 240 }],
  ['MON-LG-27GR75Q', 'LG UltraGear 27GR75Q 27" QHD 165Hz', 'monitor', 'LG', 'เครื่อง', 4, 1, 7150, 8690, 'คลังใหญ่', { sizeInch: 27, resolution: '2560x1440', refreshHz: 165 }],
];

/** More of the catalogue: [sku, name, category, brand, unit, qty, min, price, location, specs, list price (shown struck through)?].
 *  Cost follows the category margin (costOf). */
type More = [string, string, string, string, string, number, number, number, string, Specs, number?];
const MORE: More[] = [
  ['CPU-R5-7500F', 'AMD Ryzen 5 7500F', 'cpu', 'AMD', 'ชิ้น', 9, 3, 5290, 'S-01', { socket: 'AM5', cores: 6, threads: 12, tdpW: 65, igpu: 'ไม่มี' }],
  ['CPU-R7-9700X', 'AMD Ryzen 7 9700X', 'cpu', 'AMD', 'ชิ้น', 4, 2, 12990, 'S-01', { socket: 'AM5', cores: 8, threads: 16, tdpW: 65, igpu: 'มี' }, 13900],
  ['CPU-R9-9900X', 'AMD Ryzen 9 9900X', 'cpu', 'AMD', 'ชิ้น', 2, 1, 16990, 'S-01', { socket: 'AM5', cores: 12, threads: 24, tdpW: 120, igpu: 'มี' }],
  ['CPU-R5-5600', 'AMD Ryzen 5 5600', 'cpu', 'AMD', 'ชิ้น', 10, 3, 3290, 'S-01', { socket: 'AM4', cores: 6, threads: 12, tdpW: 65, igpu: 'ไม่มี' }],
  ['CPU-I3-14100F', 'Intel Core i3-14100F', 'cpu', 'Intel', 'ชิ้น', 8, 3, 3390, 'S-01', { socket: 'LGA1700', cores: 4, threads: 8, tdpW: 58, igpu: 'ไม่มี' }],
  ['CPU-U5-245K', 'Intel Core Ultra 5 245K', 'cpu', 'Intel', 'ชิ้น', 3, 1, 10490, 'S-01', { socket: 'LGA1851', cores: 14, threads: 14, tdpW: 125, igpu: 'มี' }],
  ['MB-ASR-B650M', 'ASRock B650M Pro RS WiFi', 'mainboard', 'ASRock', 'ชิ้น', 5, 2, 4990, 'S-02', { socket: 'AM5', chipset: 'B650', ramType: 'DDR5', formFactor: 'mATX', m2Slots: 3 }],
  ['MB-MSI-B550', 'MSI B550 GAMING GEN3', 'mainboard', 'MSI', 'ชิ้น', 6, 2, 3290, 'S-02', { socket: 'AM4', chipset: 'B550', ramType: 'DDR4', formFactor: 'ATX', m2Slots: 2 }, 3690],
  ['MB-GB-X870E', 'Gigabyte X870E AORUS ELITE WIFI7', 'mainboard', 'Gigabyte', 'ชิ้น', 2, 1, 12900, 'S-02', { socket: 'AM5', chipset: 'X870E', ramType: 'DDR5', formFactor: 'ATX', m2Slots: 4 }],
  ['MB-ASUS-B760I', 'ASUS ROG STRIX B760-I GAMING WIFI', 'mainboard', 'ASUS', 'ชิ้น', 2, 1, 7490, 'S-02', { socket: 'LGA1700', chipset: 'B760', ramType: 'DDR5', formFactor: 'ITX', m2Slots: 2 }],
  ['MB-MSI-Z890', 'MSI PRO Z890-P WIFI', 'mainboard', 'MSI', 'ชิ้น', 2, 1, 9990, 'S-02', { socket: 'LGA1851', chipset: 'Z890', ramType: 'DDR5', formFactor: 'ATX', m2Slots: 4 }],
  ['RAM-TG-32D5', 'TeamGroup T-Force Delta RGB 32GB (2x16GB) DDR5-6000', 'ram', 'TeamGroup', 'ชุด', 8, 3, 4190, 'S-03', { ramType: 'DDR5', capacityGB: 32, modules: 2, speedMHz: 6000 }, 4590],
  ['RAM-CR-64D5', 'Corsair Vengeance 64GB (2x32GB) DDR5-6000', 'ram', 'Corsair', 'ชุด', 3, 1, 7590, 'S-03', { ramType: 'DDR5', capacityGB: 64, modules: 2, speedMHz: 6000 }],
  ['RAM-KF-16D4', 'Kingston FURY Beast 16GB (2x8GB) DDR4-3200', 'ram', 'Kingston', 'ชุด', 10, 3, 1390, 'S-03', { ramType: 'DDR4', capacityGB: 16, modules: 2, speedMHz: 3200 }],
  ['VGA-ZT-4060TI', 'ZOTAC GAMING GeForce RTX 4060 Ti Twin Edge 8GB', 'vga', 'Zotac', 'ชิ้น', 4, 1, 13990, 'S-04', { chip: 'RTX 4060 Ti', vramGB: 8, tdpW: 160, lengthMm: 225 }, 14900],
  ['VGA-MSI-5070', 'MSI GeForce RTX 5070 12G VENTUS 2X OC', 'vga', 'MSI', 'ชิ้น', 3, 1, 21900, 'S-04', { chip: 'RTX 5070', vramGB: 12, tdpW: 250, lengthMm: 242 }],
  ['VGA-GB-5080', 'GIGABYTE GeForce RTX 5080 GAMING OC 16G', 'vga', 'Gigabyte', 'ชิ้น', 1, 1, 46900, 'S-04', { chip: 'RTX 5080', vramGB: 16, tdpW: 360, lengthMm: 340 }],
  ['VGA-SAP-7600', 'Sapphire PULSE Radeon RX 7600 8GB', 'vga', 'Sapphire', 'ชิ้น', 5, 2, 8990, 'S-04', { chip: 'RX 7600', vramGB: 8, tdpW: 165, lengthMm: 240 }, 9590],
  ['SSD-SS-990P2T', 'Samsung 990 PRO 2TB NVMe', 'ssd', 'Samsung', 'ชิ้น', 5, 2, 6290, 'A-02', { interface: 'NVMe PCIe 4.0', capacityGB: 2000, formFactor: 'M.2 2280' }, 6990],
  ['SSD-KS-NV3', 'Kingston NV3 1TB NVMe', 'ssd', 'Kingston', 'ชิ้น', 12, 4, 2190, 'A-02', { interface: 'NVMe PCIe 4.0', capacityGB: 1000, formFactor: 'M.2 2280' }],
  ['SSD-CR-MX500', 'Crucial MX500 1TB SATA 2.5"', 'ssd', 'Crucial', 'ชิ้น', 8, 3, 2390, 'A-02', { interface: 'SATA', capacityGB: 1000, formFactor: '2.5"' }],
  ['PSU-MSI-A650', 'MSI MAG A650BN 650W', 'psu', 'MSI', 'ชิ้น', 7, 2, 1790, 'S-05', { wattage: 650, efficiency: '80 PLUS Bronze' }],
  ['PSU-BQ-1000', 'be quiet! Pure Power 12 M 1000W', 'psu', 'be quiet!', 'ชิ้น', 2, 1, 5990, 'S-05', { wattage: 1000, efficiency: '80 PLUS Gold' }],
  ['CASE-NZ-H5', 'NZXT H5 Flow (2024)', 'case', 'NZXT', 'ชิ้น', 4, 1, 3290, 'คลังใหญ่', { formFactors: ['ATX', 'mATX', 'ITX'], maxGpuLengthMm: 365 }],
  ['CASE-FD-N5', 'Fractal Design North', 'case', 'Fractal Design', 'ชิ้น', 2, 1, 4990, 'คลังใหญ่', { formFactors: ['ATX', 'mATX', 'ITX'], maxGpuLengthMm: 355 }],
  ['COOL-AR-LF240', 'Arctic Liquid Freezer III 240', 'cooler', 'Arctic', 'ชิ้น', 4, 1, 3290, 'S-06', { sockets: ['AM5', 'AM4', 'LGA1851', 'LGA1700'], maxTdpW: 300, radiatorMm: 240 }, 3590],
  ['COOL-DC-AG400', 'DeepCool AG400', 'cooler', 'DeepCool', 'ชิ้น', 10, 3, 690, 'S-06', { sockets: ['AM5', 'AM4', 'LGA1851', 'LGA1700'], maxTdpW: 220 }],
  ['MON-AOC-24G2', 'AOC 24G2SP 24" IPS 165Hz', 'monitor', 'AOC', 'เครื่อง', 6, 2, 4590, 'คลังใหญ่', { sizeInch: 24, resolution: '1920x1080', refreshHz: 165 }, 4990],
  ['MON-ASUS-27Q', 'ASUS TUF Gaming VG27AQ3A 27" QHD 180Hz', 'monitor', 'ASUS', 'เครื่อง', 4, 1, 7490, 'คลังใหญ่', { sizeInch: 27, resolution: '2560x1440', refreshHz: 180 }],
  ['KB-RZ-BWV4', 'Razer BlackWidow V4 X Mechanical', 'peripheral', 'Razer', 'ชิ้น', 5, 2, 3990, 'C-03', { connection: 'USB' }],
  ['MOU-LG-G502X', 'Logitech G502 X Lightspeed', 'peripheral', 'Logitech', 'ชิ้น', 6, 2, 4290, 'C-03', { connection: 'Wireless 2.4GHz' }, 4790],
  ['HS-SS-A7', 'SteelSeries Arctis Nova 7 Wireless', 'peripheral', 'SteelSeries', 'ชิ้น', 4, 1, 6490, 'C-03', { connection: 'Wireless 2.4GHz / Bluetooth' }],
  ['CBL-DP-2M', 'DisplayPort 1.4 Cable 2m', 'cable', 'Generic', 'เส้น', 15, 5, 350, 'C-02', { lengthM: 2, version: 'DP 1.4' }],
];

/** [name, tax ID, phone, email] — fictitious distributors for the demo */
export const SUPPLIERS: [string, string, string, string][] = [
  ['บจก. ไอทีซัพพลาย', '0105551234567', '02-111-2233', 'sales@itsupply.example'],
  ['บจก. คอมพาร์ท ดิสทริบิวชั่น', '0105559876543', '02-444-5566', 'order@compart.example'],
  ['หจก. สยามไอทีเทรด', '0103557654321', '02-777-8899', 'po@siamittrade.example'],
];

export async function seedStore(db: PrismaClient, stockedAt: Date, by: string) {
  await db.category.createMany({ data: CATEGORIES.map(([slug, name], sort) => ({ id: 'cat-' + slug, slug, name, sort })) });
  await db.brand.createMany({ data: BRANDS.map(name => ({ id: 'brand-' + slugOf(name), slug: slugOf(name), name })) });
  await db.supplier.createMany({ data: SUPPLIERS.map(([name, taxId, phone, email], i) => ({ id: `sup-${i + 1}`, name, taxId, phone, email })) });

  for (const [sku, [cat, brand, price, specs]] of Object.entries(EXISTING))
    await db.inventoryItem.update({ where: { sku }, data: { price, cost: costOf(cat, price), categoryId: 'cat-' + cat, brandId: 'brand-' + slugOf(brand), specs, slug: slugOf(sku), active: true } });

  await db.inventoryItem.createMany({
    data: PRODUCTS.map(([sku, name, cat, brand, unit, qty, min, cost, price, loc, specs]) => ({
      sku, name, cat: CATEGORIES.find(c => c[0] === cat)![1], unit, qty, min, cost, price, loc, specs,
      categoryId: 'cat-' + cat, brandId: 'brand-' + slugOf(brand), slug: slugOf(sku), active: true, warrantyMonths: 36,
    })),
  });
  await db.inventoryItem.createMany({
    data: MORE.map(([sku, name, cat, brand, unit, qty, min, price, loc, specs, compareAt]) => ({
      sku, name, cat: CATEGORIES.find(c => c[0] === cat)![1], unit, qty, min, cost: costOf(cat, price), price, compareAt: compareAt ?? null, loc, specs,
      categoryId: 'cat-' + cat, brandId: 'brand-' + slugOf(brand), slug: slugOf(sku), active: true,
      warrantyMonths: ['peripheral', 'cable'].includes(cat) ? 12 : 36,
    })),
  });
  const all = [...PRODUCTS.map(p => [p[0], p[2], p[5]] as const), ...MORE.map(m => [m[0], m[2], m[5]] as const)];
  await db.stockMove.createMany({ data: all.map(([sku, , qty]) => ({ t: stockedAt, sku, type: 'in', qty, ref: 'ยอดตั้งต้น', by })) });

  // CPUs, graphics cards and mainboards carry a manufacturer warranty per unit, so they are sold by serial
  const tracked = all.filter(p => SERIAL_CATS.includes(p[1]));
  await db.inventoryItem.updateMany({ where: { sku: { in: tracked.map(p => p[0]) } }, data: { serialTracked: true } });
  await db.serialNumber.createMany({
    data: tracked.flatMap(([sku, , qty]) => Array.from({ length: qty }, (_, k) => ({ serial: `${sku}-SN${String(k + 1).padStart(4, '0')}`, sku, receivedRef: 'ยอดตั้งต้น' }))),
  });
}

const SERIAL_CATS = ['cpu', 'vga', 'mainboard'];

/** Demo coupons and about two months of finished orders, so the sales report has something to show.
 *  Past orders are already delivered, so they don't touch today's stock; serial-tracked items are left out. */
export async function seedSales(db: PrismaClient, passwordHash: string) {
  const day = 864e5, now = Date.now();
  await db.coupon.createMany({ data: [
    { code: 'WELCOME10', kind: 'percent', value: 10, maxDiscount: 500, minSpend: 0, startsAt: new Date(now - 90 * day), endsAt: new Date(now + 275 * day), oncePerCustomer: true, note: 'ลูกค้าใหม่ ลด 10%' },
    { code: 'SAVE300', kind: 'fixed', value: 300, minSpend: 3000, startsAt: new Date(now - 60 * day), endsAt: new Date(now + 30 * day), usageLimit: 100, note: 'ซื้อครบ 3,000 ลด 300' },
    { code: 'EARLYBIRD', kind: 'percent', value: 15, maxDiscount: 1000, minSpend: 5000, startsAt: new Date(now - 120 * day), endsAt: new Date(now - 60 * day), note: 'โปรเปิดร้าน (หมดอายุแล้ว)' },
  ] });

  const people = ['สมชาย ใจกว้าง', 'ศิริพร แสงทอง', 'ณัฐพล ศรีสุข', 'กมลชนก บุญมา', 'ธนกร วงศ์ดี', 'พิมพ์ชนก ทองคำ'];
  const customers = await Promise.all(people.map((name, i) => db.customer.create({ data: { id: `cus-${i + 1}`, email: `buyer${i + 1}@example.com`, passwordHash, name, phone: `08000000${String(i).padStart(2, '0')}` } })));
  const items = await db.inventoryItem.findMany({ where: { active: true, serialTracked: false, price: { gt: 0 } }, orderBy: { sku: 'asc' } });
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647; // deterministic, so every fresh database looks the same
  const year = new Date().getFullYear();
  for (let k = 0; k < 48; k++) {
    const c = customers[Math.floor(rnd() * customers.length)];
    const picks = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => items[Math.floor(rnd() * items.length)]))];
    const lines = picks.map(i => ({ sku: i.sku, name: i.name, price: Number(i.price), cost: Number(i.cost), qty: 1 + Math.floor(rnd() * 2) }));
    const subtotal = Math.round(lines.reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100;
    const coupon = subtotal >= 3000 && rnd() < 0.25 ? 'SAVE300' : null, discount = coupon ? 300 : 0;
    const metro = rnd() < 0.6, shippingFee = subtotal - discount >= 2000 || metro ? 0 : 150;
    const paidAt = new Date(now - (1 + Math.floor(rnd() * 58)) * day - Math.floor(rnd() * 10) * 3600e3);
    const n = (await db.counter.update({ where: { key: 'ord' }, data: { value: { increment: 1 } } })).value - 1;
    const id = `ORD-${year}-${String(n).padStart(6, '0')}`;
    await db.order.create({ data: {
      id, customerId: c.id, status: 'completed', subtotal, discount, shippingFee, total: subtotal - discount + shippingFee, couponCode: coupon,
      shipName: c.name, shipPhone: c.phone, shipAddress: metro ? '12 ถนนสุขุมวิท ต.คลองเตย อ.คลองเตย จ.กรุงเทพมหานคร 10110' : '5 ถนนห้วยแก้ว ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200',
      createdAt: new Date(paidAt.getTime() - 5 * 60e3), expiresAt: new Date(paidAt.getTime() + 10 * 60e3), paidAt,
      shippedAt: new Date(paidAt.getTime() + day), completedAt: new Date(paidAt.getTime() + 3 * day), carrier: 'Kerry Express', trackingNo: `KEX${String(100000 + n)}`,
      lines: { create: lines },
      payments: { create: { provider: 'demo_promptpay', amount: subtotal - discount + shippingFee, status: 'successful', providerRef: `demo_seed_${n}`, expiresAt: new Date(paidAt.getTime() + 10 * 60e3), paidAt } },
    } });
  }
  await db.coupon.update({ where: { code: 'SAVE300' }, data: { used: await db.order.count({ where: { couponCode: 'SAVE300' } }) } });
}

/** Storefront promotions running now: a flash sale (ends in ~2½ days, so the countdown shows), home-page banners,
 *  and coupons shown on the home page. Flash-sale items are products no test pins a price on. */
export async function seedPromotions(db: PrismaClient) {
  const h = 3600e3, now = Date.now();
  await db.promotion.create({ data: {
    kind: 'flash', title: 'Flash Sale ปลายเดือน', subtitle: 'ลดแรงเฉพาะช่วงนี้ หมดเวลากลับเป็นราคาปกติ', startsAt: new Date(now - 6 * h), endsAt: new Date(now + 62 * h),
    items: { create: [
      { sku: 'CPU-R5-7500F', salePrice: 4790 }, { sku: 'VGA-MSI-5070', salePrice: 20490 }, { sku: 'RAM-TG-32D5', salePrice: 3790 },
      { sku: 'SSD-KS-NV3', salePrice: 1890 }, { sku: 'MON-AOC-24G2', salePrice: 3990 }, { sku: 'MOU-LG-G502X', salePrice: 3590 },
      { sku: 'COOL-DC-AG400', salePrice: 590 }, { sku: 'PSU-MSI-A650', salePrice: 1590 },
    ] },
  } });
  await db.promotion.createMany({ data: [
    { kind: 'banner', slot: 'side', image: await storeAsset('banners/build.png'), title: 'ประกอบคอมเองง่าย ระบบเช็คความเข้ากันให้', subtitle: 'เลือกทีละชิ้น ระบบเตือนทันทีถ้า Socket แรม หรือขนาดเคสไม่ตรง', link: '/build', tone: 'cobalt', sort: 0, startsAt: new Date(now - 30 * 24 * h), endsAt: new Date(now + 60 * 24 * h) },
    { kind: 'banner', image: await storeAsset('banners/rtx50.png'), title: 'การ์ดจอรุ่นใหม่ RTX 50 Series', subtitle: 'พร้อมส่ง รับประกัน 3 ปี เคลมออนไลน์ได้ที่บัญชีของคุณ', link: '/shop?cat=vga', tone: 'slate', sort: 1, startsAt: new Date(now - 7 * 24 * h), endsAt: new Date(now + 30 * 24 * h) },
    { kind: 'banner', image: await storeAsset('banners/welcome10.png'), title: 'ลูกค้าใหม่ลด 10% ใส่โค้ด WELCOME10', subtitle: 'ลดสูงสุด ฿500 ใช้ได้คนละครั้ง', link: '/shop', tone: 'teal', sort: 2, startsAt: new Date(now - 30 * 24 * h), endsAt: new Date(now + 90 * 24 * h) },
  ] });
  await db.coupon.updateMany({ where: { code: { in: ['WELCOME10', 'SAVE300'] } }, data: { showOnShop: true } });

  // Product photos from the team (prisma/seed-assets/products/<SKU>.jpg); the rest keep the drawn illustration
  for (const f of await readdir(path.join(ASSETS, 'products'))) {
    const sku = f.replace(/\.(jpg|png)$/, '');
    if (await db.inventoryItem.findUnique({ where: { sku }, select: { sku: true } }))
      await db.productImage.create({ data: { sku, file: await storeAsset(`products/${f}`), ord: 0 } });
  }

  // Brand logos (prisma/seed-assets/brands/<brand slug>.png, cut from the team's logo sheet)
  for (const b of await db.brand.findMany()) {
    if (existsSync(path.join(ASSETS, 'brands', `${b.slug}.png`))) await db.brand.update({ where: { id: b.id }, data: { logo: await storeAsset(`brands/${b.slug}.png`) } });
  }
}

/** Puts a seed image where uploaded photos live (Vercel Blob when connected, else UPLOAD_DIR), under a random name the
 *  app accepts (src/server/uploads.ts), and returns that name. */
const ASSETS = path.resolve(__dirname, 'seed-assets');
async function storeAsset(rel: string) {
  const buf = await readFile(path.join(ASSETS, rel));
  const ext = rel.endsWith('.jpg') ? 'jpg' : 'png', type = ext === 'jpg' ? 'image/jpeg' : 'image/png';
  const file = `${randomBytes(16).toString('hex')}.${ext}`;
  if (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    await put(`tickets/${file}`, buf, { access: 'private', contentType: type, addRandomSuffix: false });
  } else {
    const dir = path.resolve(process.env.UPLOAD_DIR || './storage/uploads');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), buf);
  }
  return file;
}
