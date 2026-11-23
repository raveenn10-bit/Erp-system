// Low-level transport shared by api() and the offline sync engine.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '';
export const isNativeApp = () => typeof window !== 'undefined' && Capacitor.isNativePlatform() && !!apiBase;
export type HttpResult = { ok: boolean; status: number; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Thrown when the server could not be reached at all (no HTTP status). */
export class NetworkError extends Error { constructor(msg = 'Cannot reach the ERP server') { super(msg); this.name = 'NetworkError'; } }

function nativeHeaders(): Record<string, string> {
  // Worker CSRF guard needs Origin on writes; native HTTP has none. See ANDROID.md.
  return isNativeApp() ? { Origin: new URL(apiBase).origin, 'X-ERP-Client': 'android' } : {};
}

// Android: native HTTP directly (Capacitor's fetch patch strips the Origin header).
async function nativeRequest(url: string, init: RequestInit): Promise<HttpResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...nativeHeaders(), ...(init.headers as Record<string, string> || {}) };
  let res;
  try {
    res = await CapacitorHttp.request({ url, method: (init.method || 'GET').toUpperCase(), headers, data: typeof init.body === 'string' ? init.body : undefined, responseType: 'json', connectTimeout: 15000, readTimeout: 30000 });
  } catch { throw new NetworkError(); }
  if (!res.status) throw new NetworkError();
  let data = res.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = { error: data || 'Unexpected response' }; } }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, data: data ?? {} };
}
async function webRequest(url: string, init: RequestInit): Promise<HttpResult> {
  let response: Response;
  try { response = await fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init.headers }, cache: 'no-store' }); }
  catch { throw new NetworkError(); }
  const data = await response.json().catch(() => ({ error: 'Unexpected response' }));
  return { ok: response.ok, status: response.status, data };
}

export function rawRequest(path: string, init: RequestInit = {}): Promise<HttpResult> {
  const url = `${apiBase}/api${path}`;
  return isNativeApp() ? nativeRequest(url, init) : webRequest(url, init);
}
