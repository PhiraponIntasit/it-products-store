'use server';
import { act } from '../act';
import { requireAction } from '../auth';
import { savePromotion, setPromotionActive, setPromotionImage } from '../promotions';
import { savePhotos } from '../photos';

// Promotions live under the "คูปอง & โปรโมชั่น" menu (permission `coupons`).

export async function savePromo(id: string | null, f: Record<string, string>, items: Record<string, string>) {
  return act(async () => {
    const me = await requireAction('coupons');
    await savePromotion(me, id, f, items);
    return id ? `บันทึก "${f.title}" แล้ว` : `สร้างโปรโมชั่น "${f.title}" แล้ว`;
  });
}

export async function setPromoActive(id: string, active: boolean) {
  return act(async () => {
    const me = await requireAction('coupons');
    const title = await setPromotionActive(me, id, active);
    return active ? `เปิด "${title}" แล้ว` : `ปิด "${title}" แล้ว — หน้าร้านกลับเป็นราคาปกติ`;
  });
}

/** Poster for a banner: one image (JPG/PNG/WebP/GIF, ≤ 5 MB); an empty form removes it. */
export async function setPromoImage(id: string, fd: FormData) {
  return act(async () => {
    const me = await requireAction('coupons');
    const [photo] = await savePhotos(fd.getAll('poster'), 1);
    const title = await setPromotionImage(me, id, photo ?? null);
    return photo ? `อัปโหลดโปสเตอร์ "${title}" แล้ว` : `ลบโปสเตอร์ "${title}" แล้ว`;
  });
}
