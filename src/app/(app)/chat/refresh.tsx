'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-renders the server page every `ms` while the tab is visible, so the inbox shows new chats without a reload. */
export function AutoRefresh({ ms }: { ms: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
