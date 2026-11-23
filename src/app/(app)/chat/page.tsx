import Link from 'next/link';
import { requirePage } from '@/server/auth';
import { chatInbox, CHAT_TABS, isChatTab } from '@/server/chat';
import { AutoRefresh } from './refresh';

export default async function ChatInboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage('chat');
  const sp = await searchParams;
  const tab = isChatTab(sp.tab) ? sp.tab : 'waiting';
  const { rows, counts } = await chatInbox(tab, me.id);
  return (
    <div className="anim-page stack-4">
      <AutoRefresh ms={10000} />
      <p className="lead" style={{ maxWidth: '80ch' }}>แชทจากปุ่ม “แชทกับเรา” บนหน้าร้าน กดเปิดบทสนทนาแล้วตอบได้เลย (ตอบครั้งแรก = รับเรื่อง) ลูกค้าเห็นข้อความทันที ถ้าลูกค้าออกจากหน้าเว็บไปแล้วระบบส่งอีเมลแจ้งให้</p>
      <nav aria-label="กล่องแชท" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHAT_TABS.map(([t, label]) => (
          <Link key={t} href={`/chat?tab=${t}`} className={`chip${t === tab ? ' on' : ''}`} style={{ textDecoration: 'none' }} aria-current={t === tab ? 'page' : undefined}>
            {label}{t !== 'closed' && <> <span className="tnum">{counts[t]}</span></>}
          </Link>
        ))}
      </nav>
      <div className="scroll-x">
        <table className="table" aria-label="บทสนทนา">
          <thead><tr><th>ลูกค้า</th><th>ข้อความล่าสุด</th><th>สถานะ</th><th>ผู้ดูแล</th><th>อัปเดต</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-chat={r.id}>
                <td className="nw">
                  <Link href={`/chat/${r.id}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                  {r.guest && <span className="tag tag-outline" style={{ marginLeft: 6 }}>ผู้เยี่ยมชม</span>}
                  {r.unread > 0 && <span className="tag tag-accent tnum" style={{ marginLeft: 6 }} aria-label={`ยังไม่อ่าน ${r.unread} ข้อความ`}>ใหม่ {r.unread}</span>}
                </td>
                <td style={{ fontSize: 13, maxWidth: 420, overflowWrap: 'anywhere' }}>{r.preview}</td>
                <td><span className={`tag ${r.statusTag}`}>{r.statusLabel}</span></td>
                <td style={{ fontSize: 13 }}>{r.assignee || '—'}</td>
                <td className="tnum nw" style={{ fontSize: 13 }}>{r.updatedText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <div className="empty">{tab === 'waiting' ? 'ไม่มีแชทรอรับเรื่อง' : tab === 'mine' ? 'ยังไม่มีแชทที่คุณดูแลอยู่' : 'ไม่มีบทสนทนา'}</div>}
    </div>
  );
}
