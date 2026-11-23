/**
 * Single authoritative invoice view-model.
 *
 * Every output (preview, A4 print, A4 PDF, WhatsApp PDF, thermal receipt)
 * is rendered from `InvoiceModel`. Values come straight from the finalised
 * invoice record returned by GET /api/invoices/:id — nothing is re-priced
 * or re-discounted here. The only derived figure is the outstanding balance
 * (total − paid), which is the same expression the ERP already uses.
 */

export type InvoiceDetail = {
  invoice: {
    id: string;
    number: string;
    created_at: string;
    shop_name: string;
    address?: string | null;
    whatsapp?: string | null;
    customer_whatsapp?: string | null;
    business_name?: string | null;
    business_address?: string | null;
    business_phone?: string | null;
    business_whatsapp?: string | null;
    business_email?: string | null;
    subtotal_cents: number;
    item_discount_cents: number;
    invoice_discount_cents: number;
    total_cents: number;
    paid_cents: number;
    due_at: string | null;
    payment_method?: string | null;
    payment_terms?: string | null;
    notes?: string | null;
    terms?: string | null;
    status: string;
  };
  items: Array<{
    id: string;
    name: string;
    label: string;
    quantity: number;
    unit_price_cents: number;
    shop_price_cents?: number | null;
    item_discount_cents: number;
    line_cents: number;
    price_type?: string | null;
  }>;
};

export type InvoiceLine = {
  id: string;
  description: string;
  pack: string;
  priceType: string;
  quantity: number;
  unitCents: number;
  shopPriceCents: number;
  discountCents: number;
  lineCents: number;
};

export type InvoiceModel = {
  id: string;
  number: string;
  dateLabel: string;
  timeLabel: string;
  status: string;
  cancelled: boolean;
  business: {
    name: string;
    address: string;
    phone: string;
    whatsapp: string;
    email: string;
  };
  customer: {
    shopName: string;
    address: string;
    whatsapp: string; // display format, "" when hidden or missing
    whatsappRaw: string;
  };
  lines: InvoiceLine[];
  subtotalCents: number;
  itemDiscountCents: number;
  invoiceDiscountCents: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  paymentMethod: string;
  paymentTerms: string;
  dueDate: string;
  notes: string;
  terms: string;
  showShopPrice: boolean;
};

export type DisplayOptions = {
  showShopPrice: boolean;
  showCustomerWhatsapp: boolean;
};

const TZ = "Asia/Colombo";
const FALLBACK_BUSINESS = "Nugathalawa Ceylon Tea Export (Pvt) Ltd";

/** "LKR 1,234.50" — plain ASCII spaces so PDF fonts and thermal printers render it. */
export function lkr(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}LKR ${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** Plain number without currency, for dense table cells. */
export function amount(cents: number): string {
  return lkr(cents).replace("LKR ", "");
}

export function normalizePhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) return "94" + digits.slice(1);
  if (digits.length === 9 && digits.startsWith("7")) return "94" + digits;
  return digits;
}

/** Sri Lankan mobile (94 7X XXX XXXX) or a plausible international number (E.164, 8–15 digits). */
export function validatePhone(phone: string): { ok: boolean; normalized: string; message: string } {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, normalized, message: "Enter a WhatsApp number." };
  if (normalized.startsWith("94")) {
    const ok = /^947\d{8}$/.test(normalized);
    return {
      ok,
      normalized,
      message: ok ? "" : "Sri Lankan mobile numbers look like 07X XXX XXXX.",
    };
  }
  const ok = /^[1-9]\d{7,14}$/.test(normalized);
  return {
    ok,
    normalized,
    message: ok ? "" : "Enter a valid number with country code, e.g. +44 7700 900123.",
  };
}

export function displayPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (/^947\d{8}$/.test(n)) return `+94 ${n.slice(2, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  return phone || "";
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  // D1 stores either ISO strings or "YYYY-MM-DD HH:MM:SS" (UTC).
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(" ", "T") + "Z" : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string): string {
  const d = parseDate(value);
  if (!d) return (value || "").slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatTime(value: string): string {
  const d = parseDate(value);
  if (!d || value.length <= 10) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

const titleCase = (s: string) =>
  (s || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

export function buildInvoiceModel(detail: InvoiceDetail, opts: DisplayOptions): InvoiceModel {
  const i = detail.invoice;
  const rawWa = i.customer_whatsapp || i.whatsapp || "";
  return {
    id: i.id,
    number: i.number,
    dateLabel: formatDate(i.created_at),
    timeLabel: formatTime(i.created_at),
    status: i.status,
    cancelled: i.status === "cancelled",
    business: {
      name: (i.business_name || "").trim() || FALLBACK_BUSINESS,
      address: (i.business_address || "").trim(),
      phone: (i.business_phone || "").trim(),
      whatsapp: (i.business_whatsapp || "").trim(),
      email: (i.business_email || "").trim(),
    },
    customer: {
      shopName: i.shop_name || "",
      address: (i.address || "").trim(),
      whatsapp: opts.showCustomerWhatsapp && rawWa ? displayPhone(rawWa) : "",
      whatsappRaw: rawWa,
    },
    lines: detail.items.map((x) => ({
      id: x.id,
      description: x.name,
      pack: x.label,
      priceType: titleCase(x.price_type || ""),
      quantity: x.quantity,
      unitCents: x.unit_price_cents,
      shopPriceCents: x.shop_price_cents || 0,
      discountCents: x.item_discount_cents || 0,
      lineCents: x.line_cents,
    })),
    subtotalCents: i.subtotal_cents,
    itemDiscountCents: i.item_discount_cents || 0,
    invoiceDiscountCents: i.invoice_discount_cents || 0,
    totalCents: i.total_cents,
    paidCents: i.paid_cents,
    outstandingCents: Math.max(0, i.total_cents - i.paid_cents),
    paymentMethod: titleCase(i.payment_method || ""),
    paymentTerms: titleCase(i.payment_terms || ""),
    dueDate: i.due_at ? formatDate(i.due_at) : "",
    notes: (i.notes || "").trim(),
    terms: (i.terms || "").trim(),
    showShopPrice: opts.showShopPrice,
  };
}

export const hasSinhala = (s: string) => /[඀-෿]/.test(s || "");

export function pdfFileName(model: InvoiceModel, kind: "A4" | "receipt" = "A4") {
  const safe = model.number.replace(/[^A-Za-z0-9_-]+/g, "-");
  return `${safe}${kind === "receipt" ? "-receipt" : ""}.pdf`;
}

/* ---------------- Thermal printer settings ---------------- */

export type ThermalSettings = {
  paperWidthMm: number; // 58, 80 or custom
  printableWidthMm: number;
  fontSizePx: number;
  marginMm: number;
  showLogo: boolean;
  copies: number;
};

export const THERMAL_DEFAULTS: ThermalSettings = {
  paperWidthMm: 80,
  printableWidthMm: 72,
  fontSizePx: 12,
  marginMm: 2,
  showLogo: true,
  copies: 1,
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function sanitizeThermal(input: unknown): ThermalSettings {
  let raw: Record<string, unknown> = {};
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input) || {};
    } catch {
      raw = {};
    }
  } else if (input && typeof input === "object") raw = input as Record<string, unknown>;
  const paper = clamp(raw.paperWidthMm, 40, 120, THERMAL_DEFAULTS.paperWidthMm);
  const printable = clamp(
    raw.printableWidthMm,
    30,
    paper,
    paper === 58 ? 48 : paper === 80 ? 72 : Math.max(30, paper - 8),
  );
  return {
    paperWidthMm: paper,
    printableWidthMm: printable,
    fontSizePx: clamp(raw.fontSizePx, 8, 18, THERMAL_DEFAULTS.fontSizePx),
    marginMm: clamp(raw.marginMm, 0, 10, THERMAL_DEFAULTS.marginMm),
    showLogo: raw.showLogo === undefined ? true : Boolean(raw.showLogo),
    copies: Math.round(clamp(raw.copies, 1, 5, 1)),
  };
}
