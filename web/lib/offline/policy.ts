// Pure rules for the offline queue (unit-tested in scripts/offline-policy.test.mjs).

/** Write endpoints that the server de-duplicates with an idempotencyKey. Only these are queued offline. */
const QUEUEABLE: Array<[RegExp, string]> = [
  [/^\/billing\/invoices$/, 'Invoice'],
  [/^\/payments$/, 'Payment'],
  [/^\/free-issues$/, 'Free Issue'],
  [/^\/consignments$/, 'Consignment'],
  [/^\/consignments\/[^/]+\/settlements$/, 'Consignment settlement'],
  [/^\/stock-transfers$/, 'Stock transfer'],
  [/^\/vehicle-loadings$/, 'Vehicle loading'],
  [/^\/daily-routes\/[^/]+\/reconciliation$/, 'End-of-day count'],
];

export function queueKind(method: string, path: string, body: unknown): string | null {
  if (method.toUpperCase() !== 'POST') return null;
  const key = (body as { idempotencyKey?: unknown } | null)?.idempotencyKey;
  if (typeof key !== 'string' || key.length < 16) return null;
  const hit = QUEUEABLE.find(([re]) => re.test(path));
  return hit ? hit[1] : null;
}

export type Outcome = 'synced' | 'conflict' | 'retry' | 'auth' | 'network';
/** How to treat a replay result. Never 'synced' without a 2xx from the server. */
export function classify(status: number | null): Outcome {
  if (status === null) return 'network';
  if (status >= 200 && status < 300) return 'synced';
  if (status === 401) return 'auth';                    // sign in again, keep pending
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'conflict';                                    // 400/403/404/409/422: server rejected → needs review
}

export const MAX_RETRIES = 8;
/** Bounded exponential backoff: 2s, 4s, 8s … capped at 5 min. */
export function backoffMs(retry: number): number { return Math.min(2000 * 2 ** Math.max(0, retry), 5 * 60 * 1000); }

/** Offline cached data may be used only this long after the last successful server contact. */
export const OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Short human reference the server returned for a synced operation. */
export function serverRef(data: unknown): string {
  const d = (data || {}) as Record<string, unknown>;
  return String(d.number ?? d.reference_number ?? d.referenceNumber ?? d.id ?? 'OK');
}
