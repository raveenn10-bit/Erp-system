'use client';
// Biometric login (Android only). See BiometricAuthPlugin.java for the
// Keystore design. The server session is always re-validated with /api/me,
// so roles and permissions are enforced exactly as for a normal login.
import { registerPlugin } from '@capacitor/core';
import { api, apiBase, ApiError } from './api';
import { isNative } from './native';

export type BiometricStatus = {
  biometric: boolean; deviceCredentialFallback: boolean;
  reason: 'ok' | 'none_enrolled' | 'no_hardware' | 'unavailable' | 'security_update' | 'unsupported';
  enabled: boolean; userId: string | null; userName: string | null;
};
interface BiometricAuthPlugin {
  status(): Promise<BiometricStatus>;
  enable(o: { url: string; userId: string; userName: string }): Promise<{ enabled: boolean }>;
  unlock(): Promise<{ userId: string; userName: string }>;
  disable(): Promise<void>;
  lock(o?: { url?: string }): Promise<void>;
  addListener(event: 'locked', fn: () => void): Promise<{ remove: () => Promise<void> }>;
}
const Bio = registerPlugin<BiometricAuthPlugin>('BiometricAuth');
type Me = { user: { id: string; name: string; admin?: number } };

const OFF: BiometricStatus = { biometric: false, deviceCredentialFallback: false, reason: 'unsupported', enabled: false, userId: null, userName: null };
export async function biometricStatus(): Promise<BiometricStatus> {
  if (!isNative() || !apiBase) return OFF;
  try { return await Bio.status(); } catch { return OFF; }
}

/** Plain-language messages (English + Sinhala) for plugin error codes. */
export function biometricError(e: unknown): { code: string; message: string } | null {
  const code = (e as { code?: string })?.code || 'ERROR';
  if (code === 'CANCELLED') return null; // user chose to cancel — not an error
  const msg: Record<string, string> = {
    LOCKOUT: 'Too many attempts. Wait 30 seconds or use your PIN or password. · උත්සාහයන් වැඩියි.',
    LOCKOUT_PERMANENT: 'Biometrics are locked. Unlock your phone with its PIN first, or use your ERP PIN/password.',
    ENROLLMENT_CHANGED: 'Fingerprints or face changed on this phone. Sign in with PIN or password, then turn biometrics on again.',
    NOT_AVAILABLE: 'No fingerprint or face is set up on this phone. · ජෛවමිතික සකසා නැත.',
    SESSION_EXPIRED: 'Your saved sign-in has expired. Please sign in with PIN or password. · නැවත පිවිසෙන්න.',
    NO_SESSION: 'Please sign in first, then turn on biometrics.',
    OFFLINE: 'No internet and no saved data on this phone yet. Connect once, then try again. · අන්තර්ජාලය නැත.',
  };
  return { code, message: msg[code] || (e as Error)?.message || 'Biometric sign-in failed. Use PIN or password.' };
}

export async function enableBiometric(user: { id: string; name: string }) {
  await Bio.enable({ url: apiBase, userId: user.id, userName: user.name });
}

export async function disableBiometric() {
  if (!isNative()) return;
  try { await Bio.disable(); } catch { /* nothing saved */ }
}

/**
 * Unlocks the Keystore-protected session, then asks the server who we are.
 * Any mismatch, expiry or revocation wipes the saved credential.
 */
export async function signInWithBiometrics(): Promise<Me['user']> {
  const saved = await Bio.unlock();
  let me: Me;
  try { me = await api<Me>('/me'); }
  catch (e) {
    // Offline with no usable cache: keep the credential, just can't open yet.
    if (!(e instanceof ApiError)) { await Bio.lock().catch(() => {}); throw Object.assign(new Error('No internet and no saved data on this phone yet. Connect once, then try again.'), { code: 'OFFLINE' }); }
    await Bio.lock().catch(() => {});
    if (e.status === 401) await disableBiometric(); // revoked / expired on the server
    throw Object.assign(new Error(e.message), { code: e.status === 401 ? 'SESSION_EXPIRED' : 'ERROR' });
  }
  if (me.user.id !== saved.userId) {
    await Bio.lock().catch(() => {}); await disableBiometric();
    throw Object.assign(new Error('Different user'), { code: 'SESSION_EXPIRED' });
  }
  return me.user;
}

/** Redirect to login when the native side locks the app after background time. */
export async function onBiometricLock(fn: () => void) {
  if (!isNative()) return () => {};
  const h = await Bio.addListener('locked', fn);
  return () => { h.remove(); };
}

const DISMISS_KEY = 'biometric-offer-dismissed';
export async function offerDismissed(userId: string) {
  const { Preferences } = await import('@capacitor/preferences');
  return (await Preferences.get({ key: `${DISMISS_KEY}:${userId}` })).value === '1';
}
export async function dismissOffer(userId: string) {
  const { Preferences } = await import('@capacitor/preferences');
  await Preferences.set({ key: `${DISMISS_KEY}:${userId}`, value: '1' });
}
