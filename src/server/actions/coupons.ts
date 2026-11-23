'use server';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { act, Fail, str } from '../act';
import { audit, requireAction } from '../auth';
import { CODE_RE, describe, normCode } from '@/lib/coupon';
import { dayKey, zonedTime } from '@/lib/domain';
import { ruleOf } from '../coupons';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: string, what: string, optional = false) => {
  const s = str(v);
  if (!s && optional) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new Fail(`${what}ต้องเป็นตัวเลขมากกว่า 0`);
  return Math.round(n * 100) / 100;
};

/** Create (`code` null) or edit a coupon. Dates are whole days in the shop's time zone; the last day is included. */
export async function saveCoupon(existing: string | null, f: Record<string, string>) {
  return act(async () => {
    const me = await requireAction('coupons');
    const code = existing ?? normCode(f.code);
    if (!CODE_RE.test(code)) throw new Fail('โค้ดใช้ได้เฉพาะ A–Z, 0–9, _ - ยาว 3–20 ตัว');
    const kind = f.kind === 'percent' ? 'percent' : f.kind === 'fixed' ? 'fixed' : '';
    if (!kind) throw new Fail('เลือกชนิดส่วนลด');
    const value = money(f.value, 'มูลค่าส่วนลด')!;
    if (kind === 'percent' && value > 100) throw new Fail('ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100');
    const maxDiscount = kind === 'percent' ? money(f.maxDiscount, 'ส่วนลดสูงสุด', true) : null;
    const minSpend = str(f.minSpend) ? Number(f.minSpend) : 0;
    if (!Number.isFinite(minSpend) || minSpend < 0) throw new Fail('ยอดซื้อขั้นต่ำไม่ถูกต้อง');
    if (kind === 'fixed' && minSpend && value > minSpend) throw new Fail('ส่วนลดต้องไม่เกินยอดซื้อขั้นต่ำ');
    if (!YMD.test(str(f.startsOn)) || !YMD.test(str(f.endsOn))) throw new Fail('กรุณาเลือกวันเริ่มและวันสิ้นสุด');
    const startsAt = zonedTime(f.startsOn), endsAt = zonedTime(f.endsOn);
    endsAt.setTime(zonedTime(dayKey(new Date(endsAt.getTime() + 36 * 3600e3))).getTime()); // start of the day after the last day
    if (endsAt <= startsAt) throw new Fail('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
    const usageLimit = str(f.usageLimit) ? parseInt(f.usageLimit, 10) : null;
    if (usageLimit != null && !(usageLimit > 0)) throw new Fail('จำนวนสิทธิ์ต้องมากกว่า 0 หรือเว้นว่างถ้าไม่จำกัด');
    const data = { kind, value, maxDiscount, minSpend: Math.round(minSpend * 100) / 100, startsAt, endsAt, usageLimit, oncePerCustomer: f.oncePerCustomer === 'true', showOnShop: f.showOnShop === 'true', note: str(f.note).slice(0, 200) };

    await db.$transaction(async tx => {
      if (existing) {
        const cur = await tx.coupon.findUnique({ where: { code } });
        if (!cur) throw new Fail('ไม่พบคูปอง');
        if (usageLimit != null && usageLimit < cur.used) throw new Fail(`ใช้ไปแล้ว ${cur.used} ครั้ง — จำนวนสิทธิ์ต้องไม่น้อยกว่านี้`);
        await tx.coupon.update({ where: { code }, data });
        await audit(tx, me, 'coupon', 'แก้ไขคูปอง', code, `${describe(ruleOf(cur))} → ${describe({ ...data, maxDiscount })}`);
      } else {
        try { await tx.coupon.create({ data: { code, ...data } }); }
        catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Fail('มีโค้ดนี้แล้ว'); throw e; }
        await audit(tx, me, 'coupon', 'สร้างคูปอง', code, `${describe({ ...data, maxDiscount })} · ${f.startsOn} ถึง ${f.endsOn}` + (usageLimit ? ` · ${usageLimit} สิทธิ์` : ''));
      }
    });
    return existing ? `บันทึก ${code} แล้ว` : `สร้างคูปอง ${code} แล้ว`;
  });
}

export async function setCouponActive(code: string, active: boolean) {
  return act(async () => {
    const me = await requireAction('coupons');
    const r = await db.coupon.updateMany({ where: { code }, data: { active } });
    if (r.count !== 1) throw new Fail('ไม่พบคูปอง');
    await audit(db, me, 'coupon', active ? 'เปิดใช้คูปอง' : 'ปิดใช้คูปอง', code);
    return active ? `เปิดใช้ ${code}` : `ปิดใช้ ${code} — ลูกค้าใช้โค้ดนี้ไม่ได้แล้ว`;
  });
}

