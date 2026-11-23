'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { chatEnd, chatSend } from '@/server/actions/chat';
import type { ChatMsg, CustomerChat } from '@/server/chat';
import css from './chat.module.css';

// Storefront chat: a button in the corner that opens a conversation with the shop. Signed-in customers only —
// a visitor gets sign-in / sign-up links that come back to the same page with the chat open (?chat=1).
// New messages arrive by polling /api/chat — every few seconds while open, slowly while minimised (for the unread dot).

const OPEN_MS = 3000, CLOSED_MS = 15000, MAX = 1000;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CustomerChat | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const thread = useRef<string | null>(null), last = useRef(0), openRef = useRef(false), box = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  openRef.current = open;
  const [back, setBack] = useState(encodeURIComponent('/?chat=1'));
  const path = usePathname();

  const poll = useCallback(async (reset = false) => {
    try {
      const r = await fetch(`/api/chat?after=${reset ? 0 : last.current}`, { cache: 'no-store' });
      if (!r.ok) return;
      let d: CustomerChat = await r.json();
      // A new conversation replaced the one on screen (the old one was closed): start the list over.
      if (!reset && (d.thread?.id ?? null) !== thread.current) {
        const again = await fetch('/api/chat?after=0', { cache: 'no-store' });
        if (!again.ok) return;
        d = await again.json(); reset = true;
      }
      thread.current = d.thread?.id ?? null;
      setState(d);
      if (reset) { setMsgs(d.messages); last.current = d.messages.at(-1)?.id ?? 0; return; }
      if (d.messages.length) {
        last.current = d.messages[d.messages.length - 1].id;
        setMsgs(m => [...m, ...d.messages.filter(x => !m.some(y => y.id === x.id))]);
        if (!openRef.current) setUnread(n => n + d.messages.filter(x => x.role !== 'customer').length);
      }
    } catch { /* offline for a moment — the next poll retries */ }
  }, []);

  // On every page change (sign-in brings the visitor back to a new page while this layout stays mounted): reload the
  // state, and open straight away when the link says so (?chat=1, from an email or the sign-in link).
  useEffect(() => {
    poll(true);
    if (new URLSearchParams(location.search).get('chat') === '1') setOpen(true);
  }, [poll, path]);

  useEffect(() => {
    if (!open && (!state?.thread || state.thread.status === 'closed')) return; // nothing to watch while minimised without a live conversation
    const t = setInterval(() => poll(), open ? OPEN_MS : CLOSED_MS);
    return () => clearInterval(t);
  }, [open, state?.thread?.status, poll]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    setTimeout(() => input.current?.focus(), 50);
    // Where sign-in should bring the visitor back to: this page, with the chat open.
    const u = new URL(location.href); u.searchParams.set('chat', '1');
    setBack(encodeURIComponent(u.pathname + u.search));
  }, [open]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length, open]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setError('');
    const r = await chatSend(t);
    setSending(false);
    if (!r.ok) { setError(r.error); return; }
    setText('');
    await poll();
  };
  const end = async () => {
    if (!confirm('จบการสนทนานี้?')) return;
    await chatEnd();
    await poll(true);
  };

  const th = state?.thread;
  const status = state && !state.signedIn ? 'สำหรับสมาชิก' : !th || th.status === 'closed' ? 'ทีมงานตอบในเวลาทำการ' : th.status === 'open' ? `${th.staff || 'พนักงาน'} กำลังดูแลคุณ` : th.status === 'waiting' ? 'รอพนักงานตอบ…' : th.statusLabel;

  return (
    <>
      <button className={css.fab} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="shop-chat" aria-label={open ? 'ปิดหน้าต่างแชท' : `แชทกับร้าน${unread ? ` · ข้อความใหม่ ${unread}` : ''}`}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" />}
        </svg>
        <span className={css.fabText}>{open ? 'ปิด' : 'แชทกับเรา'}</span>
        {!open && unread > 0 && <span className={`${css.dot} tnum`} aria-hidden>{unread}</span>}
      </button>

      {open && (
        <section id="shop-chat" className={css.panel} role="dialog" aria-label="แชทกับร้าน">
          <header className={css.head}>
            <div>
              <strong>แชทกับ COREPICK</strong>
              <span className={css.sub} data-testid="chat-status">{status}</span>
            </div>
            <div className={css.headBtns}>
              {th && th.status !== 'closed' && <button className={css.linkBtn} onClick={end}>จบการสนทนา</button>}
              <button className={css.x} onClick={() => setOpen(false)} aria-label="ย่อหน้าต่างแชท">×</button>
            </div>
          </header>

          <div className={css.body} ref={box} aria-live="polite">
            {!msgs.length && (
              <p className={css.hello}>สวัสดีครับ{state?.name ? ` คุณ${state.name.split(' ')[0]}` : ''} 👋 สอบถามเรื่องสินค้า จัดสเปค คำสั่งซื้อ หรือเคลมได้เลย พนักงานจะตอบในหน้าต่างนี้ และแจ้งทางอีเมลถ้าคุณออกจากหน้าเว็บไปแล้ว</p>
            )}
            {msgs.map(m => m.role === 'system'
              ? <p key={m.id} className={css.sys}>{m.text}</p>
              : (
                <div key={m.id} className={`${css.row} ${m.role === 'customer' ? css.me : ''}`} data-role={m.role}>
                  <div className={css.bubble}>
                    {m.role !== 'customer' && <span className={css.who}>{m.role === 'bot' ? 'ผู้ช่วยอัตโนมัติ' : m.by || 'พนักงาน'}</span>}
                    <span className={css.text}>{m.text}</span>
                    <span className={css.time}>{timeOf(m.at)}</span>
                  </div>
                </div>
              ))}
          </div>

          {state && !state.signedIn ? (
            <div className={css.gate}>
              <p>เข้าสู่ระบบเพื่อแชทกับร้าน พนักงานจะได้ดูคำสั่งซื้อและเคลมของคุณได้ทันที</p>
              <div className={css.gateBtns}>
                <Link href={`/account/login?next=${back}`} className="btn btn-primary">เข้าสู่ระบบ</Link>
                <Link href={`/account/register?next=${back}`} className="btn btn-secondary">สมัครสมาชิก</Link>
              </div>
            </div>
          ) : (<>
          {error && <p className={css.err} role="alert">{error}</p>}
          <form className={css.compose} onSubmit={e => { e.preventDefault(); send(); }}>
            <textarea ref={input} className="input" rows={2} value={text} maxLength={MAX} placeholder="พิมพ์ข้อความ…" aria-label="ข้อความ"
              onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            <button className="btn btn-primary" disabled={sending || !text.trim()}>ส่ง</button>
          </form>
          </>)}
        </section>
      )}
    </>
  );
}
