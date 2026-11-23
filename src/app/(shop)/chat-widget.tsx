'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chatEnd, chatSend } from '@/server/actions/chat';
import type { ChatMsg, CustomerChat } from '@/server/chat';
import css from './chat.module.css';

// Storefront chat: a button in the corner that opens a conversation with the shop. Visitors give a name first.
// New messages arrive by polling /api/chat — every few seconds while open, slowly while minimised (for the unread dot).

const OPEN_MS = 3000, CLOSED_MS = 15000, MAX = 1000;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CustomerChat | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [contact, setContact] = useState({ name: '', email: '' });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const last = useRef(0), openRef = useRef(false), box = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  openRef.current = open;

  const poll = useCallback(async (reset = false) => {
    if (reset) last.current = 0;
    try {
      const r = await fetch(`/api/chat?after=${last.current}`, { cache: 'no-store' });
      if (!r.ok) return;
      const d: CustomerChat = await r.json();
      setState(d);
      if (!d.thread) { setMsgs([]); last.current = 0; return; }
      if (d.messages.length) {
        last.current = d.messages[d.messages.length - 1].id;
        setMsgs(m => (reset ? d.messages : [...m, ...d.messages.filter(x => !m.some(y => y.id === x.id))]));
        if (!openRef.current && !reset) setUnread(n => n + d.messages.filter(x => x.role !== 'customer').length);
      } else if (reset) setMsgs([]);
    } catch { /* offline for a moment — the next poll retries */ }
  }, []);

  // First load, and open straight away from an email link (?chat=1).
  useEffect(() => {
    poll(true);
    if (new URLSearchParams(location.search).get('chat') === '1') setOpen(true);
  }, [poll]);

  useEffect(() => {
    if (!state?.thread && !open) return; // nothing to watch until a conversation exists
    const t = setInterval(() => poll(), open ? OPEN_MS : CLOSED_MS);
    return () => clearInterval(t);
  }, [open, state?.thread, poll]);

  useEffect(() => { if (open) { setUnread(0); setTimeout(() => input.current?.focus(), 50); } }, [open]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length, open]);

  const needContact = !!state && !state.signedIn && !state.thread;
  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setError('');
    const r = await chatSend(t, needContact ? contact : undefined);
    setSending(false);
    if (!r.ok) { setError(r.error); return; }
    setText('');
    await poll(!state?.thread);
  };
  const end = async () => {
    if (!confirm('จบการสนทนานี้?')) return;
    await chatEnd();
    await poll(true);
  };

  const th = state?.thread;
  const status = !th ? 'ทีมงานตอบในเวลาทำการ' : th.status === 'open' ? `${th.staff || 'พนักงาน'} กำลังดูแลคุณ` : th.status === 'waiting' ? 'รอพนักงานตอบ…' : th.statusLabel;

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
              {th && <button className={css.linkBtn} onClick={end}>จบการสนทนา</button>}
              <button className={css.x} onClick={() => setOpen(false)} aria-label="ย่อหน้าต่างแชท">×</button>
            </div>
          </header>

          <div className={css.body} ref={box} aria-live="polite">
            {!msgs.length && (
              <p className={css.hello}>สวัสดีครับ{state?.name ? ` คุณ${state.name.split(' ')[0]}` : ''} 👋 สอบถามเรื่องสินค้า จัดสเปค คำสั่งซื้อ หรือเคลมได้เลย พนักงานจะตอบในหน้าต่างนี้</p>
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

          {needContact && (
            <div className={css.contact}>
              <input className="input" placeholder="ชื่อของคุณ" aria-label="ชื่อของคุณ" value={contact.name} maxLength={60} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} />
              <input className="input" type="email" placeholder="อีเมล (ไม่บังคับ · ใช้แจ้งเมื่อพนักงานตอบ)" aria-label="อีเมล" value={contact.email} maxLength={120} onChange={e => setContact(c => ({ ...c, email: e.target.value }))} />
            </div>
          )}
          {error && <p className={css.err} role="alert">{error}</p>}
          <form className={css.compose} onSubmit={e => { e.preventDefault(); send(); }}>
            <textarea ref={input} className="input" rows={2} value={text} maxLength={MAX} placeholder="พิมพ์ข้อความ…" aria-label="ข้อความ"
              onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            <button className="btn btn-primary" disabled={sending || !text.trim()}>ส่ง</button>
          </form>
        </section>
      )}
    </>
  );
}
