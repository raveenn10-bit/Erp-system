'use client';
// Offline read cache + durable outbox + sync engine.
import { rawRequest, NetworkError, isNativeApp } from '@/lib/http';
import { db, deviceId, getMeta, setMeta } from './db';
import { MAX_RETRIES, OFFLINE_WINDOW_MS, backoffMs, classify, queueKind, serverRef } from './policy';

export type OutboxRow = {
  id: string; user_id: string; op_type: string; path: string; payload: string; summary: string | null;
  created_at: number; status: 'Pending' | 'Syncing' | 'Synced' | 'Conflict' | 'Failed';
  retry_count: number; last_error: string | null; next_attempt_at: number; server_ref: string | null; updated_at: number;
};
export type SyncState = {
  online: boolean; reachable: boolean; syncing: boolean; needsLogin: boolean;
  pending: number; conflicts: number; failed: number; lastSync: number | null; lastError: string | null;
};

/** Raised after a write was saved on the phone instead of the server. */
export class OfflineQueuedError extends Error {
  constructor(public kind: string) {
    super(`${kind} saved on this phone · PENDING SYNC. It will upload automatically when the internet is back. · දුරකථනයේ සුරැකිණි — අන්තර්ජාලය ආ විට යවයි.`);
    this.name = 'OfflineQueuedError';
  }
}
export const isOfflineQueued = (e: unknown): e is OfflineQueuedError => (e as Error)?.name === 'OfflineQueuedError';

// ---------------- state + listeners ----------------
let state: SyncState = { online: true, reachable: true, syncing: false, needsLogin: false, pending: 0, conflicts: 0, failed: 0, lastSync: null, lastError: null };
const listeners = new Set<(s: SyncState) => void>();
export const getSyncState = () => state;
export function subscribeSync(fn: (s: SyncState) => void) { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; }
function patch(p: Partial<SyncState>) { state = { ...state, ...p }; listeners.forEach(f => f(state)); }

export function setOnline(online: boolean) {
  const back = online && !state.online;
  patch({ online, ...(online ? {} : { reachable: false }) });
  if (online) {
    void syncNow(back);
    if (back) {
      setTimeout(() => void syncNow(true), 3000); // mobile data often needs a moment after reconnect
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('erp-synced', { detail: { synced: 0 } })); // reload screens with live data
    }
  }
}

async function refreshCounts() {
  const r = await (await db()).query(`SELECT status, COUNT(*) AS n FROM outbox WHERE status IN ('Pending','Syncing','Conflict','Failed') GROUP BY status`);
  const by = Object.fromEntries((r.values || []).map(v => [v.status, Number(v.n)]));
  patch({ pending: (by.Pending || 0) + (by.Syncing || 0), conflicts: by.Conflict || 0, failed: by.Failed || 0, lastSync: Number(await getMeta('last_sync_at')) || null });
}

// ---------------- read cache ----------------
async function currentUser() { return (await getMeta('current_user_id')) || ''; }

export async function cachePut(path: string, body: unknown) {
  if (path === '/me') {
    const id = (body as { user?: { id?: string } })?.user?.id;
    if (id) {
      const prev = await getMeta('current_user_id');
      if (prev && prev !== id) await (await db()).run('DELETE FROM cache'); // different user: never show their data
      await setMeta('current_user_id', id);
    }
  }
  await setMeta('last_online_at', String(Date.now()));
  await (await db()).run('INSERT INTO cache(key,user_id,body,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET user_id=excluded.user_id, body=excluded.body, updated_at=excluded.updated_at',
    [path, await currentUser(), JSON.stringify(body), Date.now()]);
  patch({ reachable: true, needsLogin: false });
}

export async function cacheGet<T>(path: string): Promise<T | null> {
  const last = Number(await getMeta('last_online_at')) || 0;
  if (Date.now() - last > OFFLINE_WINDOW_MS) return null; // offline window expired: must sign in online
  const r = await (await db()).query('SELECT body FROM cache WHERE key=? AND user_id=?', [path, await currentUser()]);
  const body = r.values?.[0]?.body as string | undefined;
  return body ? (JSON.parse(body) as T) : null;
}

/** Sign-out: remove cached business data. Pending operations are kept (never silently discarded). */
export async function clearCache() { await (await db()).run('DELETE FROM cache'); await setMeta('current_user_id', ''); }

// ---------------- outbox ----------------
export function canQueue(method: string, path: string, body: unknown) { return isNativeApp() && !!queueKind(method, path, body); }

export async function enqueue(method: string, path: string, bodyText: string): Promise<OfflineQueuedError> {
  const body = JSON.parse(bodyText);
  const kind = queueKind(method, path, body)!;
  const user = await currentUser();
  if (!user) throw new Error('Sign in online once before working offline.');
  const now = Date.now();
  const summary = [body.customerName, body.totalCents != null ? `Rs ${(body.totalCents / 100).toFixed(2)}` : null, Array.isArray(body.items) ? `${body.items.length} item(s)` : null].filter(Boolean).join(' · ');
  // INSERT OR IGNORE on the unique idempotency key: the same operation can never be queued twice.
  await (await db()).run(`INSERT OR IGNORE INTO outbox(id,device_id,user_id,op_type,entity_id,method,path,payload,idempotency_key,summary,created_at,status,retry_count,next_attempt_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'Pending',0,0,?)`,
    [crypto.randomUUID(), await deviceId(), user, kind, body.idempotencyKey, method, path, bodyText, body.idempotencyKey, summary, now, now], true);
  await refreshCounts();
  setTimeout(() => void syncNow(true), 300); // try immediately (the server may only be briefly unreachable)
  return new OfflineQueuedError(kind);
}

export async function listOutbox(): Promise<OutboxRow[]> {
  const r = await (await db()).query(`SELECT * FROM outbox WHERE status!='Synced' OR updated_at > ? ORDER BY created_at DESC LIMIT 200`, [Date.now() - 3 * 86400000]);
  return (r.values || []) as OutboxRow[];
}

async function mark(id: string, p: Partial<OutboxRow>) {
  const keys = Object.keys(p);
  await (await db()).run(`UPDATE outbox SET ${keys.map(k => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, [...keys.map(k => (p as Record<string, unknown>)[k]), Date.now(), id]);
}

/** User asks to try a Failed/Conflict item again (e.g. after stock was corrected). */
export async function retryItem(id: string) { await mark(id, { status: 'Pending', retry_count: 0, next_attempt_at: 0, last_error: null }); await refreshCounts(); void syncNow(true); }
/** Explicit, confirmed removal of an item that was never accepted by the server. */
export async function discardItem(id: string) {
  await (await db()).run(`DELETE FROM outbox WHERE id=? AND status IN ('Conflict','Failed')`, [id]);
  await refreshCounts();
}

// ---------------- sync engine ----------------
let running: Promise<void> | null = null;

export function syncNow(force = false): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  if (!running) running = runSync(force).finally(() => { running = null; });
  return running;
}

async function runSync(force: boolean) {
  await refreshCounts();
  if (!state.online) return;
  patch({ syncing: true, lastError: null });
  try {
    // Real backend reachability + session check (not just "Wi-Fi is on").
    let me;
    try { me = await rawRequest('/me'); } catch { patch({ reachable: false }); return; }
    if (me.status === 401) { patch({ reachable: true, needsLogin: true }); return; }
    if (!me.ok) { patch({ reachable: false, lastError: `Server error ${me.status}` }); return; }
    await cachePut('/me', me.data);
    const userId = me.data?.user?.id as string;

    const now = Date.now();
    const due = await (await db()).query(
      `SELECT * FROM outbox WHERE status IN ('Pending','Syncing') AND user_id=? AND (next_attempt_at<=? OR ?=1) ORDER BY created_at ASC LIMIT 50`,
      [userId, now, force ? 1 : 0]);
    let synced = 0;
    for (const row of (due.values || []) as OutboxRow[]) {
      await mark(row.id, { status: 'Syncing' });
      let status: number | null = null, data: unknown = null;
      try { const r = await rawRequest(row.path, { method: 'POST', body: row.payload }); status = r.status; data = r.data; }
      catch (e) { if (!(e instanceof NetworkError)) throw e; }
      const outcome = classify(status);
      const err = (data as { error?: string } | null)?.error || (status ? `HTTP ${status}` : 'No connection');
      if (outcome === 'synced') { await mark(row.id, { status: 'Synced', server_ref: serverRef(data), last_error: null }); synced++; }
      else if (outcome === 'conflict') await mark(row.id, { status: 'Conflict', last_error: err });
      else if (outcome === 'auth') { await mark(row.id, { status: 'Pending' }); patch({ needsLogin: true }); break; }
      else if (outcome === 'network') { await mark(row.id, { status: 'Pending', next_attempt_at: Date.now() + backoffMs(row.retry_count) }); patch({ reachable: false }); break; }
      else {
        const n = row.retry_count + 1;
        await mark(row.id, n >= MAX_RETRIES ? { status: 'Failed', retry_count: n, last_error: err } : { status: 'Pending', retry_count: n, last_error: err, next_attempt_at: Date.now() + backoffMs(n) });
      }
    }
    await setMeta('last_sync_at', String(Date.now()));
    // Tell open screens to reload so server numbers/stock replace PENDING items at once.
    if (synced && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('erp-synced', { detail: { synced } }));
  } catch (e) {
    patch({ lastError: (e as Error).message });
  } finally {
    patch({ syncing: false });
    await refreshCounts().catch(() => {});
  }
}

/** Wire automatic sync: start-up, connectivity changes, foreground, and a slow timer while pending. */
let wired = false;
export async function startSyncEngine() {
  if (!isNativeApp() || wired) return;
  wired = true;
  // Rows left in 'Syncing' by a crash/force-stop go back to Pending (server de-duplicates on retry).
  await (await db()).run(`UPDATE outbox SET status='Pending' WHERE status='Syncing'`).catch(() => {});
  const [{ Network }, { App }] = await Promise.all([import('@capacitor/network'), import('@capacitor/app')]);
  patch({ online: (await Network.getStatus()).connected });
  Network.addListener('networkStatusChange', s => setOnline(s.connected));
  App.addListener('appStateChange', s => { if (s.isActive) void syncNow(); });
  setInterval(() => { if (state.pending > 0 && state.online) void syncNow(); }, 15_000);
  void syncNow();
}
