'use client';
import { useEffect, useState } from 'react';
import { Download, Sparkles, X } from 'lucide-react';
import { checkForUpdate, snoozeUpdate, type UpdateInfo } from '@/lib/updates';
import { applyLiveUpdateNow, markAppReady, type BundleManifest } from '@/lib/live-update';
import { isNative, openExternal } from '@/lib/native';

/** Shows an in-app notice when a newer APK has been published. Checks on start and when the app returns to the foreground. */
export function UpdateNotice() {
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [live, setLive] = useState<BundleManifest | null>(null);
  useEffect(() => {
    if (!isNative()) return;
    markAppReady();
    const on = (e: Event) => setLive((e as CustomEvent<BundleManifest>).detail);
    window.addEventListener('erp-live-update-ready', on);
    return () => window.removeEventListener('erp-live-update-ready', on);
  }, []);
  useEffect(() => {
    if (!isNative()) return;
    const run = (force = false) => checkForUpdate(force).then(setUpd).catch(() => {});
    const manual = () => run(true);
    window.addEventListener('erp-check-update', manual);
    const t = setTimeout(() => run(true), 2500); // always check on app start
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(async ({ App }) => {
      const h = await App.addListener('appStateChange', s => { if (s.isActive) run(); });
      remove = () => h.remove();
    });
    const every = setInterval(() => run(), 10 * 60 * 1000); // and every 10 minutes while open
    return () => { clearTimeout(t); clearInterval(every); remove?.(); window.removeEventListener('erp-check-update', manual); };
  }, []);
  if (!upd && live) return (
    <div className="upd-wrap" role="status" aria-live="polite">
      <div className="upd-card">
        <button className="upd-x" aria-label="Close" data-close onClick={() => setLive(null)}><X size={18} /></button>
        <span className="upd-icon"><Sparkles size={22} /></span>
        <div className="upd-text">
          <b>Update downloaded · <span lang="si">යාවත්කාලීනය සූදානම්</span></b>
          <small>Version {live.version}{live.notes ? ` — ${live.notes}` : ''}. It applies automatically next time you open the app.</small>
        </div>
        <div className="upd-actions">
          <button className="primary" onClick={() => applyLiveUpdateNow()}><Download size={16} /> Restart now · <span lang="si">දැන්ම</span></button>
          <button className="secondary" onClick={() => setLive(null)}>Later</button>
        </div>
      </div>
    </div>
  );
  if (!upd) return null;
  const later = () => { snoozeUpdate(upd); setUpd(null); };
  return (
    <div className="upd-wrap" data-overlay role="dialog" aria-modal="false" aria-labelledby="upd-title">
      <div className="upd-card">
        <button className="upd-x" aria-label="Close" data-close onClick={later}><X size={18} /></button>
        <span className="upd-icon"><Sparkles size={22} /></span>
        <div className="upd-text">
          <b id="upd-title">New update available · <span lang="si">නව යාවත්කාලීනයක්</span></b>
          <small>Version {upd.version} (you have {upd.current}){upd.notes ? ` — ${upd.notes}` : ''}</small>
        </div>
        <div className="upd-actions">
          <button className="primary" onClick={() => { openExternal(upd.url); setUpd(null); }}><Download size={16} /> Update now · <span lang="si">දැන්ම</span></button>
          <button className="secondary" onClick={later}>Later</button>
        </div>
        <p className="upd-hint" lang="si">Download වූ පසු notification එක tap කර <b>Update</b> ඔබන්න. ඔබගේ දත්ත නැති නොවේ.</p>
      </div>
    </div>
  );
}
