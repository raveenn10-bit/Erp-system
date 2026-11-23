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
export function NativeShell() {
  const [online, setOnline] = useState(true);
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
