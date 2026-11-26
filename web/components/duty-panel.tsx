'use client';
// Sales rep duty card: Start duty / End duty, live GPS status and shop check-ins.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LocateFixed, MapPin, Play, Square, X } from 'lucide-react';
import { api } from '@/lib/api';
import { checkIn, endDuty, getState, openLocationSettings, startDuty, subscribe, type TrackingState } from '@/lib/tracking';

const time = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
function ago(iso?: string | null) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return time(iso);
}

const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export function DutyPanel({ userId, customers }: { userId: string; customers: Array<{ id: string; shop_name: string }> }) {
  const client = useQueryClient();
  const [s, setS] = useState<TrackingState>(getState());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [shop, setShop] = useState('');
  const [, tick] = useState(0);
  useEffect(() => subscribe(setS), []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  const visits = useQuery({ queryKey: ['my-visits'], queryFn: () => api<Array<{ id: string; visited_at: string; shop_name: string; distance_m: number | null }>>('/tracking/my-visits'), enabled: !!s.duty });

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      if (r) setMsg({ text: r, ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(null);
    }
  }
  const on = !!s.duty;
  return (
    <section className={`panel duty-panel ${on ? 'on' : ''}`} aria-label="Duty">
      <div className="duty-head">
        <div>
          <h3>
            <MapPin size={18} /> Duty · <span lang="si">රාජකාරිය</span>
          </h3>
          <span className={`badge ${on ? 'duty-on' : ''}`}>{on ? `On duty since ${time(s.duty!.startedAt)} · රාජකාරියේ` : 'Off duty · රාජකාරියෙන් පිට'}</span>
        </div>
        {!on ? (
          <button className="primary" disabled={!!busy} onClick={() => run('start', async () => { await startDuty(userId); return 'Duty started. Your location is shared with the office every 30 seconds. · රාජකාරිය ආරම්භ විය.'; })}>
            <Play size={16} />
            {busy === 'start' ? 'Getting GPS…' : 'Start duty · අරඹන්න'}
          </button>
        ) : !confirmEnd ? (
          <button className="danger" disabled={!!busy} onClick={() => setConfirmEnd(true)}>
            <Square size={15} />
            End duty · අවසන් කරන්න
          </button>
        ) : (
          <span className="confirm-pair">
            <button className="danger" disabled={!!busy} onClick={() => run('end', async () => { await endDuty('user'); setConfirmEnd(false); return 'Duty ended. Location sharing stopped. · රාජකාරිය අවසන්.'; })}>
              <Check size={15} />
              {busy === 'end' ? 'Ending…' : 'Yes, end duty'}
            </button>
            <button className="secondary" onClick={() => setConfirmEnd(false)} aria-label="Cancel">
              <X size={15} />
            </button>
          </span>
        )}
      </div>

      {!on && (
        <p className="muted duty-note">
          Location is shared with the admin only while you are on duty, and stops when you end duty. · ඔබේ ස්ථානය බෙදාගන්නේ රාජකාරියේ සිටින විට පමණයි.
        </p>
      )}

      {on && (
        <>
          <div className="duty-stats">
            <div>
              <span>Last GPS</span>
              <b>{ago(s.lastFix?.time)}</b>
              <small>{s.lastFix?.accuracy != null ? `±${Math.round(s.lastFix.accuracy)} m` : 'waiting for GPS…'}</small>
            </div>
            <div>
              <span>Sent to office</span>
              <b>{ago(s.lastSentAt)}</b>
              <small>{s.pending ? `${s.pending} waiting (offline)` : 'all sent'}</small>
            </div>
            <div>
              <span>Shops visited</span>
              <b>{visits.data?.length ?? 0}</b>
              <small>today</small>
            </div>
          </div>
          {s.mode === 'web' && (
            <p className="duty-warn">
              Browser tracking works only while this page is open and the screen is on. For all-day tracking (screen locked) use the Android app. · දුරකථන app එක භාවිතා කරන්න.
            </p>
          )}
          <div className="duty-checkin">
            <label>
              Check in at shop · කඩයට පැමිණීම
              <select value={shop} onChange={(e) => setShop(e.target.value)}>
                <option value="">Select a shop</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shop_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={!shop || !!busy}
              onClick={() =>
                run('checkin', async () => {
                  const r = await checkIn(shop);
                  setShop('');
                  await client.invalidateQueries({ queryKey: ['my-visits'] });
                  if (r.queued) return 'Check-in saved. It will be sent when the internet is back. · පසුව යවනු ලැබේ.';
                  if (!r.fix) return 'Checked in (no GPS fix — location not recorded).';
                  if (r.shopLocationSaved) return 'Checked in. Shop location saved on the map. · කඩයේ ස්ථානය සුරකින ලදී.';
                  return r.distanceM != null ? `Checked in · ${dist(r.distanceM)} from the saved shop location.` : 'Checked in. · සටහන් විය.';
                })
              }
            >
              <LocateFixed size={16} />
              {busy === 'checkin' ? 'Getting GPS…' : 'Check in'}
            </button>
          </div>
          {!!visits.data?.length && (
            <ul className="duty-visits">
              {visits.data.slice(0, 5).map((v) => (
                <li key={v.id}>
                  <span>{time(v.visited_at)}</span>
                  <b>{v.shop_name}</b>
                  {v.distance_m != null && <small>{dist(v.distance_m)}</small>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {(msg || s.error) && (
        <p className={`ninv-msg ${msg?.ok && !s.error ? 'ok' : 'bad'}`} role="status">
          {msg?.text || s.error}
          {!msg?.ok && /permission|අවසර/i.test(msg?.text || s.error || '') && s.mode === 'android' && (
            <button className="secondary small" style={{ marginLeft: 8 }} onClick={() => openLocationSettings()}>
              Open settings
            </button>
          )}
        </p>
      )}
    </section>
  );
}
