'use client';
// In-app update check. Every CI build is published as a GitHub Release
// tagged android-v1.0.<versionCode>; the installed app compares its own
// versionCode (App.getInfo().build) with the newest release.
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './native';
import { NATIVE_VERSION, getManifest, stageBundle } from './live-update';

const REPO = 'raveenn10-bit/Erp-app';
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/Nugathalawa-ERP.apk`;
const CHECK_EVERY_MS = 2 * 60 * 1000; // re-check at most every 2 minutes (well within GitHub's 60 requests/hour)
const SNOOZE_MS = 2 * 60 * 60 * 1000; // 'Later' hides a version for 2 hours

export type UpdateInfo = { version: string; code: number; current: string; notes: string; url: string };

async function pref(key: string, value?: string) {
  const { Preferences } = await import('@capacitor/preferences');
  if (value === undefined) return (await Preferences.get({ key })).value;
  await Preferences.set({ key, value });
  return value;
}

export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  if (!isNative()) return null;
  const now = Date.now();
  const { App } = await import('@capacitor/app');
  const info = await App.getInfo();
  const current = Number(info.build) || 0;
  if (!force && now - Number((await pref('update-last-check')) || 0) < CHECK_EVERY_MS) {
    const cached = await pref('update-available');
    const c: UpdateInfo | null = cached ? JSON.parse(cached) : null;
    return c && c.code > current ? filterSnoozed({ ...c, current: info.version }) : null;
  }
  const res = await CapacitorHttp.get({
    url: `https://api.github.com/repos/${REPO}/releases/latest`,
    headers: { Accept: 'application/vnd.github+json' }, responseType: 'json', connectTimeout: 10000, readTimeout: 15000,
  });
  await pref('update-last-check', String(now));
  if (res.status !== 200) return null;
  const rel = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  const code = Number(String(rel.tag_name || '').match(/android-v\d+\.\d+\.(\d+)/)?.[1] || 0);
  if (!code || code <= current) { await pref('update-available', ''); return null; }
  // Live update path: if the newest build needs no new native code, download its
  // web bundle silently instead of asking the user to install an APK.
  const manifestAsset = (rel.assets || []).find((a: { name: string }) => a.name === 'bundle.json');
  if (manifestAsset) {
    const m = await getManifest(manifestAsset.browser_download_url);
    if (m && m.nativeVersion <= NATIVE_VERSION) {
      await pref('update-available', '');
      void stageBundle(m);
      return null;
    }
  }
  const asset = (rel.assets || []).find((a: { name: string }) => a.name === 'Nugathalawa-ERP.apk');
  const upd: UpdateInfo = {
    version: `1.0.${code}`, code, current: info.version,
    notes: String(rel.body || '').split('\n').find((l: string) => l.trim() && !l.startsWith('Android test build') && !l.startsWith('Direct download'))?.trim() || '',
    url: asset?.browser_download_url || APK_URL,
  };
  await pref('update-available', JSON.stringify(upd));
  return force ? upd : filterSnoozed(upd); // a manual / start-up check always shows it
}

async function filterSnoozed(u: UpdateInfo): Promise<UpdateInfo | null> {
  const until = Number((await pref(`update-snooze-${u.code}`)) || 0);
  return Date.now() < until ? null : u;
}
export async function snoozeUpdate(u: UpdateInfo) { await pref(`update-snooze-${u.code}`, String(Date.now() + SNOOZE_MS)); }

export async function appVersion(): Promise<string> {
  if (!isNative()) return '';
  const { App } = await import('@capacitor/app');
  const i = await App.getInfo();
  return `${i.version} (${i.build})`;
}
