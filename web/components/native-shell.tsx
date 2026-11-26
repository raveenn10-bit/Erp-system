'use client';
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { initNativeShell, isNative } from '@/lib/native';
import { SESSION_EXPIRED_EVENT } from '@/lib/api';
import { onBiometricLock } from '@/lib/biometric';
import { UpdateNotice } from '@/components/update-notice';
import { SyncIndicator } from '@/components/sync-center';

/** Closes the top-most dialog/drawer. Returns true if something was closed. */
function closeTopOverlay(): boolean {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.dialog-backdrop, [data-overlay]'));
  const top = overlays[overlays.length - 1];
  if (top) {
    const closer = top.querySelector<HTMLElement>('[data-close], .document-close, [aria-label^="Close" i]');
    if (closer) closer.click();
    else { top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); top.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    return true;
  }
  const ev = new CustomEvent('erp-back', { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/** App-wide Android integration: back button, status bar, splash, network banner, session expiry. */
/**
 * After a new web version is deployed, a page that was already open still asks for
 * the old JS/CSS chunks, which no longer exist, and navigation breaks. Reload once
 * (at most every 30 s) to pick up the new version.
 */
function reloadOnStaleChunks() {
  const stale = (msg: string) => /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i.test(msg);
  const reload = () => {
    try {
      const last = Number(sessionStorage.getItem('erp-chunk-reload') || 0);
      if (Date.now() - last < 30_000) return;
      sessionStorage.setItem('erp-chunk-reload', String(Date.now()));
    } catch { /* storage unavailable: still reload */ }
    location.reload();
  };
  const onError = (e: ErrorEvent) => { if (stale(String(e.message || e.error?.message || ''))) reload(); };
  const onReject = (e: PromiseRejectionEvent) => { const r = e.reason as { name?: string; message?: string } | undefined; if (stale(`${r?.name || ''} ${r?.message || r || ''}`)) reload(); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onReject);
  return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onReject); };
}

export function NativeShell() {
  const [online, setOnline] = useState(true);
  useEffect(() => (isNative() ? undefined : reloadOnStaleChunks()), []);
  useEffect(() => {
    initNativeShell(closeTopOverlay);
    let remove: (() => void) | undefined;
    if (isNative()) {
      import('@capacitor/network').then(async ({ Network }) => {
        setOnline((await Network.getStatus()).connected);
        const h = await Network.addListener('networkStatusChange', s => setOnline(s.connected));
        remove = () => h.remove();
      });
    } else {
      const update = () => setOnline(navigator.onLine);
      update();
      window.addEventListener('online', update); window.addEventListener('offline', update);
      remove = () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
    }
    const expired = () => { if (!location.pathname.startsWith('/login')) location.replace('/login'); };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    // Biometric lock after 5 min in background: go back to the login screen.
    let unlock: (() => void) | undefined;
    onBiometricLock(expired).then(fn => { unlock = fn; });
    return () => { remove?.(); unlock?.(); window.removeEventListener(SESSION_EXPIRED_EVENT, expired); };
  }, []);
  return (
    <>
      <UpdateNotice />
      <SyncIndicator />
      {!online && (
        <div className="net-banner" role="status" aria-live="polite">
          <WifiOff size={16} /> Offline — sales, payments and stock moves are saved on this phone and sync later. <span lang="si">අන්තර්ජාලය නොමැත</span>
        </div>
      )}
    </>
  );
}
