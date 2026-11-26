"use client";
// Admin-only record management: delete (void) / edit invoices, edit / delete
// products, edit / clear stock lines. All checks are repeated on the server.
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/lib/native";

/** Two-step inline confirm: first tap arms, second tap runs. No browser dialogs. */
export function ConfirmButton({
  label,
  confirmLabel = "Confirm",
  onConfirm,
  danger = true,
  disabled,
  small,
}: {
  label: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const [armed, setArmed] = useState(false),
    [busy, setBusy] = useState(false);
  const cls = `${danger ? "danger" : "secondary"}${small ? " small" : ""}`;
  if (!armed)
    return (
      <button type="button" className={cls} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  return (
    <span className="confirm-pair">
      <button
        type="button"
        className={`danger${small ? " small" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        <Check size={14} />
        {busy ? "…" : confirmLabel}
      </button>
      <button type="button" className={`secondary${small ? " small" : ""}`} disabled={busy} onClick={() => setArmed(false)}>
        <X size={14} />
      </button>
    </span>
  );
}

/* ---------------------------------------------------------------- invoices */

export function InvoiceAdminBar({
  id,
  status,
  onEdit,
  onDone,
}: {
  id: string;
  status: string;
  onEdit: () => void;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  if (status !== "posted")
    return <div className="admin-bar muted">මෙම invoice එක delete (void) කර ඇත · This invoice was deleted (voided).</div>;
  return (
    <div className="admin-bar">
      <span className="muted">Admin:</span>
      <button type="button" className="secondary small" onClick={onEdit}>
        <Pencil size={14} />
        Edit · සංස්කරණය
      </button>
      <ConfirmButton
        small
        label={
          <>
            <Trash2 size={14} />
            Delete · මකන්න
          </>
        }
        confirmLabel="Delete invoice"
        onConfirm={async () => {
          setError("");
          try {
            await api(`/invoices/${id}/void`, { method: "POST", body: JSON.stringify({ reason: "Deleted by admin" }) });
            toast("Invoice deleted — stock returned, payments reversed.");
            await client.invalidateQueries();
            onDone();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error && <div className="error" style={{ flexBasis: "100%" }}>{error}</div>}
      <div className="muted" style={{ flexBasis: "100%", fontSize: 12 }}>
        Delete කළාම stock එක ආපහු එකතු වෙනවා, ගෙවීම් reverse වෙනවා. Edit එකෙන් පරණ invoice එක void වෙලා අලුත් එකක් හැදෙනවා.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- products */

type VariantEdit = {
  id: string;
  label: string;
  unit: string;
  grams: number | null;
  retail_cents: number;
  wholesale_cents: number;
  shop_price_cents: number;
  cost_cents: number;
  low_stock: number;
};

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="dialog-backdrop" data-overlay onMouseDown={onClose} style={{ zIndex: 1400 }}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <div className="panel-head">
          <h3>{title}</h3>
          <button type="button" className="secondary small" onClick={onClose}>
            <X size={14} />
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const rs = (cents: number) => (cents / 100).toString();
const toCents = (v: string) => Math.max(0, Math.round((Number(v) || 0) * 100));

function ProductEditDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["product-edit", id],
    queryFn: () => api<{ product: { name: string; sku: string; barcode: string | null }; variants: VariantEdit[] }>(`/products/${id}`),
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!q.data) return;
    const f = new FormData(e.currentTarget),
      g = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setError("");
    try {
      await api(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: g("name"),
          sku: g("sku"),
          barcode: g("barcode") || null,
          variants: q.data.variants.map((v) => ({
            id: v.id,
            label: g(`${v.id}.label`),
            unit: g(`${v.id}.unit`),
            grams: Number(g(`${v.id}.grams`)) > 0 ? Math.round(Number(g(`${v.id}.grams`))) : null,
            wholesaleCents: toCents(g(`${v.id}.wholesale`)),
            retailCents: toCents(g(`${v.id}.retail`)),
            shopPriceCents: toCents(g(`${v.id}.shop`)),
            costCents: toCents(g(`${v.id}.cost`)),
            lowStock: Math.max(0, Math.round(Number(g(`${v.id}.low`)) || 0)),
          })),
        }),
      });
      toast("Product updated");
      await client.invalidateQueries();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Edit product · Product සංස්කරණය" onClose={onClose}>
      {q.isLoading && <p className="muted">Loading…</p>}
      {q.isError && <div className="error">{(q.error as Error).message}</div>}
      {q.data && (
        <form onSubmit={save}>
          {error && <div className="error">{error}</div>}
          <div className="form-grid">
            <label>
              Product name
              <input name="name" required defaultValue={q.data.product.name} />
            </label>
            <label>
              SKU
              <input name="sku" required defaultValue={q.data.product.sku} />
            </label>
            <label>
              Barcode
              <input name="barcode" defaultValue={q.data.product.barcode || ""} />
            </label>
          </div>
          {q.data.variants.map((v) => (
            <fieldset key={v.id} className="variant-edit">
              <legend>{v.label}</legend>
              <div className="form-grid">
                <label>
                  Variant / pack
                  <input name={`${v.id}.label`} required defaultValue={v.label} />
                </label>
                <label>
                  Unit
                  <input name={`${v.id}.unit`} required defaultValue={v.unit} />
                </label>
                <label>
                  Grams
                  <input name={`${v.id}.grams`} type="number" min="0" defaultValue={v.grams ?? ""} />
                </label>
                <label>
                  Wholesale (Rs.)
                  <input name={`${v.id}.wholesale`} type="number" min="0" step="0.01" required defaultValue={rs(v.wholesale_cents)} />
                </label>
                <label>
                  Retail (Rs.)
                  <input name={`${v.id}.retail`} type="number" min="0" step="0.01" required defaultValue={rs(v.retail_cents)} />
                </label>
                <label>
                  Shop selling (Rs.)
                  <input name={`${v.id}.shop`} type="number" min="0" step="0.01" defaultValue={rs(v.shop_price_cents)} />
                </label>
                <label>
                  Cost (Rs.)
                  <input name={`${v.id}.cost`} type="number" min="0" step="0.01" required defaultValue={rs(v.cost_cents)} />
                </label>
                <label>
                  Low stock alert
                  <input name={`${v.id}.low`} type="number" min="0" defaultValue={v.low_stock} />
                </label>
              </div>
            </fieldset>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>
            මිල වෙනස් කළාම අලුත් invoices වලට විතරයි බලපාන්නේ. පරණ invoices වෙනස් වෙන්නේ නැහැ.
          </p>
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save product"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function ProductAdminActions({ productId, name }: { productId: string; name: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  return (
    <span className="row-actions">
      <button type="button" className="secondary small" aria-label={`Edit ${name}`} onClick={() => setEditing(true)}>
        <Pencil size={14} />
        Edit
      </button>
      <ConfirmButton
        small
        label={<Trash2 size={14} aria-label={`Delete ${name}`} />}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            const r = await api<{ mode: "deleted" | "archived" }>(`/products/${productId}`, { method: "DELETE" });
            toast(
              r.mode === "deleted"
                ? `${name} deleted`
                : `${name} removed from the list (kept in old invoices as history)`,
            );
            await client.invalidateQueries();
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      />
      {editing && <ProductEditDialog id={productId} onClose={() => setEditing(false)} />}
    </span>
  );
}

/* ------------------------------------------------------------------- stock */

export function StockAdminActions({
  warehouseId,
  variantId,
  quantity,
}: {
  warehouseId: string;
  variantId: string;
  quantity: number;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(String(quantity)),
    [busy, setBusy] = useState(false);
  async function set(q: number) {
    setBusy(true);
    try {
      await api("/stock/set", { method: "POST", body: JSON.stringify({ warehouseId, variantId, quantity: q }) });
      toast(q === 0 ? "Stock cleared" : "Stock updated");
      setEditing(false);
      await client.invalidateQueries();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <span className="row-actions">
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 80 }}
          aria-label="New quantity"
        />
        <button
          type="button"
          className="primary small"
          disabled={busy || value === "" || Number(value) < 0}
          onClick={() => set(Math.round(Number(value)))}
        >
          <Check size={14} />
        </button>
        <button type="button" className="secondary small" onClick={() => setEditing(false)}>
          <X size={14} />
        </button>
      </span>
    );
  return (
    <span className="row-actions">
      <button
        type="button"
        className="secondary small"
        onClick={() => {
          setValue(String(quantity));
          setEditing(true);
        }}
      >
        <Pencil size={14} />
        Edit
      </button>
      <ConfirmButton
        small
        disabled={quantity === 0}
        label={<Trash2 size={14} aria-label="Clear stock" />}
        confirmLabel="Set 0"
        onConfirm={() => set(0)}
      />
    </span>
  );
}
