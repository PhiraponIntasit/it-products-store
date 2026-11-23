'use server';
import { act, Fail, str } from '../act';
import { Denied, requireAction } from '../auth';
import { closeChat, customerAskStaff, customerClose, customerSend, staffReply, takeChat } from '../chat';
import type { Result } from '@/lib/result';

// Chat actions. Customer actions need a signed-in customer; staff actions need the chat menu.
// New messages are fetched by polling GET /api/chat (customer) and /api/chat/[id] (staff), so sending doesn't refresh the page.

async function quiet(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); return { ok: true }; } catch (e) {
    if (e instanceof Fail || e instanceof Denied) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}

export async function chatSend(text: string) {
  return quiet(() => customerSend(str(text)));
}

export async function chatAskStaff() {
  return quiet(() => customerAskStaff());
}

export async function chatEnd() {
  return quiet(() => customerClose());
}

export async function staffSend(id: string, text: string) {
  return quiet(async () => { const me = await requireAction('chat'); await staffReply(me, str(id), str(text)); });
}

export async function staffTake(id: string) {
  return act(async () => { const me = await requireAction('chat'); await takeChat(me, str(id)); return 'รับเรื่องแล้ว'; });
}

export async function staffClose(id: string) {
  return act(async () => { const me = await requireAction('chat'); await closeChat(me, str(id)); return 'ปิดบทสนทนาแล้ว'; });
}
