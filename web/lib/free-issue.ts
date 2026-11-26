// Buy-X-get-Y free issue offers applied while billing.
// Pure functions (unit-tested in scripts/free-issue.test.mjs).

export type FreeTier = { buy: number; free: number };
export type FreeIssueRule = { variantId: string; active: boolean; tiers: FreeTier[] };

/** Default offer: 12 packets → 1 free, 24 packets → 3 free — for the 50 g, 100 g and 200 g packs only. */
export const DEFAULT_TIERS: FreeTier[] = [{ buy: 12, free: 1 }, { buy: 24, free: 3 }];

/**
 * Free packets for a purchased quantity. Uses the biggest tier as many times as
 * it fits, then the next one, and so on:
 *   11 → 0, 12 → 1, 23 → 1, 24 → 3, 36 → 3 + 1 = 4, 48 → 6, 60 → 6 + 1 = 7.
 */
export function freeQuantity(qty: number, tiers: FreeTier[]): number {
  let left = Math.max(0, Math.floor(qty || 0)), free = 0;
  const sorted = tiers.filter(t => t.buy > 0 && t.free > 0).sort((a, b) => b.buy - a.buy);
  for (const t of sorted) {
    const times = Math.floor(left / t.buy);
    free += times * t.free;
    left -= times * t.buy;
  }
  return free;
}

/** Paid quantity per variant → free quantity per variant (only variants with an active rule). */
export function freeForLines(lines: Array<{ variantId: string; quantity: number }>, rules: FreeIssueRule[]): Map<string, number> {
  const paid = new Map<string, number>();
  for (const l of lines) if (l.variantId) paid.set(l.variantId, (paid.get(l.variantId) || 0) + Math.max(0, Math.floor(l.quantity || 0)));
  const out = new Map<string, number>();
  for (const r of rules) {
    if (!r.active) continue;
    const q = paid.get(r.variantId);
    if (!q) continue;
    const f = freeQuantity(q, r.tiers);
    if (f > 0) out.set(r.variantId, f);
  }
  return out;
}

/** Short description of a rule, e.g. "12 → 1 free · 24 → 3 free". */
export const describeTiers = (tiers: FreeTier[]) =>
  [...tiers].sort((a, b) => a.buy - b.buy).map(t => `${t.buy} → ${t.free} free`).join(' · ');

/**
 * Free packets are recorded on the invoice notes in a fixed, human-readable form
 * ("Free issue: Nugathalawa Ceylon Tea · 100g packet × 3") so the invoice, PDF and
 * receipt can show them as FREE. Notes are limited to 1000 characters by the server.
 */
export const FREE_PREFIX = 'Free issue: ';
export function freeNote(items: Array<{ name: string; quantity: number }>, notes: string): string {
  const line = items.length ? FREE_PREFIX + items.map(i => `${i.name} × ${i.quantity}`).join(', ') : '';
  return [line, notes].filter(Boolean).join('\n').slice(0, 1000);
}
/** Parse the free packets back from invoice notes: "name" → quantity. */
export function parseFreeNote(notes: string): Map<string, number> {
  const out = new Map<string, number>();
  const line = (notes || '').split('\n').find(l => l.startsWith(FREE_PREFIX));
  if (!line) return out;
  for (const part of line.slice(FREE_PREFIX.length).split(', ')) {
    const m = part.match(/^(.*) × (\d+)$/);
    if (m) out.set(m[1].trim(), Number(m[2]));
  }
  return out;
}

/** Pack sizes that get the default offer. */
export const DEFAULT_PACK_GRAMS = [50, 100, 200];
type ProductLike = { variant_id: string; label?: string; grams?: number | null };
const gramsOf = (p: ProductLike) => Number(p.grams) || Number(String(p.label || '').match(/(\d+)\s*g\b/i)?.[1] || 0);

/** Built-in default: 50 g / 100 g / 200 g variants → 12 → 1, 24 → 3. */
export function defaultRules(products: ProductLike[]): FreeIssueRule[] {
  return products.filter(p => DEFAULT_PACK_GRAMS.includes(gramsOf(p))).map(p => ({ variantId: p.variant_id, active: true, tiers: DEFAULT_TIERS }));
}
/** Saved rules from Settings, or the default when nothing was ever saved (null). */
export function effectiveRules(saved: FreeIssueRule[] | null | undefined, products: ProductLike[]): FreeIssueRule[] {
  if (!Array.isArray(saved)) return defaultRules(products);
  // A 50/100/200 g pack added after the offers were saved still gets the default offer;
  // anything the admin saved (including switched-off offers) wins.
  const known = new Set(saved.map(r => r.variantId));
  return [...saved, ...defaultRules(products).filter(r => !known.has(r.variantId))];
}
