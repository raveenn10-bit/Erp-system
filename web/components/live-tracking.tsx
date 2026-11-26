'use client';
// Admin "Live Rep Tracking": live map of reps on duty + day-wise route history.
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Battery, Clock, MapPin, Navigation, RefreshCw, Route, Store } from 'lucide-react';
import type * as Leaflet from 'leaflet';
import { api, money } from '@/lib/api';

type LiveRep = {
  id: string; name: string; username?: string; onDuty: boolean; dutyStartedAt: string | null;
  status: 'online' | 'no_signal' | 'off_duty';
  lat: number | null; lng: number | null; accuracyM: number | null; battery: number | null;
  lastFixAt: string | null; lastSeenAt: string | null; source: string | null;
  todayDistanceM: number; todayVisits: number;
};
type Live = { serverTime: string; reps: LiveRep[] };
type HistPoint = { session_id?: string; lat: number; lng: number; t: string; acc: number | null; speed: number | null; battery: number | null };
type History = {
  user: { id: string; name: string }; date: string; points: HistPoint[]; distanceM: number;
  sessions: Array<{ id: string; started_at: string; ended_at: string | null; end_reason: string | null; source: string }>;
  visits: Array<{ id: string; visited_at: string; lat: number | null; lng: number | null; accuracy_m: number | null; distance_m: number | null; note: string; customer_id: string; shop_name: string; shop_lat: number | null; shop_lng: number | null }>;
  invoices: Array<{ id: string; number: string; created_at: string; total_cents: number; shop_name: string; shop_lat: number | null; shop_lng: number | null; at: { lat: number; lng: number } | null }>;
};

const TZ = 'Asia/Colombo';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const hm = (iso?: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const km = (m: number) => `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
function ago(iso?: string | null) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
const STATUS = {
  online: { label: 'Online · සජීවී', color: '#1f9d55' },
  no_signal: { label: 'On duty, no signal · සංඥා නැත', color: '#d97706' },
  off_duty: { label: 'Off duty · රාජකාරියෙන් පිට', color: '#8a9a96' },
} as const;
function duration(a: string, b?: string | null) {
  const mins = Math.max(0, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
function totalDuty(sessions: Array<{ started_at: string; ended_at: string | null }>) {
  const mins = sessions.reduce((m, s) => m + Math.max(0, Math.round(((s.ended_at ? Date.parse(s.ended_at) : Date.now()) - Date.parse(s.started_at)) / 60000)), 0);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Leaflet map (loaded only in the browser). `draw` re-renders the overlay layer. */
function MapView({ draw, fitKey }: { draw: (L: typeof Leaflet, layer: Leaflet.LayerGroup) => Leaflet.LatLngBounds | null; fitKey: string }) {
  const el = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ L: typeof Leaflet; map: Leaflet.Map; layer: Leaflet.LayerGroup } | null>(null);
  const [ready, setReady] = useState(false);
  const lastFit = useRef('');
  useEffect(() => {
    let alive = true;
    import('leaflet').then((mod) => {
      const L = (mod.default || mod) as typeof Leaflet;
      if (!alive || !el.current || ctx.current) return;
      const map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([7.2, 80.6], 8); // Sri Lanka
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);
      ctx.current = { L, map, layer: L.layerGroup().addTo(map) };
      setReady(true);
    });
    return () => {
      alive = false;
      ctx.current?.map.remove();
      ctx.current = null;
    };
  }, []);
  useEffect(() => {
    const c = ctx.current;
    if (!ready || !c) return;
    c.layer.clearLayers();
    const bounds = draw(c.L, c.layer);
    // Fit only when the selection changes, not on every 30 s refresh (keeps the user's zoom).
    if (bounds && bounds.isValid() && lastFit.current !== fitKey) {
      lastFit.current = fitKey;
      c.map.fitBounds(bounds.pad(0.2), { maxZoom: 16 });
    }
    setTimeout(() => c.map.invalidateSize(), 50);
  }, [ready, draw, fitKey]);
  return <div ref={el} className="lt-map" role="application" aria-label="Map" />;
}

export function LiveTracking() {
  const [rep, setRep] = useState('');
  const [date, setDate] = useState(today());
  const isToday = date === today();
  const live = useQuery({ queryKey: ['tracking-live'], queryFn: () => api<Live>('/tracking/live'), refetchInterval: 30000, refetchIntervalInBackground: false });
  const history = useQuery({
    queryKey: ['tracking-history', rep, date],
    queryFn: () => api<History>(`/tracking/history?userId=${encodeURIComponent(rep)}&date=${date}`),
    enabled: !!rep,
    refetchInterval: rep && isToday ? 30000 : false,
  });
  const reps = live.data?.reps || [];
  const selected = reps.find((r) => r.id === rep);

  const draw = useMemo(
    () => (L: typeof Leaflet, layer: Leaflet.LayerGroup) => {
      const all: Leaflet.LatLngExpression[] = [];
      const dot = (lat: number, lng: number, color: string, radius = 8, opts: Partial<Leaflet.CircleMarkerOptions> = {}) =>
        L.circleMarker([lat, lng], { radius, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, ...opts });
      if (!rep) {
        for (const r of reps) {
          if (r.lat == null || r.lng == null) continue;
          const s = STATUS[r.status];
          if (r.accuracyM && r.status === 'online') L.circle([r.lat, r.lng], { radius: r.accuracyM, color: s.color, weight: 1, fillOpacity: 0.08 }).addTo(layer);
          dot(r.lat, r.lng, s.color, 9)
            .bindTooltip(esc(r.name), { permanent: true, direction: 'top', offset: [0, -8], className: 'lt-label' })
            .bindPopup(`<b>${esc(r.name)}</b><br>${s.label}<br>Last GPS: ${ago(r.lastFixAt)}${r.accuracyM != null ? ` (±${Math.round(r.accuracyM)} m)` : ''}${r.battery != null ? `<br>Battery ${r.battery}%` : ''}`)
            .addTo(layer);
          all.push([r.lat, r.lng]);
        }
        return all.length ? L.latLngBounds(all) : null;
      }
      const h = history.data;
      if (h) {
        // One line per duty period (no straight line across the gap between two duties).
        const bySession = new Map<string, [number, number][]>();
        for (const p of h.points) {
          if (p.acc != null && p.acc > 100) continue;
          const k = p.session_id || '';
          bySession.set(k, [...(bySession.get(k) || []), [p.lat, p.lng]]);
        }
        for (const line of bySession.values()) {
          if (line.length > 1) L.polyline(line, { color: '#0C5051', weight: 4, opacity: 0.85 }).addTo(layer);
          all.push(...line);
        }
        const first = h.points[0],
          last = h.points[h.points.length - 1];
        if (first) dot(first.lat, first.lng, '#2563eb', 7).bindTooltip(`Start ${hm(first.t)}`).addTo(layer);
        if (last && !(isToday && selected?.status === 'online')) dot(last.lat, last.lng, '#111827', 7).bindTooltip(`Last ${hm(last.t)}`).addTo(layer);
        for (const v of h.visits) {
          const at = v.lat != null && v.lng != null ? [v.lat, v.lng] : v.shop_lat != null && v.shop_lng != null ? [v.shop_lat, v.shop_lng] : null;
          if (!at) continue;
          L.marker(at as [number, number], { icon: L.divIcon({ className: 'lt-pin visit', html: '<span>V</span>', iconSize: [24, 24], iconAnchor: [12, 24] }) })
            .bindPopup(`<b>${esc(v.shop_name)}</b><br>Visit ${hm(v.visited_at)}${v.distance_m != null ? `<br>${dist(v.distance_m)} from shop` : ''}${v.note ? `<br>${esc(v.note)}` : ''}`)
            .addTo(layer);
          all.push(at as [number, number]);
        }
        for (const i of h.invoices) {
          const at = i.at ? [i.at.lat, i.at.lng] : i.shop_lat != null && i.shop_lng != null ? [i.shop_lat, i.shop_lng] : null;
          if (!at) continue;
          L.marker(at as [number, number], { icon: L.divIcon({ className: 'lt-pin bill', html: '<span>B</span>', iconSize: [24, 24], iconAnchor: [12, 24] }) })
            .bindPopup(`<b>${esc(i.number)}</b><br>${esc(i.shop_name)}<br>${hm(i.created_at)} · ${money(i.total_cents)}`)
            .addTo(layer);
          all.push(at as [number, number]);
        }
      }
      if (isToday && selected?.lat != null && selected.lng != null) {
        const s = STATUS[selected.status];
        dot(selected.lat, selected.lng, s.color, 10).bindTooltip(`${esc(selected.name)} · ${ago(selected.lastFixAt)}`, { permanent: true, direction: 'top', offset: [0, -9], className: 'lt-label' }).addTo(layer);
        all.push([selected.lat, selected.lng]);
      }
      return all.length ? L.latLngBounds(all) : null;
    },
    [rep, reps, history.data, isToday, selected],
  );

  const h = history.data;
  const loading = live.isLoading || (!!rep && history.isLoading);
  const error = (live.error || history.error) as Error | null;
  return (
    <div className="lt">
      <div className="panel lt-controls">
        <label>
          Sales rep · නියෝජිතයා
          <select value={rep} onChange={(e) => setRep(e.target.value)}>
            <option value="">All reps (live) · සියලු දෙනා</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date · දිනය
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} disabled={!rep} />
        </label>
        <button className="secondary" onClick={() => { live.refetch(); if (rep) history.refetch(); }} disabled={live.isFetching || history.isFetching}>
          <RefreshCw size={15} className={live.isFetching || history.isFetching ? 'spin' : ''} />
          Refresh
        </button>
        <span className="muted lt-updated">
          Updates every 30 s{live.dataUpdatedAt ? ` · ${hm(new Date(live.dataUpdatedAt).toISOString())}` : ''}
        </span>
      </div>
      {error && <div className="error">{error.message}</div>}

      <div className="panel lt-map-panel">
        <MapView draw={draw} fitKey={`${rep}|${date}|${rep ? (h ? 'h' : '') : reps.filter((r) => r.lat != null).length}`} />
        <div className="lt-legend">
          <span><i style={{ background: STATUS.online.color }} />Online</span>
          <span><i style={{ background: STATUS.no_signal.color }} />No signal</span>
          <span><i style={{ background: STATUS.off_duty.color }} />Off duty (last place)</span>
          {rep && <span><i className="sq visit" />Visit</span>}
          {rep && <span><i className="sq bill" />Bill</span>}
        </div>
        {loading && <div className="lt-loading">Loading…</div>}
      </div>

      {!rep && (
        <div className="lt-cards">
          {reps.map((r) => {
            const s = STATUS[r.status];
            return (
              <button key={r.id} className="panel lt-card" onClick={() => { setRep(r.id); setDate(today()); }}>
                <div className="lt-card-head">
                  <b>{r.name}</b>
                  <span className="lt-status" style={{ color: s.color }}>
                    <i style={{ background: s.color }} />
                    {s.label}
                  </span>
                </div>
                <div className="lt-card-grid">
                  <span><Clock size={13} /> Last seen {ago(r.lastSeenAt)}</span>
                  <span><MapPin size={13} /> GPS {ago(r.lastFixAt)}{r.accuracyM != null ? ` · ±${Math.round(r.accuracyM)} m` : ''}</span>
                  <span><Route size={13} /> Today {km(r.todayDistanceM)}</span>
                  <span><Store size={13} /> Visits {r.todayVisits}</span>
                  {r.battery != null && <span><Battery size={13} /> {r.battery}%</span>}
                  {r.onDuty && r.dutyStartedAt && <span><Navigation size={13} /> On duty {duration(r.dutyStartedAt)}</span>}
                </div>
              </button>
            );
          })}
          {!reps.length && !live.isLoading && <p className="muted">No sales reps yet. Add them in Team. · නියෝජිතයින් නැත.</p>}
        </div>
      )}

      {rep && h && (
        <>
          <div className="lt-summary">
            <div className="panel"><span>Distance · දුර</span><b>{km(h.distanceM)}</b><small>estimated from GPS</small></div>
            <div className="panel"><span>On duty · රාජකාරි කාලය</span><b>{h.sessions.length ? totalDuty(h.sessions) : '—'}</b><small>{h.sessions.length ? `${hm(h.sessions[0].started_at)}–${h.sessions[h.sessions.length - 1].ended_at ? hm(h.sessions[h.sessions.length - 1].ended_at) : 'now'}${h.sessions.length > 1 ? ` · ${h.sessions.length} duty periods` : ''}` : 'no duty this day'}</small></div>
            <div className="panel"><span>Shop visits · පැමිණීම්</span><b>{h.visits.length}</b><small>check-ins</small></div>
            <div className="panel"><span>Bills · බිල්පත්</span><b>{h.invoices.length}</b><small>{money(h.invoices.reduce((a, i) => a + i.total_cents, 0))}</small></div>
          </div>
          {!h.points.length && <p className="muted">No GPS points for {h.user.name} on {date}. · මෙදින GPS දත්ත නැත.</p>}
          <div className="panel">
            <div className="panel-head"><h3>Timeline · කාලරේඛාව</h3></div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead>
                <tbody>
                  {[
                    ...h.sessions.flatMap((s) => [
                      { t: s.started_at, e: 'Duty started', d: s.source === 'android' ? 'Android app' : 'Web browser' },
                      ...(s.ended_at ? [{ t: s.ended_at, e: 'Duty ended', d: s.end_reason === 'auto' ? 'Automatically (14 h limit)' : s.end_reason === 'superseded' ? 'New duty started on another device' : s.end_reason === 'logout' ? 'Signed out' : 'By rep' }] : []),
                    ]),
                    ...h.visits.map((v) => ({ t: v.visited_at, e: `Visit · ${v.shop_name}`, d: [v.distance_m != null ? `${dist(v.distance_m)} from shop` : v.lat == null ? 'no GPS' : 'shop location saved', v.note].filter(Boolean).join(' · ') })),
                    ...h.invoices.map((i) => ({ t: i.created_at, e: `Bill ${i.number} · ${i.shop_name}`, d: money(i.total_cents) })),
                  ]
                    .sort((a, b) => a.t.localeCompare(b.t))
                    .map((x, n) => (
                      <tr key={n}><td>{hm(x.t)}</td><td>{x.e}</td><td>{x.d}</td></tr>
                    ))}
                </tbody>
              </table>
              {!h.sessions.length && !h.visits.length && !h.invoices.length && <p className="muted" style={{ padding: 12 }}>Nothing recorded on this day.</p>}
            </div>
          </div>
        </>
      )}
      <p className="muted lt-privacy">Only admins can see this page. Reps are tracked only while on duty. · ස්ථාන දත්ත පරිපාලකට පමණි.</p>
    </div>
  );
}
