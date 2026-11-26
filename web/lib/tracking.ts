'use client';
// Duty + GPS tracking engine for sales reps.
//  • Android app: a native foreground service (GpsTracker plugin) records the
//    location every 30 s — also with the screen locked — keeps it in its own
//    queue and uploads it. The web layer only starts/stops it and shows status.
//  • Web browser: navigator.geolocation while the page is open (browsers pause
//    GPS in the background — the UI says so).
// Duty start/end, check-ins and (web) points go through a small outbox kept in
// localStorage, so everything recorded offline is sent when the internet is back.
// Every record has a device-generated id → the server ignores re-sent copies.
import { registerPlugin } from '@capacitor/core';
import { apiBase, isNativeApp, NetworkError, rawRequest } from './http';

export type Fix = { lat: number; lng: number; accuracy: number | null; time: string };
type Session = { id: string; startedAt: string; source: 'web' | 'android' };
type Duty = Session & { userId: string };
type Point = { id: string; recordedAt: string; lat: number; lng: number; accuracy?: number | null; speed?: number | null; heading?: number | null; battery?: number | null };
type OutboxItem = { owner: string } & (
  | { kind: 'duty'; body: Record<string, unknown> }
  | { kind: 'points'; session: Session; points: Point[] }
  | { kind: 'visit'; body: Record<string, unknown> });
type NewItem =
  | { kind: 'duty'; body: Record<string, unknown> }
  | { kind: 'points'; session: Session; points: Point[] }
  | { kind: 'visit'; body: Record<string, unknown> };
/** Signed-in user: only their own queued records are sent with their session. */
let owner = '';

export type NativeStatus = { running: boolean; sessionId?: string; lastFix?: Fix; pending?: number; lastUploadAt?: string; lastError?: string };
interface GpsTrackerPlugin {
  start(o: { sessionId: string; startedAt: string; apiBase: string; intervalSec: number; maxHours: number; title: string; text: string }): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<NativeStatus>;
  getCurrentPosition(o: { timeoutMs: number }): Promise<Fix>;
  checkPermissions(): Promise<{ location: string; notifications?: string }>;
  requestPermissions(o?: { permissions: string[] }): Promise<{ location: string; notifications?: string }>;
  openSettings(): Promise<void>;
  flush(): Promise<void>;
}
const GpsTracker = registerPlugin<GpsTrackerPlugin>('GpsTracker');

export const INTERVAL_SEC = 30;
/** A duty left running this long (forgotten "End duty") is ended automatically. */
export const MAX_DUTY_HOURS = 14;
const DUTY_KEY = 'erp-duty-v1',
  OUTBOX_KEY = 'erp-gps-outbox-v1',
  MAX_OUTBOX_POINTS = 5000;

const uid = () => (typeof globalThis.crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const native = () => isNativeApp();
const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch { /* storage full/blocked: nothing else we can do */ }
};

/* ------------------------------------------------------------ state + events */

export type TrackingState = {
  duty: Duty | null;
  lastFix: Fix | null;
  pending: number; // records waiting to be sent
  lastSentAt: string | null;
  error: string | null;
  mode: 'android' | 'web';
};
let state: TrackingState = { duty: null, lastFix: null, pending: 0, lastSentAt: null, error: null, mode: 'web' };
const listeners = new Set<(s: TrackingState) => void>();
function set(patch: Partial<TrackingState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}
export function subscribe(fn: (s: TrackingState) => void) {
  listeners.add(fn);
  fn(state);
  return () => void listeners.delete(fn);
}
export const getState = () => state;

/* ------------------------------------------------------------------ outbox */

function outbox(): OutboxItem[] {
  return read<OutboxItem[]>(OUTBOX_KEY, []);
}
function countPending(items = outbox()) {
  return items.reduce((n, i) => n + (i.kind === 'points' ? i.points.length : 1), 0);
}
function push(newItem: NewItem) {
  const item = { ...newItem, owner } as OutboxItem;
  const items = outbox();
  const last = items[items.length - 1];
  if (item.kind === 'points' && last?.kind === 'points' && last.owner === owner && last.session.id === item.session.id && last.points.length + item.points.length <= 200) last.points.push(...item.points);
  else items.push(item);
  // Never grow without limit: drop the oldest points (not duty/visit records).
  let extra = countPending(items) - MAX_OUTBOX_POINTS;
  for (const it of items) {
    if (extra <= 0) break;
    if (it.kind === 'points') {
      const cut = Math.min(extra, it.points.length);
      it.points.splice(0, cut);
      extra -= cut;
    }
  }
  const clean = items.filter((i) => i.kind !== 'points' || i.points.length);
  write(OUTBOX_KEY, clean);
  set({ pending: countPending(clean) });
}

let flushing: Promise<void> | null = null;
/** Send everything waiting, oldest first. Stops at the first network failure. */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    await Promise.resolve(); // let `flushing` be assigned before the finally{} below can clear it
    try {
      for (;;) {
        const items = outbox();
        const index = items.findIndex((i) => i.owner === owner);
        const item = items[index];
        if (!owner || !item) break;
        const path = item.kind === 'duty' ? '/tracking/duty' : item.kind === 'visit' ? '/tracking/visits' : '/tracking/locations';
        const body = item.kind === 'points' ? { session: item.session, points: item.points } : item.body;
        let res;
        try {
          res = await rawRequest(path, { method: 'POST', body: JSON.stringify(body) });
        } catch (e) {
          if (e instanceof NetworkError) {
            set({ error: null });
            return; // offline: keep everything for later
          }
          throw e;
        }
        if (res.status === 401) {
          set({ error: 'Signed out — sign in again to send your location.' });
          return;
        }
        if (res.status >= 500 || res.status === 429) {
          set({ error: 'Server busy — will retry.' });
          return;
        }
        // 2xx done; other 4xx can never succeed (e.g. bad phone clock) → drop so the queue keeps moving.
        const all = outbox();
        const at = all.findIndex((i) => i.owner === owner);
        const rest = at >= 0 ? [...all.slice(0, at), ...all.slice(at + 1)] : all;
        write(OUTBOX_KEY, rest);
        set({ pending: countPending(rest), lastSentAt: res.ok ? new Date().toISOString() : state.lastSentAt, error: res.ok ? null : String(res.data?.error || 'Rejected by server') });
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/* -------------------------------------------------------------- positions */

function webPosition(timeoutMs: number): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This browser has no GPS / location support.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, time: new Date(p.timestamp || Date.now()).toISOString() }),
      (e) => reject(new Error(geoError(e))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 },
    );
  });
}
function geoError(e: GeolocationPositionError) {
  if (e.code === e.PERMISSION_DENIED) return 'Location permission is blocked. Allow location for this site in the browser settings. · ස්ථාන අවසරය දෙන්න.';
  if (e.code === e.TIMEOUT) return 'Could not get a GPS fix. Go outside / near a window and try again. · GPS ලැබුණේ නැත.';
  return 'Location is not available. Turn on location (GPS) on the device. · GPS සක්‍රිය කරන්න.';
}

/** One accurate position now (for Start duty and shop check-ins). */
export async function currentPosition(timeoutMs = 20000): Promise<Fix> {
  if (native()) {
    try {
      return await GpsTracker.getCurrentPosition({ timeoutMs });
    } catch (e) {
      if (!/not implemented/i.test(String((e as Error).message))) throw e;
    }
  }
  return webPosition(timeoutMs);
}

/** Android: location (+ notifications on Android 13+). Web: the browser asks on first use. */
async function ensurePermission(): Promise<void> {
  if (!native()) return;
  try {
    let p = await GpsTracker.checkPermissions();
    if (p.location !== 'granted' || (p.notifications && p.notifications !== 'granted')) p = await GpsTracker.requestPermissions({ permissions: ['location', 'notifications'] });
    if (p.location !== 'granted')
      throw new Error('Location permission is needed for duty tracking. Allow “Location – While using the app” (Precise) in the app settings. · ස්ථාන අවසරය අවශ්‍යයි.');
  } catch (e) {
    if (/not implemented/i.test(String((e as Error).message))) return;
    throw e;
  }
}

/* ---------------------------------------------------------- web recording */

let watchId: number | null = null,
  timer: ReturnType<typeof setInterval> | null = null,
  latest: Fix | null = null,
  lastQueued = '';

function stopWeb() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  if (timer) clearInterval(timer);
  watchId = null;
  timer = null;
}
function startWeb(duty: Duty) {
  stopWeb();
  if (!('geolocation' in navigator)) {
    set({ error: 'This browser has no GPS / location support.' });
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      latest = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, time: new Date(p.timestamp || Date.now()).toISOString() };
      set({ lastFix: latest, error: null });
    },
    (e) => set({ error: geoError(e) }),
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 60000 },
  );
  const tick = async () => {
    if (autoEndIfTooLong()) return;
    const session = { id: duty.id, startedAt: duty.startedAt, source: duty.source };
    if (latest && latest.time !== lastQueued) {
      lastQueued = latest.time;
      push({ kind: 'points', session, points: [{ id: uid(), recordedAt: latest.time, lat: latest.lat, lng: latest.lng, accuracy: latest.accuracy, battery: await battery() }] });
    } else if (!outbox().some((i) => i.owner === owner)) {
      // Nothing new (standing still / no fix): heartbeat keeps the rep "online" on the map. Not queued.
      const res = await rawRequest('/tracking/locations', { method: 'POST', body: JSON.stringify({ session, points: [], heartbeat: { battery: await battery() } }) }).catch(() => null);
      if (res?.ok) set({ lastSentAt: new Date().toISOString(), error: null });
      return;
    }
    await flush();
  };
  timer = setInterval(tick, INTERVAL_SEC * 1000);
  setTimeout(tick, 3000);
}
async function battery(): Promise<number | null> {
  try {
    const b = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.();
    return b ? Math.round(b.level * 100) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ native glue */

let pollTimer: ReturnType<typeof setInterval> | null = null;
async function pollNative() {
  try {
    const s = await GpsTracker.status();
    set({ lastFix: s.lastFix || state.lastFix, pending: countPending() + (s.pending || 0), lastSentAt: s.lastUploadAt || state.lastSentAt, error: s.lastError || null });
    return s;
  } catch {
    return null;
  }
}
async function startNative(duty: Duty): Promise<boolean> {
  try {
    await GpsTracker.start({
      sessionId: duty.id,
      startedAt: duty.startedAt,
      apiBase,
      intervalSec: INTERVAL_SEC,
      maxHours: MAX_DUTY_HOURS,
      title: 'On duty · රාජකාරියේ',
      text: 'Location is shared with the office every 30 s. Tap to open.',
    });
  } catch (e) {
    if (/not implemented/i.test(String((e as Error).message))) return false; // older app: fall back to web GPS
    throw e;
  }
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!autoEndIfTooLong()) pollNative();
  }, 10000);
  pollNative();
  return true;
}
async function stopNative() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  try {
    await GpsTracker.stop();
  } catch { /* not running / older app */ }
}

/* ------------------------------------------------------------- public API */

function autoEndIfTooLong(): boolean {
  const d = state.duty;
  if (d && Date.now() - Date.parse(d.startedAt) > MAX_DUTY_HOURS * 3600 * 1000) {
    void endDuty('auto');
    return true;
  }
  return false;
}

let online = false;
/** Call once after login. Resumes a duty that was running (app restart, page reload). */
export async function initTracking(userId: string) {
  owner = userId;
  set({ mode: native() ? 'android' : 'web', pending: countPending() });
  if (!online && typeof window !== 'undefined') {
    online = true;
    window.addEventListener('online', () => void flush());
  }
  const duty = read<Duty | null>(DUTY_KEY, null);
  if (!duty || duty.userId !== userId) {
    if (duty) write(DUTY_KEY, null); // someone else's duty on this device: never continue it
    set({ duty: null });
    if (native()) GpsTracker.flush().catch(() => undefined); // points left on the phone from an earlier duty
    void flush();
    return;
  }
  set({ duty });
  if (autoEndIfTooLong()) return;
  if (native()) {
    const s = await pollNative();
    // Service stopped (phone restarted / app force-closed): continue the same duty.
    if (!s?.running || s.sessionId !== duty.id) {
      if (!(await startNative(duty).catch((e) => (set({ error: (e as Error).message }), true)))) startWeb(duty);
    } else if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (!autoEndIfTooLong()) pollNative();
      }, 10000);
    }
  } else startWeb(duty);
  void flush();
}

export async function startDuty(userId: string): Promise<void> {
  if (state.duty) return;
  owner = userId;
  await ensurePermission();
  // A first fix proves GPS works before duty starts (and asks the browser for permission).
  const fix = await currentPosition(25000);
  const duty: Duty = { id: uid(), startedAt: new Date().toISOString(), source: native() ? 'android' : 'web', userId };
  write(DUTY_KEY, duty);
  set({ duty, lastFix: fix, error: null });
  push({ kind: 'duty', body: { id: duty.id, startedAt: duty.startedAt, source: duty.source, lat: fix.lat, lng: fix.lng } });
  push({ kind: 'points', session: { id: duty.id, startedAt: duty.startedAt, source: duty.source }, points: [{ id: uid(), recordedAt: fix.time, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }] });
  lastQueued = fix.time;
  void flush();
  if (native()) {
    if (!(await startNative(duty))) startWeb(duty);
  } else startWeb(duty);
}

export async function endDuty(reason: 'user' | 'auto' | 'logout' = 'user'): Promise<void> {
  const duty = state.duty;
  if (!duty) return;
  stopWeb();
  await stopNative();
  const fix = reason === 'user' ? await currentPosition(8000).catch(() => state.lastFix) : state.lastFix;
  push({ kind: 'duty', body: { id: duty.id, startedAt: duty.startedAt, source: duty.source, endedAt: new Date().toISOString(), endReason: reason, ...(fix ? { lat: fix.lat, lng: fix.lng } : {}) } });
  write(DUTY_KEY, null);
  set({ duty: null });
  await flush();
}

export type CheckInResult = { queued: boolean; distanceM?: number | null; shopLocationSaved?: boolean; fix: Fix | null };
/** Record a visit to a shop at the current position. Works offline (sent later). */
export async function checkIn(customerId: string, note = ''): Promise<CheckInResult> {
  const duty = state.duty;
  // Use the tracker's own fix if it is fresh and accurate (instant); otherwise ask for a new one.
  const age = (f: Fix | null) => (f ? Date.now() - Date.parse(f.time) : Infinity);
  const last = state.lastFix;
  const fix = last && age(last) < 60_000 && (last.accuracy ?? 999) <= 50 ? last : await currentPosition(20000).catch(() => (last && age(last) < 5 * 60_000 ? last : null));
  const body = {
    id: uid(),
    customerId,
    visitedAt: new Date().toISOString(),
    note,
    ...(duty ? { session: { id: duty.id, startedAt: duty.startedAt, source: duty.source } } : {}),
    ...(fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : {}),
  };
  // Try straight away so the rep sees the result; otherwise keep it in the outbox.
  if (!outbox().length) {
    try {
      const res = await rawRequest('/tracking/visits', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) return { queued: false, distanceM: res.data?.distanceM, shopLocationSaved: res.data?.shopLocationSaved, fix };
      if (res.status >= 400 && res.status < 500 && res.status !== 401) throw new Error(String(res.data?.error || 'Check-in rejected'));
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    }
  }
  push({ kind: 'visit', body });
  void flush();
  return { queued: true, fix };
}

/** Before logging out: end a running duty so tracking never continues for a signed-out user. */
export async function endDutyForLogout() {
  if (state.duty) await endDuty('logout').catch(() => undefined);
}

export async function openLocationSettings() {
  try {
    await GpsTracker.openSettings();
  } catch { /* web */ }
}
