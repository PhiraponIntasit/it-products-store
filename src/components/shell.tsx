'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { logout } from '@/server/actions/auth';
import { HDR, MOD_PATH, type Module } from '@/lib/domain';
import { BellIcon, LogoutIcon, MenuIcon, XIcon } from './icons';
import { ThemeToggle } from './theme-toggle';
import { Logo } from './logo';
import { ChangePasswordButton } from './change-password';

const moduleFor = (path: string) => (Object.entries(MOD_PATH) as [Module, string][]).find(([, p]) => path === p || path.startsWith(p + '/'))?.[0];

export function Sidebar({ nav, me }: { nav: { key: string; num: string; label: string; href: string; badge: number }[]; me: { name: string; username: string; roleLabel: string; initial: string } }) {
  const path = usePathname();
  const [pending, start] = useTransition();
  // Phones: the menu collapses behind a button so each page starts with its own content
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  const pendingTotal = nav.reduce((a, n) => a + n.badge, 0);
  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-head">
        <div style={{ padding: '0 8px', minWidth: 0 }}>
          <div className="brand"><Logo height={34} tagline={false} /></div>
          <div className="brand-sub">Store Management System</div>
        </div>
        <button className="btn btn-secondary btn-icon menu-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="app-menu"
          aria-label={open ? 'ปิดเมนู' : 'เปิดเมนู'} style={{ position: 'relative' }}>
          {open ? <XIcon size={20} /> : <MenuIcon />}
          {!open && pendingTotal > 0 && <span className="badge-dot">{pendingTotal}</span>}
        </button>
      </div>
      <div className="sidebar-body" id="app-menu">
      <div style={{ borderTop: '1px solid var(--color-divider)' }} />
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <div className="eyebrow" style={{ padding: '0 10px 6px' }}>เมนูตามสิทธิ์ของคุณ</div>
        {nav.map(n => {
          const on = path === n.href || path.startsWith(n.href + '/');
          return (
            <Link key={n.key} href={n.href} className={`nav-item${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}
              onClick={() => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }}>
              <span className="nav-num">{n.num}</span>
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge > 0 && <span className="tag tag-accent tnum" style={{ padding: '1px 7px' }}>{n.badge}</span>}
            </Link>
          );
        })}
      </nav>
      <div style={{ borderTop: '1px solid var(--color-divider)', padding: 'var(--space-3) 8px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="avatar">{me.initial}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.name}</div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{me.roleLabel} · {me.username}</div>
          </div>
        </div>
        <a className="btn btn-secondary" href="/" target="_blank" rel="noreferrer" style={{ justifyContent: 'flex-start', textDecoration: 'none' }}>เปิดหน้าร้าน ↗</a>
        <ChangePasswordButton />
        <button className="btn btn-secondary" style={{ justifyContent: 'flex-start' }} disabled={pending} onClick={() => start(() => logout())}>
          <LogoutIcon /> ออกจากระบบ
        </button>
      </div>
      </div>
    </aside>
  );
}

export function Topbar({ notifs, theme }: { notifs: { text: string; sub: string; href: string }[]; theme: 'light' | 'dark' }) {
  const path = usePathname();
  const m = moduleFor(path);
  const [kicker, title] = m ? HDR[m] : ['', ''];
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <header className="topbar">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
      </div>
      <ThemeToggle initial={theme} />
      <div style={{ position: 'relative' }} ref={box}>
        <button className="btn btn-secondary btn-icon" onClick={() => setOpen(o => !o)} title="การแจ้งเตือน" aria-label="การแจ้งเตือน" aria-expanded={open} style={{ position: 'relative' }}>
          <BellIcon />
          {notifs.length > 0 && <span className="badge-dot">{notifs.length}</span>}
        </button>
        {open && (
          <div className="card elev-md bell-pop">
            <div className="eyebrow" style={{ padding: '6px 8px' }}>การแจ้งเตือน</div>
            {notifs.map((x, i) => (
              <Link key={i} href={x.href} className="bell-item" style={{ textDecoration: 'none' }} onClick={() => setOpen(false)}>
                <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{x.text}</div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>{x.sub}</div>
              </Link>
            ))}
            {!notifs.length && <div style={{ padding: '12px 8px', fontSize: 13, color: 'var(--color-neutral-700)', borderTop: '1px solid var(--color-divider)' }}>ไม่มีรายการที่ต้องดำเนินการ</div>}
          </div>
        )}
      </div>
    </header>
  );
}
