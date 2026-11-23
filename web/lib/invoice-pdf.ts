import type { jsPDF as JsPDF } from "jspdf";
import {
  amount,
  hasSinhala,
  lkr,
  type InvoiceModel,
  type ThermalSettings,
} from "./invoice-model";

/**
 * Client-side PDF generation with jsPDF (pure JS — no native binaries,
 * works in the browser and in the Worker-compatible build).
 *
 * Latin text is drawn as vector text with the built-in Helvetica font.
 * jsPDF cannot shape complex scripts, so any Sinhala string is rendered by
 * the browser's own text engine to a high-resolution image and placed at the
 * same position and size. The result is a real, valid application/pdf file.
 */

const TEAL: [number, number, number] = [12, 80, 81];
const GREEN: [number, number, number] = [40, 126, 101];
const LIME: [number, number, number] = [146, 253, 111];
const INK: [number, number, number] = [20, 44, 42];
const MUTED: [number, number, number] = [100, 119, 115];
const MINT: [number, number, number] = [243, 250, 246];
const LINE: [number, number, number] = [221, 235, 229];
const PT_TO_MM = 0.3528;

type Align = "left" | "right" | "center";
type TextOpts = {
  size?: number;
  bold?: boolean;
  color?: [number, number, number];
  align?: Align;
};

const clean = (s: string) => (s || "").replace(/[  ]/g, " ");

function canvasFont(size: number, bold: boolean) {
  return `${bold ? "700" : "400"} ${size}px "Noto Sans Sinhala", "Iskoola Pota", "Nirmala UI", Arial, sans-serif`;
}

class Writer {
  constructor(public pdf: JsPDF) {}

  private apply(o: TextOpts) {
    this.pdf.setFont("helvetica", o.bold ? "bold" : "normal");
    this.pdf.setFontSize(o.size ?? 9);
    this.pdf.setTextColor(...(o.color ?? INK));
  }

  width(text: string, o: TextOpts = {}): number {
    text = clean(text);
    if (hasSinhala(text) && typeof document !== "undefined") {
      const ctx = document.createElement("canvas").getContext("2d");
      if (ctx) {
        const px = 100;
        ctx.font = canvasFont(px, !!o.bold);
        return (ctx.measureText(text).width / px) * (o.size ?? 9) * PT_TO_MM;
      }
    }
    this.apply(o);
    return this.pdf.getTextWidth(text);
  }

  /** Word-wrap to a width in mm (works for Latin and Sinhala). */
  wrap(text: string, maxMm: number, o: TextOpts = {}): string[] {
    text = clean(text);
    if (!text) return [];
    if (!hasSinhala(text)) {
      this.apply(o);
      return this.pdf.splitTextToSize(text, maxMm) as string[];
    }
    const out: string[] = [];
    for (const para of text.split(/\n/)) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && this.width(next, o) > maxMm) {
          out.push(line);
          line = word;
        } else line = next;
      }
      if (line) out.push(line);
    }
    return out;
  }

  text(text: string, x: number, y: number, o: TextOpts = {}) {
    text = clean(text);
    if (!text) return;
    if (hasSinhala(text) && typeof document !== "undefined") {
      this.raster(text, x, y, o);
      return;
    }
    this.apply(o);
    this.pdf.text(text, x, y, { align: o.align ?? "left", baseline: "alphabetic" });
  }

  private raster(text: string, x: number, y: number, o: TextOpts) {
    const size = o.size ?? 9;
    const scale = 8; // px per pt → crisp at print resolution
    const px = size * scale;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = canvasFont(px, !!o.bold);
    const w = Math.ceil(ctx.measureText(text).width) + 4;
    const h = Math.ceil(px * 1.6);
    canvas.width = w;
    canvas.height = h;
    ctx.font = canvasFont(px, !!o.bold);
    const [r, g, b] = o.color ?? INK;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.textBaseline = "alphabetic";
    const baseline = Math.round(px * 1.15);
    ctx.fillText(text, 2, baseline);
    const mmPerPx = (size * PT_TO_MM) / px;
    const wMm = w * mmPerPx;
    const hMm = h * mmPerPx;
    const left = o.align === "right" ? x - wMm : o.align === "center" ? x - wMm / 2 : x;
    this.pdf.addImage(canvas.toDataURL("image/png"), "PNG", left, y - baseline * mmPerPx, wMm, hMm);
  }
}

async function loadImage(src: string): Promise<{ data: string; w: number; h: number } | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        const size = 240;
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(null);
        // circular crop, matching the on-screen logo
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve({ data: c.toDataURL("image/png"), w: size, h: size });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function gradientBar(
  pdf: JsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  from = LIME,
  to = GREEN,
) {
  const steps = 48;
  const sw = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    pdf.setFillColor(
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    );
    pdf.rect(x + i * sw, y, sw + 0.15, h, "F");
  }
}

/* ======================================================================
   A4 INVOICE
   ====================================================================== */

export async function buildA4InvoicePdf(model: InvoiceModel, opts: { logoSrc?: string } = {}) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  pdf.setProperties({
    title: `Invoice ${model.number}`,
    subject: `Invoice for ${model.customer.shopName}`,
    author: model.business.name,
    creator: "Sanjeewa Distribution ERP",
  });
  const w = new Writer(pdf);
  const PW = 210,
    PH = 297,
    L = 14,
    R = PW - 14,
    CONTENT_BOTTOM = 262;
  const logo = opts.logoSrc ? await loadImage(opts.logoSrc) : null;

  /* ---- header ---- */
  let y = 16;
  pdf.setFillColor(...TEAL);
  pdf.rect(0, 0, PW, 5, "F");
  gradientBar(pdf, PW * 0.55, 0, PW * 0.45, 5, GREEN, LIME);

  let bx = L;
  if (logo) {
    pdf.addImage(logo.data, "PNG", L, y - 2, 20, 20);
    bx = L + 24;
  }
  const nameLines = w.wrap(model.business.name, 92, { size: 13, bold: true });
  let by = y + 4;
  for (const ln of nameLines) {
    w.text(ln, bx, by, { size: 13, bold: true, color: TEAL });
    by += 5.4;
  }
  const contact = [
    model.business.address,
    [model.business.phone && `Tel: ${model.business.phone}`, model.business.whatsapp && `WhatsApp: ${model.business.whatsapp}`]
      .filter(Boolean)
      .join("   "),
    model.business.email,
  ].filter(Boolean);
  for (const c of contact)
    for (const ln of w.wrap(c, 92, { size: 8.5 })) {
      w.text(ln, bx, by, { size: 8.5, color: MUTED });
      by += 4;
    }

  w.text(model.cancelled ? "CANCELLED" : "INVOICE", R, y + 8, {
    size: 28,
    bold: true,
    color: model.cancelled ? [196, 61, 69] : GREEN,
    align: "right",
  });
  const metaRows: [string, string][] = [
    ["Invoice No", model.number],
    ["Invoice Date", model.dateLabel + (model.timeLabel ? `, ${model.timeLabel}` : "")],
  ];
  if (model.dueDate) metaRows.push(["Due Date", model.dueDate]);
  let my = y + 16;
  for (const [k, v] of metaRows) {
    w.text(k, R - 52, my, { size: 8.5, color: MUTED });
    w.text(v, R, my, { size: 8.5, bold: true, align: "right" });
    my += 4.6;
  }
  y = Math.max(by, my, y + 24) + 6;

  /* ---- bill to ---- */
  pdf.setDrawColor(...LINE);
  pdf.setLineWidth(0.3);
  pdf.line(L, y, R, y);
  y += 7;
  w.text("INVOICE TO", L, y, { size: 8, bold: true, color: GREEN });
  w.text("PAYMENT", 120, y, { size: 8, bold: true, color: GREEN });
  y += 5.5;
  let ly = y;
  for (const ln of w.wrap(model.customer.shopName, 95, { size: 12, bold: true })) {
    w.text(ln, L, ly, { size: 12, bold: true });
    ly += 5.2;
  }
  for (const c of [model.customer.address, model.customer.whatsapp && `WhatsApp: ${model.customer.whatsapp}`].filter(Boolean) as string[])
    for (const ln of w.wrap(c, 95, { size: 9 })) {
      w.text(ln, L, ly, { size: 9, color: MUTED });
      ly += 4.4;
    }
  let ry = y;
  const payRows: [string, string][] = [
    ["Method", model.paymentMethod || "—"],
    ["Terms", model.paymentTerms || "—"],
    ["Status", model.cancelled ? "Cancelled" : model.outstandingCents > 0 ? (model.paidCents > 0 ? "Partially paid" : "Unpaid") : "Paid"],
  ];
  for (const [k, v] of payRows) {
    w.text(k, 120, ry, { size: 9, color: MUTED });
    w.text(v, 142, ry, { size: 9, bold: true });
    ry += 4.6;
  }
  y = Math.max(ly, ry) + 6;

  /* ---- items table ---- */
  const cols = [
    { key: "no", label: "#", x: L + 2, w: 7, align: "left" as Align },
    { key: "desc", label: "Product Description", x: L + 9, w: 70, align: "left" as Align },
    { key: "type", label: "Type", x: L + 81, w: 18, align: "left" as Align },
    { key: "qty", label: "Qty", x: L + 113, w: 12, align: "right" as Align },
    { key: "unit", label: "Unit Price", x: L + 137, w: 24, align: "right" as Align },
    { key: "disc", label: "Discount", x: L + 157, w: 20, align: "right" as Align },
    { key: "total", label: "Total", x: R - 2, w: 26, align: "right" as Align },
  ];
  const headerH = 9;
  const drawHeader = () => {
    gradientBar(pdf, L, y, R - L, headerH, [116, 216, 72], TEAL);
    for (const c of cols)
      w.text(c.label, c.x, y + 6, { size: 8.5, bold: true, color: [255, 255, 255], align: c.align });
    y += headerH + 1.1;
  };
  const newPage = () => {
    pdf.addPage();
    pdf.setFillColor(...TEAL);
    pdf.rect(0, 0, PW, 5, "F");
    y = 16;
    w.text(`${model.number} (continued)`, L, y, { size: 9, bold: true, color: TEAL });
    y += 6;
    drawHeader();
  };
  drawHeader();
  model.lines.forEach((line, idx) => {
    const desc = w.wrap(`${line.description} — ${line.pack}`, cols[1].w, { size: 9, bold: true });
    const extra: string[] = [];
    if (model.showShopPrice && line.shopPriceCents) extra.push(`Shop price: ${lkr(line.shopPriceCents)}`);
    const rowH = Math.max(8, 3.5 + desc.length * 4.2 + extra.length * 3.8 + 1.5);
    if (y + rowH > CONTENT_BOTTOM) newPage();
    if (idx % 2 === 1) {
      pdf.setFillColor(...MINT);
      pdf.rect(L, y, R - L, rowH, "F");
    }
    let ty = y + 5.2;
    w.text(String(idx + 1), cols[0].x, ty, { size: 9, color: MUTED });
    for (const d of desc) {
      w.text(d, cols[1].x, ty, { size: 9, bold: true });
      ty += 4.2;
    }
    for (const e of extra) {
      w.text(e, cols[1].x, ty - 0.4, { size: 7.5, color: MUTED });
      ty += 3.8;
    }
    const rowY = y + 5.2;
    w.text(line.priceType || "—", cols[2].x, rowY, { size: 8.5, color: MUTED });
    w.text(String(line.quantity), cols[3].x, rowY, { size: 9, align: "right" });
    w.text(amount(line.unitCents), cols[4].x, rowY, { size: 9, align: "right" });
    w.text(line.discountCents ? `-${amount(line.discountCents)}` : "—", cols[5].x, rowY, { size: 9, align: "right", color: MUTED });
    w.text(amount(line.lineCents), cols[6].x, rowY, { size: 9, bold: true, align: "right" });
    y += rowH;
  });
  pdf.setDrawColor(...LINE);
  pdf.line(L, y, R, y);
  y += 6;

  /* ---- totals + notes ---- */
  const totals: [string, string, boolean?][] = [["Subtotal", lkr(model.subtotalCents)]];
  if (model.itemDiscountCents) totals.push(["Item discounts", `-${lkr(model.itemDiscountCents)}`]);
  if (model.invoiceDiscountCents) totals.push(["Invoice discount", `-${lkr(model.invoiceDiscountCents)}`]);
  const blockH = totals.length * 5.6 + 12 + 2 * 5.6 + 4;
  if (y + blockH > CONTENT_BOTTOM) newPage();
  const tx = 120;
  let ty = y;
  for (const [k, v] of totals) {
    w.text(k, tx, ty, { size: 9.5, color: MUTED });
    w.text(v, R - 2, ty, { size: 9.5, align: "right" });
    ty += 5.6;
  }
  ty -= 1;
  gradientBar(pdf, tx - 3, ty, R - tx + 3, 10, [116, 216, 72], GREEN);
  w.text("GRAND TOTAL", tx, ty + 6.7, { size: 10, bold: true, color: [255, 255, 255] });
  w.text(lkr(model.totalCents), R - 2, ty + 6.7, { size: 11, bold: true, color: [255, 255, 255], align: "right" });
  ty += 16;
  w.text("Amount paid", tx, ty, { size: 9.5, color: MUTED });
  w.text(lkr(model.paidCents), R - 2, ty, { size: 9.5, align: "right" });
  ty += 5.6;
  w.text("Outstanding balance", tx, ty, { size: 9.5, bold: true });
  w.text(lkr(model.outstandingCents), R - 2, ty, {
    size: 10,
    bold: true,
    align: "right",
    color: model.outstandingCents > 0 ? [182, 106, 18] : GREEN,
  });
  ty += 4;

  // left column beside totals: notes
  let ny = y;
  if (model.notes) {
    w.text("Notes", L, ny, { size: 9, bold: true, color: GREEN });
    ny += 4.8;
    for (const ln of w.wrap(model.notes, 96, { size: 8.5 })) {
      if (ny > CONTENT_BOTTOM) break;
      w.text(ln, L, ny, { size: 8.5, color: INK });
      ny += 4;
    }
  }
  y = Math.max(ty, ny) + 8;

  /* ---- terms ---- */
  if (model.terms) {
    const lines = w.wrap(model.terms, R - L, { size: 8 });
    if (y + 8 + Math.min(lines.length, 6) * 3.7 > CONTENT_BOTTOM - 26) {
      if (y + 8 + lines.length * 3.7 > CONTENT_BOTTOM) newPage();
    }
    w.text("Terms & Conditions", L, y, { size: 9, bold: true, color: GREEN });
    y += 4.8;
    for (const ln of lines) {
      if (y > CONTENT_BOTTOM) newPage();
      w.text(ln, L, y, { size: 8, color: MUTED });
      y += 3.7;
    }
    y += 4;
  }

  /* ---- signatures ---- */
  if (y + 24 > CONTENT_BOTTOM) newPage();
  const sy = Math.max(y + 16, Math.min(CONTENT_BOTTOM - 6, y + 16));
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.3);
  pdf.line(L, sy, L + 70, sy);
  pdf.line(R - 70, sy, R, sy);
  w.text("Issued By / Authorized Signature", L, sy + 4.5, { size: 8.5, color: MUTED });
  w.text("Received By / Customer Signature", R - 70, sy + 4.5, { size: 8.5, color: MUTED });

  /* ---- footer on every page ---- */
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    // decorative curved leaf sweep (bottom-left) matching reference design
    pdf.setFillColor(...LIME);
    pdf.moveTo(0, PH);
    pdf.lineTo(0, PH - 26);
    pdf.curveTo(35, PH - 24, 75, PH - 6, 95, PH);
    pdf.close();
    pdf.fill();

    pdf.setFillColor(...GREEN);
    pdf.moveTo(0, PH);
    pdf.lineTo(0, PH - 16);
    pdf.curveTo(30, PH - 15, 60, PH - 4, 75, PH);
    pdf.close();
    pdf.fill();
    pdf.setDrawColor(...LINE);
    pdf.line(L, PH - 18, R, PH - 18);
    w.text(`Thank you for your business · ${model.business.name}`, R, PH - 12.5, {
      size: 8,
      color: MUTED,
      align: "right",
    });
    w.text(`Page ${p} of ${pages}`, R, PH - 8, { size: 8, color: MUTED, align: "right" });
  }
  return pdf.output("blob") as Blob;
}

/* ======================================================================
   THERMAL RECEIPT (PDF fallback, same data)
   ====================================================================== */

export async function buildThermalPdf(model: InvoiceModel, s: ThermalSettings) {
  const { jsPDF } = await import("jspdf");
  const pw = s.paperWidthMm;
  const m = (pw - s.printableWidthMm) / 2 + s.marginMm;
  const L = m,
    R = pw - m,
    CW = R - L;
  const fs = Math.max(6, Math.min(11, s.fontSizePx * 0.62)); // px → pt approximation
  const lh = fs * PT_TO_MM * 1.45;
  // measure height first with a scratch doc
  const draw = (pdf: JsPDF, dry: boolean) => {
    const w = new Writer(pdf);
    let y = m + 4;
    const put = (t: string, o: TextOpts & { x?: number } = {}) => {
      if (!dry) w.text(t, o.x ?? (o.align === "center" ? pw / 2 : o.align === "right" ? R : L), y, { size: fs, color: [0, 0, 0], ...o });
    };
    const wrapPut = (t: string, o: TextOpts = {}) => {
      for (const ln of w.wrap(t, CW, { size: o.size ?? fs, bold: o.bold })) {
        put(ln, o);
        y += lh;
      }
    };
    const rule = () => {
      if (!dry) {
        pdf.setDrawColor(0);
        pdf.setLineDashPattern([0.6, 0.6], 0);
        pdf.line(L, y - lh * 0.4, R, y - lh * 0.4);
        pdf.setLineDashPattern([], 0);
      }
      y += lh * 0.6;
    };
    wrapPut(model.business.name, { bold: true, size: fs * 1.25, align: "center" });
    for (const c of [model.business.address, model.business.phone && `Tel: ${model.business.phone}`].filter(Boolean) as string[])
      wrapPut(c, { align: "center" });
    rule();
    wrapPut(model.cancelled ? "CANCELLED RECEIPT" : "SALES RECEIPT", { bold: true, align: "center" });
    wrapPut(`Invoice: ${model.number}`);
    wrapPut(`Date: ${model.dateLabel}${model.timeLabel ? " " + model.timeLabel : ""}`);
    wrapPut(`Customer: ${model.customer.shopName}`);
    rule();
    for (const line of model.lines) {
      wrapPut(`${line.description} ${line.pack}`, { bold: true });
      put(`${line.quantity} x ${amount(line.unitCents)}`);
      put(amount(line.lineCents), { align: "right" });
      y += lh;
      if (line.discountCents) {
        put("Discount");
        put(`-${amount(line.discountCents)}`, { align: "right" });
        y += lh;
      }
    }
    rule();
    const rows: [string, number, boolean?][] = [["Subtotal", model.subtotalCents]];
    if (model.itemDiscountCents) rows.push(["Item discounts", -model.itemDiscountCents]);
    if (model.invoiceDiscountCents) rows.push(["Invoice discount", -model.invoiceDiscountCents]);
    rows.push(["TOTAL", model.totalCents, true], ["Paid", model.paidCents], ["Balance", model.outstandingCents, true]);
    for (const [k, v, b] of rows) {
      put(k, { bold: b });
      put(lkr(v), { align: "right", bold: b });
      y += lh;
    }
    if (model.paymentMethod) wrapPut(`Payment: ${model.paymentMethod}`);
    y += lh * 2.2;
    if (!dry) {
      pdf.setDrawColor(0);
      pdf.line(L, y, L + CW * 0.42, y);
      pdf.line(R - CW * 0.42, y, R, y);
    }
    y += lh;
    put("Issued by", { x: L, size: fs * 0.85 });
    put("Received by", { x: R, align: "right", size: fs * 0.85 });
    y += lh * 1.6;
    wrapPut("Thank you!", { align: "center" });
    return y + m + 2;
  };
  const scratch = new jsPDF({ unit: "mm", format: [pw, 2000] });
  const height = Math.max(60, Math.ceil(draw(scratch, true)));
  const pdf = new jsPDF({ unit: "mm", format: [pw, height], orientation: "portrait" });
  draw(pdf, false);
  return pdf.output("blob") as Blob;
}

/* ======================================================================
   Delivery helpers
   ====================================================================== */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(file: File): boolean {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
