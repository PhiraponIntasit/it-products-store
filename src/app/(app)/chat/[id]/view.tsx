'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { staffClose, staffSend, staffTake } from '@/server/actions/chat';
import type { StaffChat } from '@/server/chat';
import { useAction } from '@/components/use-action';
import css from '../../../(shop)/chat.module.css';

const POLL_MS = 3000;
const timeOf = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One conversation: messages (polled), reply box, take and close. Customer bubbles on the left, staff on the right. */
export function StaffChatView({ initial, meId }: { initial: StaffChat; meId: string }) {
  const [t, setT] = useState(initial);
  const [msgs, setMsgs] = useState(initial.messages);
  const [text, setText] = useState(''), [error, setError] = useState(''), [sending, setSending] = useState(false);
  const last = useRef(initial.messages.at(-1)?.id ?? 0), box = useRef<HTMLDivElement>(null);
  const act = useAction({ errorAs: 'toast' });

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/chat/${initial.id}?after=${last.current}`, { cache: 'no-store' });
      if (!r.ok) return;
      const d: StaffChat = await r.json();
      setT(d);
      if (d.messages.length) {
        last.current = d.messages[d.messages.length - 1].id;
        setMsgs(m => [...m, ...d.messages.filter(x => !m.some(y => y.id === x.id))]);
      }
    } catch { /* retry on the next tick */ }
  }, [initial.id]);

  useEffect(() => {
    if (t.status === 'closed') return;
    const i = setInterval(poll, POLL_MS);
    return () => clearInterval(i);
  }, [poll, t.status]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length]);

  const send = async () => {
    const s = text.trim();
    if (!s || sending) return;
    setSending(true); setError('');
    const r = await staffSend(t.id, s);
    setSending(false);
    if (!r.ok) { setError(r.error); return; }
    setText('');
    await poll();
  };

  const closed = t.status === 'closed';
  const mine = t.assigneeId === meId;
  return (
    <section className="card" aria-label={`แชทกับ ${t.name}`} style={{ cursor: 'default', padding: 0, gap: 0, overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--color-divider)' }}>
        <strong>{t.name}</strong>
        <span className={`tag ${t.statusTag}`} data-testid="chat-state">{t.statusLabel}</span>
        <span className="muted" style={{ fontSize: 13 }}>{t.customerOnline ? '● ลูกค้าเปิดหน้าแชทอยู่' : 'ลูกค้าไม่ได้เปิดหน้าแชท — ข้อความจะส่งทางอีเมลด้วย (ถ้ามี)'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!closed && !mine && <button className="btn btn-secondary" disabled={act.pending} onClick={() => act.run(() => staffTake(t.id), poll)}>{t.assignee ? `รับต่อจาก ${t.assignee}` : 'รับเรื่อง'}</button>}
          {!closed && <button className="btn btn-secondary" disabled={act.pending} onClick={() => { if (confirm('ปิดบทสนทนานี้?')) act.run(() => staffClose(t.id), poll); }}>ปิดแชท</button>}
        </span>
      </header>
      <div ref={box} className={css.body} style={{ height: 'min(60vh, 520px)' }} aria-live="polite" aria-label="ข้อความ">
        {msgs.map(m => m.role === 'system'
          ? <p key={m.id} className={css.sys}>{m.text}</p>
          : (
            <div key={m.id} className={`${css.row} ${m.role === 'customer' ? '' : css.me}`} data-role={m.role}>
              <div className={css.bubble}>
                <span className={css.who}>{m.role === 'customer' ? t.name : m.role === 'bot' ? 'ผู้ช่วยอัตโนมัติ' : m.by || 'พนักงาน'}</span>
                <span className={css.text}>{m.text}</span>
                <span className={css.time}>{timeOf(m.at)}</span>
              </div>
            </div>
          ))}
      </div>
      {closed
        ? <p className="muted" style={{ margin: 0, padding: '12px 16px' }}>บทสนทนานี้ปิดแล้ว ถ้าลูกค้าส่งข้อความใหม่จะเปิดเป็นบทสนทนาใหม่</p>
        : (
          <>
            {error && <p className={css.err} role="alert">{error}</p>}
            <form className={css.compose} onSubmit={e => { e.preventDefault(); send(); }}>
              <textarea className="input" rows={2} value={text} maxLength={1000} placeholder={mine || !t.assignee ? 'พิมพ์คำตอบ… (Enter ส่ง · Shift+Enter ขึ้นบรรทัด)' : `${t.assignee} ดูแลอยู่ — ตอบแล้วจะรับเรื่องแทน`} aria-label="คำตอบ"
                onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
              <button className="btn btn-primary" disabled={sending || !text.trim()}>ส่ง</button>
            </form>
          </>
        )}
    </section>
  );
}
