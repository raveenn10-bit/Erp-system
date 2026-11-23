'use client';
// Live updates: screens, invoices, sync logic (the web bundle) update without
// reinstalling the APK. Each CI build publishes bundle.zip + bundle.json on
// the GitHub release. A bundle is only applied when its NATIVE version equals
// this APK's, so web code never runs against native code it wasn't built for;
// native changes still require the APK (see lib/updates.ts).
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './native';

export const BUILD_CODE = Number(process.env.NEXT_PUBLIC_BUILD_CODE || 0);
export const NATIVE_VERSION = Number(process.env.NEXT_PUBLIC_NATIVE_VERSION || 0);
export type BundleManifest = { code: number; version: string; nativeVersion: number; url: string; checksum: string; notes?: string };

/** Confirms the running bundle started fine; without this the plugin rolls back to the previous one. */
export async function markAppReady() {
  if (!isNative()) return;
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  await CapacitorUpdater.notifyAppReady().catch(() => {});
}

export async function getManifest(url: string): Promise<BundleManifest | null> {
  try {
    const res = await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 10000, readTimeout: 15000 });
    if (res.status !== 200) return null;
    const m = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    return m?.code && m?.url ? (m as BundleManifest) : null;
  } catch { return null; }
}

let busy = false;
/**
 * Downloads + verifies (sha256) a newer, native-compatible bundle and queues
 * it for the next app start. Returns true when an update is staged.
 */
export async function stageBundle(m: BundleManifest): Promise<boolean> {
  if (!isNative() || busy || !BUILD_CODE) return false;
  if (m.code <= BUILD_CODE || m.nativeVersion !== NATIVE_VERSION || !/^[a-f0-9]{64}$/.test(m.checksum)) return false;
  busy = true;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const { bundles } = await CapacitorUpdater.list();
    let bundle = bundles.find(b => b.version === m.version && b.status !== 'error');
    if (!bundle) bundle = await CapacitorUpdater.download({ url: m.url, version: m.version, checksum: m.checksum });
    await CapacitorUpdater.next({ id: bundle.id }); // applied when the app is next opened / backgrounded
    window.dispatchEvent(new CustomEvent('erp-live-update-ready', { detail: m }));
    return true;
  } catch { return false; } finally { busy = false; }
}

/** Apply a downloaded update right now (reloads the app screens). */
export async function applyLiveUpdateNow() {
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  const next = await CapacitorUpdater.getNextBundle().catch(() => null);
  if (next?.id) await CapacitorUpdater.set({ id: next.id });
}
