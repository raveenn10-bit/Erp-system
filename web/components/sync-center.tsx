'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, CloudUpload, Loader2, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { OutboxRow, SyncState } from '@/lib/offline/store';
import { isNative, toast } from '@/lib/native';
import { appVersion, checkForUpdate } from '@/lib/updates';

type Store = typeof import('@/lib/offline/store');

function label(s: SyncState): { text: string; si: string; tone: 'ok' | 'off' | 'busy' | 'pending' | 'warn' | 'bad' } {
  if (s.conflicts) return { text: 'Conflict — Action Required', si: 'පරීක්ෂා කරන්න', tone: 'warn' };
  if (s.failed) return { text: 'Sync Failed', si: 'යැවීම අසාර්ථකයි', tone: 'bad' };
  if (s.syncing) return { text: 'Syncing', si: 'යවමින්', tone: 'busy' };
  if (!s.online || !s.reachable) return { text: s.pending ? `Offline — ${s.pending} saved on device` : 'Offline — Saved on Device', si: 'නොබැඳි', tone: 'off' };
  if (s.needsLogin && s.pending) return { text: 'Sign in to upload', si: 'පිවිසෙන්න', tone: 'warn' };
  if (s.pending) return { text: `Pending Upload · ${s.pending}`, si: 'යැවීමට ඇත', tone: 'pending' };
  return { text: 'Online — Synced', si: 'සමමුහුර්තයි', tone: 'ok' };
}
const ICON = { ok: CheckCircle2, off: CloudOff, busy: Loader2, pending: CloudUpload, warn: AlertTriangle, bad: XCircle };
const when = (t: number | null) => (t ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' }).format(t) : 'Never');

/** Small status chip (bottom right) + Sync Center sheet. Android app only. */
export function SyncIndicator() {
  const [store, setStore] = useState<Store | null>(null);
  const [s, setS] = useState<SyncState | null>(null);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!isNative()) return;
    let off: (() => void) | undefined;
    import('@/lib/offline/store').then(m => { setStore(m); off = m.subscribeSync(setS); m.startSyncEngine().catch(() => {}); });
    const t = setInterval(() => setPath(location.pathname), 1000); setPath(location.pathname);
    return () => { off?.(); clearInterval(t); };
  }, []);
  if (!store || !s) return null;
  if (path.startsWith('/login') && !s.pending && !s.conflicts && !s.failed) return null;
  const l = label(s); const Icon = ICON[l.tone];
  return (
    <>
      <motion.button type="button" className={`sync-chip t-${l.tone}`} onClick={() => setOpen(true)} aria-label={`Sync status: ${l.text}. Open Sync Center`}
        initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Icon size={14} className={l.tone === 'busy' ? 'spin' : ''} aria-hidden /> <span>{l.text}</span>
      </motion.button>
      {open && <SyncCenter store={store} s={s} close={() => setOpen(false)} />}
    </>
  );
}

function SyncCenter({ store, s, close }: { store: Store; s: SyncState; close: () => void }) {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [ver, setVer] = useState('');
  useEffect(() => { appVersion().then(setVer).catch(() => {}); }, []);
  async function checkUpdate() {
    const u = await checkForUpdate(true).catch(() => null);
    if (u) { window.dispatchEvent(new Event('erp-check-update')); close(); } else toast('You have the latest version · නවතම අනුවාදය ඇත');
  }
  const load = () => store.listOutbox().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [s.pending, s.conflicts, s.failed, s.syncing]); // eslint-disable-line react-hooks/exhaustive-deps
  const l = label(s);
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div className="dialog-card sync-center" role="dialog" aria-modal="true" aria-labelledby="sync-title" onMouseDown={e => e.stopPropagation()}>
        <div className="sync-head">
          <div><h3 id="sync-title">Sync Center · <span lang="si">සමමුහුර්ත මධ්‍යස්ථානය</span></h3><p className={`sync-now t-${l.tone}`}>{l.text} · <span lang="si">{l.si}</span></p></div>
          <button className="secondary icon-only" aria-label="Close" onClick={close}><X size={16} /></button>
        </div>
        <div className="sync-stats">
          <div><b>{s.pending}</b><small>Pending</small></div>
          <div className={s.conflicts ? 'warn' : ''}><b>{s.conflicts}</b><small>Conflicts</small></div>
          <div className={s.failed ? 'bad' : ''}><b>{s.failed}</b><small>Failed</small></div>
          <div><b className="sm">{when(s.lastSync)}</b><small>Last successful sync</small></div>
        </div>
        {s.needsLogin && <p className="sync-note warn">Your session expired. Sign in again — pending items stay on this phone and upload after sign-in.</p>}
        {s.lastError && <p className="sync-note bad">{s.lastError}</p>}
        <button className="primary wide" disabled={s.syncing || !s.online} onClick={() => store.syncNow(true)}>
          <RefreshCw size={16} className={s.syncing ? 'spin' : ''} /> {s.syncing ? 'Syncing…' : !s.online ? 'No internet' : 'Sync Now'}
        </button>
        <ul className="sync-list">
          {rows.length === 0 && <li className="muted">Nothing waiting. Everything on this phone has reached the server.</li>}
          {rows.map(r => (
            <li key={r.id} className={`st-${r.status.toLowerCase()}`}>
              <div className="sync-row-top">
                <b>{r.op_type}</b>
                <span className={`sync-pill st-${r.status.toLowerCase()}`}>{r.status === 'Pending' || r.status === 'Syncing' ? 'PENDING SYNC' : r.status === 'Synced' ? `Synced · ${r.server_ref || ''}` : r.status.toUpperCase()}</span>
              </div>
              <small>{when(r.created_at)}{r.summary ? ` · ${r.summary}` : ''}{r.retry_count ? ` · ${r.retry_count} retries` : ''}</small>
              {r.last_error && r.status !== 'Synced' && <small className="sync-err">{r.last_error}</small>}
              {(r.status === 'Conflict' || r.status === 'Failed') && (
                <div className="sync-row-actions">
                  <button className="secondary" onClick={() => store.retryItem(r.id).then(load)}><RefreshCw size={14} />Retry</button>
                  <button className="secondary danger" onClick={() => {
                    if (confirm(`Remove this ${r.op_type} from the phone? The server never accepted it, so nothing will be posted. This cannot be undone.`)) store.discardItem(r.id).then(load);
                  }}><Trash2 size={14} />Discard</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="sync-ver"><span>App version {ver}</span><button className="secondary" onClick={checkUpdate}><RefreshCw size={14} />Check for updates</button></div>
        <p className="sync-foot">Conflicts are kept on the phone until you retry (after fixing stock or the customer) or discard them. Nothing is deleted automatically. Android may pause syncing while the app is closed — it resumes when you open the app.</p>
      </div>
    </div>
  );
}
