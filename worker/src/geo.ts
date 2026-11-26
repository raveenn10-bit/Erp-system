// Pure GPS helpers (unit-tested in test/tracking.test.ts).

export type GeoPoint = { lat: number; lng: number; t: string; acc?: number | null };

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points worse than this are not used for distance. */
export const MAX_ACCURACY_FOR_DISTANCE_M = 100;
/** Anything faster than this between two points is a GPS jump, not travel (≈180 km/h). */
export const MAX_SPEED_MPS = 50;

/**
 * Estimated travel distance (metres) along time-ordered points. Inaccurate fixes
 * and impossible jumps are skipped; small jitter under the combined accuracy is ignored.
 */
export function routeDistance(points: GeoPoint[]): number {
  let total = 0;
  let prev: GeoPoint | null = null;
  for (const p of points) {
    if (p.acc != null && p.acc > MAX_ACCURACY_FOR_DISTANCE_M) continue;
    if (!prev) {
      prev = p;
      continue;
    }
    const d = haversine(prev, p);
    const secs = Math.max(1, (Date.parse(p.t) - Date.parse(prev.t)) / 1000);
    if (d / secs > MAX_SPEED_MPS) continue; // jump: keep the previous anchor
    const jitter = Math.max(10, ((prev.acc ?? 0) + (p.acc ?? 0)) / 2);
    if (d < jitter) continue; // standing still: don't add noise, keep anchor
    total += d;
    prev = p;
  }
  return Math.round(total);
}

/** Store a point if it moved, or if enough time passed (keeps the database small). */
export const KEEP_MIN_MOVE_M = 15;
export const KEEP_MAX_GAP_MS = 5 * 60 * 1000;
export function shouldStore(last: GeoPoint | null, p: GeoPoint): boolean {
  if (!last) return true;
  const gap = Date.parse(p.t) - Date.parse(last.t);
  if (gap >= KEEP_MAX_GAP_MS || gap < 0) return true; // gap<0: late offline point from earlier in the day
  if (p.acc != null && p.acc > 200) return false;
  return haversine(last, p) >= Math.max(KEEP_MIN_MOVE_M, Math.min(p.acc ?? 0, 50));
}

/** UTC ISO range of a calendar day in Sri Lanka (Asia/Colombo, UTC+05:30, no DST). */
export function colomboDayRange(date: string): { from: string; to: string } {
  const from = new Date(`${date}T00:00:00+05:30`);
  if (Number.isNaN(from.getTime())) throw new Error("Invalid date");
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}
export const colomboToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Distance of each duty session added up (no straight line between two sessions). */
export function sessionsDistance(points: Array<GeoPoint & { session_id?: string }>): number {
  const groups = new Map<string, GeoPoint[]>();
  for (const p of points) {
    const k = p.session_id || "";
    const g = groups.get(k) || [];
    g.push(p);
    groups.set(k, g);
  }
  let total = 0;
  for (const g of groups.values()) total += routeDistance(g);
  return total;
}
