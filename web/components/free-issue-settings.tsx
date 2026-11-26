'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Minus, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { DEFAULT_TIERS, defaultRules, describeTiers, effectiveRules, freeQuantity, type FreeIssueRule, type FreeTier } from '@/lib/free-issue';

type Prod = { variant_id: string; name: string; label: string; grams?: number | null };

function Stepper({ value, min, onChange, label }: { value: number; min: number; onChange: (n: number) => void; label: string }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const commit = (raw: string) => { const n = Math.max(min, Math.floor(Number(raw) || 0)); setT(String(n)); if (n !== value) onChange(n); };
  return (
    <span className="num-row fi-step">
      <button type="button" className="secondary" aria-label={`Decrease ${label}`} onClick={() => commit(String(value - 1))} disabled={value <= min}><Minus size={14} /></button>
      <input type="text" inputMode="numeric" aria-label={label} value={t} onChange={e => setT(e.target.value.replace(/\D/g, ''))} onBlur={e => commit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <button type="button" className="secondary" aria-label={`Increase ${label}`} onClick={() => commit(String(value + 1))}><Plus size={14} /></button>
    </span>
  );
}

/** Settings › Free issue offers: buy-X-get-Y rules applied automatically while billing. Admin only. */
export function FreeIssueSettings() {
  const client = useQueryClient();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Prod[]>('/products') });
  const saved = useQuery({ queryKey: ['print-settings'], queryFn: () => api<{ freeIssueRules?: FreeIssueRule[] | null }>('/billing/print-settings') });
  const [rules, setRules] = useState<FreeIssueRule[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const prods = products.data || [];
  const usingDefault = !Array.isArray(saved.data?.freeIssueRules);
  useEffect(() => {
    if (products.data && saved.data && rules === null) setRules(effectiveRules(saved.data.freeIssueRules, products.data));
  }, [products.data, saved.data, rules]);
  const byId = useMemo(() => new Map((rules || []).map(r => [r.variantId, r])), [rules]);

  const setRule = (variantId: string, patch: Partial<FreeIssueRule> | null) =>
    setRules(cur => {
      const list = (cur || []).filter(r => r.variantId !== variantId);
      if (patch === null) return list;
      const old = (cur || []).find(r => r.variantId === variantId) || { variantId, active: true, tiers: DEFAULT_TIERS };
      return [...list, { ...old, ...patch }];
    });
  const setTier = (variantId: string, i: number, t: Partial<FreeTier>) => {
    const r = byId.get(variantId)!; const tiers = r.tiers.map((x, j) => (j === i ? { ...x, ...t } : x));
    setRule(variantId, { tiers });
  };

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const clean = (rules || []).map(r => ({ ...r, tiers: r.tiers.filter(t => t.buy > 0 && t.free > 0) })).filter(r => r.tiers.length);
      // Save products without an offer as switched off, so the 50/100/200 g default doesn't come back for them.
      const listed = new Set(clean.map(r => r.variantId));
      for (const p of prods) if (!listed.has(p.variant_id)) clean.push({ variantId: p.variant_id, active: false, tiers: DEFAULT_TIERS });
      await api('/billing/settings', { method: 'PATCH', body: JSON.stringify({ freeIssueRules: clean }) });
      await client.invalidateQueries({ queryKey: ['print-settings'] });
      setMsg({ t: 'Free issue offers saved — billing uses them on every phone and the web.', ok: true });
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
    finally { setBusy(false); }
  }

  if (!rules) return <section className="panel fi"><div className="loader" /></section>;
  return (
    <section className="panel fi" aria-label="Free issue offers">
      <div className="panel-head"><h3><Gift size={18} /> Free issue offers · <span lang="si">නොමිලේ දීමනා</span></h3></div>
      <p className="muted">
        Free packets are added to the bill automatically for the products below. The biggest offer is used first, then the next
        (e.g. 12 → 1, 24 → 3: 24 packets = 3 free, 36 = 4 free). {usingDefault && <b>Using the default: 50 g, 100 g, 200 g packs → 12 → 1, 24 → 3.</b>}
      </p>
      <ul className="fi-list">
        {prods.map(p => {
          const r = byId.get(p.variant_id);
          return (
            <li key={p.variant_id} className={r?.active ? 'on' : ''}>
              <div className="fi-head">
                <label className="check-field">
                  <input type="checkbox" checked={!!r?.active} onChange={e => (r ? setRule(p.variant_id, { active: e.target.checked }) : setRule(p.variant_id, { active: true, tiers: DEFAULT_TIERS }))} />
                  <span><b>{p.name}</b><small>{p.label}</small></span>
                </label>
                {r && <button type="button" className="secondary icon-only" aria-label={`Remove offer for ${p.label}`} onClick={() => setRule(p.variant_id, null)}><Trash2 size={14} /></button>}
              </div>
              {r?.active && (
                <div className="fi-tiers">
                  {r.tiers.map((t, i) => (
                    <div key={i} className="fi-tier">
                      <span>Buy</span><Stepper label="Buy quantity" value={t.buy} min={1} onChange={n => setTier(p.variant_id, i, { buy: n })} />
                      <span>Free</span><Stepper label="Free quantity" value={t.free} min={1} onChange={n => setTier(p.variant_id, i, { free: n })} />
                      {r.tiers.length > 1 && <button type="button" className="secondary icon-only" aria-label="Remove tier" onClick={() => setRule(p.variant_id, { tiers: r.tiers.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>}
                    </div>
                  ))}
                  <div className="fi-foot">
                    <button type="button" className="secondary" disabled={r.tiers.length >= 10} onClick={() => setRule(p.variant_id, { tiers: [...r.tiers, { buy: (Math.max(...r.tiers.map(x => x.buy)) || 12) + 12, free: 1 }] })}><Plus size={14} /> Add level</button>
                    <small>{describeTiers(r.tiers)} · e.g. 12 → {freeQuantity(12, r.tiers)}, 24 → {freeQuantity(24, r.tiers)}, 36 → {freeQuantity(36, r.tiers)}</small>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {!prods.length && <li className="muted">Add products first.</li>}
      </ul>
      {msg && <p className={`ninv-msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.t}</p>}
      <div className="form-actions">
        <button type="button" className="primary" disabled={busy} onClick={save}><Save size={16} /> {busy ? 'Saving…' : 'Save offers'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setRules(defaultRules(prods))}><RotateCcw size={16} /> Reset to default (50/100/200 g)</button>
      </div>
    </section>
  );
}
