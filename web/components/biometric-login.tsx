'use client';
import { useEffect, useRef, useState } from 'react';
import { Fingerprint, KeyRound, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '@/lib/api';
import {
  biometricError, biometricStatus, disableBiometric, dismissOffer, enableBiometric,
  offerDismissed, signInWithBiometrics, type BiometricStatus,
} from '@/lib/biometric';

/** Login screen block: shown only when biometric login is enabled on this phone. */
export function BiometricLoginPanel({ status, onSuccess, onUseFallback }: {
  status: BiometricStatus; onSuccess: () => void; onUseFallback: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reduced = useReducedMotion();
  const tried = useRef(false);

  async function go() {
    setBusy(true); setError('');
    try { await signInWithBiometrics(); onSuccess(); }
    catch (e) {
      const err = biometricError(e);
      if (err) setError(err.message);
      if (err && ['SESSION_EXPIRED', 'ENROLLMENT_CHANGED', 'KEY_MISSING', 'KEYSTORE', 'NOT_ENROLLED'].includes(err.code)) onUseFallback();
    } finally { setBusy(false); }
  }
  // Open the system prompt once automatically when the login screen appears.
  useEffect(() => { if (!tried.current) { tried.current = true; go(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bio-panel">
      <motion.button
        type="button" className="bio-orb" onClick={go} disabled={busy}
        aria-label="Sign in with biometrics"
        animate={reduced || busy ? undefined : { boxShadow: ['0 0 0 0 rgba(146,253,111,.55)', '0 0 0 18px rgba(146,253,111,0)'] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      >
        <Fingerprint size={46} strokeWidth={1.6} />
      </motion.button>
      <p className="bio-hello">Welcome back{status.userName ? `, ${status.userName}` : ''}</p>
      <button type="button" className="primary wide bio-btn" onClick={go} disabled={busy}>
        <Fingerprint size={18} /> {busy ? 'Waiting for fingerprint or face…' : 'Sign in with Biometrics'}
      </button>
      <span className="si bio-si" lang="si">ඇඟිලි සලකුණ හෝ මුහුණ මඟින් පිවිසෙන්න</span>
      {error && <div className="error" role="alert">{error}</div>}
      <button type="button" className="bio-fallback" onClick={onUseFallback}>
        <KeyRound size={15} /> Use PIN or Password · <span lang="si">PIN හෝ මුරපදය</span>
      </button>
    </div>
  );
}

/** Bottom sheet offered once after a successful PIN/password login. */
export function BiometricEnrollSheet({ user, onDone }: { user: { id: string; name: string }; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function enable() {
    setBusy(true); setError('');
    try { await enableBiometric(user); onDone(); }
    catch (e) { const err = biometricError(e); if (err) setError(err.message); }
    finally { setBusy(false); }
  }
  async function later() { await dismissOffer(user.id).catch(() => {}); onDone(); }
  return (
    <div className="bio-sheet-backdrop" data-overlay role="dialog" aria-modal="true" aria-labelledby="bio-title">
      <div className="bio-sheet">
        <button className="bio-sheet-close" aria-label="Close" data-close onClick={later}><X size={18} /></button>
        <div className="bio-sheet-icon"><Fingerprint size={34} /></div>
        <h3 id="bio-title">Sign in faster next time</h3>
        <p>Use your fingerprint or face to open Nugathalawa ERP on this phone.</p>
        <p className="si" lang="si">ඊළඟ වතාවේ ඇඟිලි සලකුණ හෝ මුහුණ මඟින් ඉක්මනින් පිවිසෙන්න.</p>
        <ul className="bio-points">
          <li><ShieldCheck size={15} /> Your fingerprint/face never leaves the phone</li>
          <li><ShieldCheck size={15} /> No password or PIN is stored</li>
          <li><ShieldCheck size={15} /> Turn it off any time in Settings</li>
        </ul>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary wide" onClick={enable} disabled={busy}><Fingerprint size={18} /> {busy ? 'Confirm on the prompt…' : 'Enable Biometric Login'}</button>
        <button className="secondary wide" onClick={later} disabled={busy}>Not now</button>
      </div>
    </div>
  );
}

/** Decide whether to offer enrolment right after a normal login. */
export async function shouldOfferBiometric(): Promise<{ id: string; name: string } | null> {
  const st = await biometricStatus();
  if (!st.biometric || st.enabled) return null;
  try {
    const { user } = await api<{ user: { id: string; name: string } }>('/me');
    return (await offerDismissed(user.id)) ? null : user;
  } catch { return null; }
}

/** Settings card: enable / disable biometric login on this device. */
export function BiometricSettings() {
  const [st, setSt] = useState<BiometricStatus | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => biometricStatus().then(setSt);
  useEffect(() => { refresh(); }, []);
  if (!st || st.reason === 'unsupported' && !st.enabled) return null; // web browser / non-Android
  async function toggle() {
    setBusy(true); setMsg(null);
    try {
      if (st!.enabled) { await disableBiometric(); setMsg({ t: 'Biometric login turned off. Saved credential removed from this phone.', ok: true }); }
      else {
        const { user } = await api<{ user: { id: string; name: string } }>('/me');
        await enableBiometric(user); setMsg({ t: 'Biometric login is on for this phone.', ok: true });
      }
    } catch (e) { const err = biometricError(e); if (err) setMsg({ t: err.message, ok: false }); }
    finally { setBusy(false); refresh(); }
  }
  const unavailable = !st.biometric && !st.enabled;
  return (
    <section className="panel bio-settings">
      <div className="bio-settings-row">
        <span className="bio-settings-icon">{st.enabled ? <Fingerprint size={22} /> : <ShieldOff size={22} />}</span>
        <div>
          <b>Biometric login <span lang="si">· ජෛවමිතික පිවිසුම</span></b>
          <small>
            {st.enabled ? `On for ${st.userName || 'this account'} on this phone`
              : unavailable ? (st.reason === 'none_enrolled' ? 'Add a fingerprint or face in Android Settings → Security first.' : 'This phone has no supported (strong) fingerprint or face sensor.')
              : 'Off — sign in with fingerprint or face instead of typing'}
          </small>
        </div>
        <button className={st.enabled ? 'secondary' : 'primary'} disabled={busy || unavailable} onClick={toggle} aria-pressed={st.enabled}>
          {busy ? '…' : st.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {msg && <p className={`ninv-msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.t}</p>}
    </section>
  );
}
