import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requirePage } from '@/server/auth';
import { chatContext, chatForStaff } from '@/server/chat';
import { StaffChatView } from './view';

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePage('chat');
  const t = await chatForStaff((await params).id);
  if (!t) notFound();
  const ctx = t.customerId ? await chatContext(t.customerId) : null;
  return (
    <div className="anim-page stack-4">
      <Link href="/chat" style={{ fontSize: 14 }}>‹ กลับไปกล่องแชท</Link>
      <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', alignItems: 'start' }}>
        <StaffChatView initial={t} meId={me.id} />
        <aside className="card" aria-labelledby="who-h" style={{ cursor: 'default', gap: 10, maxWidth: 420 }}>
          <h3 id="who-h" className="card-title" style={{ fontSize: 16, margin: 0 }}>ลูกค้า</h3>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 14 }}>
            <dt className="muted">ชื่อ</dt>
            <dd style={{ margin: 0 }}>{t.customerId && can(me, 'customers') ? <Link href={`/customers/${t.customerId}`}>{t.name}</Link> : t.name}{t.guest && <span className="muted"> (ผู้เยี่ยมชม ไม่ได้เข้าสู่ระบบ)</span>}</dd>
            <dt className="muted">อีเมล</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{t.email || '— (ตอบได้เฉพาะในแชท)'}</dd>
            <dt className="muted">เริ่มแชท</dt><dd style={{ margin: 0 }} className="tnum">{t.createdText}</dd>
          </dl>
          {ctx && (
            <>
              <h4 style={{ margin: '6px 0 0', fontSize: 14 }}>คำสั่งซื้อล่าสุด</h4>
              {ctx.orders.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {ctx.orders.map(o => <li key={o.id}>{can(me, 'orders') ? <Link href={`/orders/${o.id}`} className="tnum">{o.id}</Link> : <span className="tnum">{o.id}</span>} · {o.text}</li>)}
                </ul>
              ) : <p className="muted" style={{ margin: 0, fontSize: 13 }}>ยังไม่มีคำสั่งซื้อ</p>}
              {ctx.claims.length > 0 && (
                <>
                  <h4 style={{ margin: '6px 0 0', fontSize: 14 }}>เคลมที่เปิดอยู่</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {ctx.claims.map(c => <li key={c.id}>{can(me, 'claims') ? <Link href={`/claims/${c.id}`} className="tnum">{c.id}</Link> : <span className="tnum">{c.id}</span>} · {c.text}</li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
