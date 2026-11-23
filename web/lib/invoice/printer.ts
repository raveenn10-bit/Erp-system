'use client';
import { api } from '@/lib/api';
import { isNative, NativePrint, ThermalPrinter, printPdf, shareFile, type PrinterDevice } from '@/lib/native';
import { buildReceiptPdf, buildReceiptPng, bytesToBase64, canvasToEscPos, renderReceiptCanvas, type ReceiptSpec } from './render';
import type { InvoiceModel } from './model';

/** Receipt layout — same fields the web ERP stores in /billing/settings (thermalPrinter). */
export type ThermalLayout = {
  paperWidthMm: number;      // 58, 80 or custom
  printableWidthMm: number;  // printed area (58 mm paper ≈ 48 mm, 80 mm ≈ 72 mm)
  fontSizePx: number;        // 8–18
  marginMm: number;          // 0–10, left/right inside the printable area
  showLogo: boolean;
  copies: number;            // 1–5
};
export type PrinterSettings = ThermalLayout & {
  /** rawbt = RawBT app; bluetooth = direct ESC/POS to a paired printer; system = Android print service. */
  mode: 'rawbt' | 'bluetooth' | 'system';
  device: PrinterDevice | null;
};
export const LAYOUT_DEFAULTS: ThermalLayout = { paperWidthMm: 58, printableWidthMm: 48, fontSizePx: 12, marginMm: 1, showLogo: false, copies: 1 };
export const DEFAULT_PRINTER: PrinterSettings = { ...LAYOUT_DEFAULTS, mode: 'rawbt', device: null };
const KEY = 'thermal-printer';

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function sanitizeLayout(raw: Partial<ThermalLayout> | null | undefined): ThermalLayout {
  const r = raw || {};
  const paper = clamp(r.paperWidthMm, 40, 120, LAYOUT_DEFAULTS.paperWidthMm);
  const autoPrintable = paper === 58 ? 48 : paper === 80 ? 72 : Math.max(30, paper - 8);
  return {
    paperWidthMm: paper,
    printableWidthMm: clamp(r.printableWidthMm, 30, paper, autoPrintable),
    fontSizePx: clamp(r.fontSizePx, 8, 18, LAYOUT_DEFAULTS.fontSizePx),
    marginMm: clamp(r.marginMm, 0, 10, LAYOUT_DEFAULTS.marginMm),
    showLogo: typeof r.showLogo === 'boolean' ? r.showLogo : LAYOUT_DEFAULTS.showLogo,
    copies: Math.round(clamp(r.copies, 1, 5, 1)),
  };
}
export const layoutOf = (s: PrinterSettings): ThermalLayout => sanitizeLayout(s);

/** Printer dots: 203 dpi thermal heads print 8 dots per mm (48 mm → 384 dots, 72 mm → 576). */
export function paperSpec(s: ThermalLayout): ReceiptSpec {
  const l = sanitizeLayout(s);
  const dots = Math.max(200, Math.min(832, Math.round(l.printableWidthMm) * 8));
  return { dots, mm: l.paperWidthMm, fontPx: Math.round(l.fontSizePx * 1.8), marginDots: Math.round(l.marginMm * 8), showLogo: l.showLogo };
}

/** Upgrade settings saved by older app versions ({ paper: '58' | '80' | 'custom', customMm, customDots }). */
function migrate(v: Record<string, unknown>): Partial<PrinterSettings> {
  if (v.paperWidthMm || !v.paper) return v as Partial<PrinterSettings>;
  if (v.paper === '80') return { ...v, paperWidthMm: 80, printableWidthMm: 72 } as Partial<PrinterSettings>;
  if (v.paper === 'custom') return { ...v, paperWidthMm: Number(v.customMm) || 58, printableWidthMm: Math.round((Number(v.customDots) || 384) / 8) } as Partial<PrinterSettings>;
  return { ...v, paperWidthMm: 58, printableWidthMm: 48 } as Partial<PrinterSettings>;
}

async function readLocal(): Promise<Partial<PrinterSettings> | null> {
  try {
    if (isNative()) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: KEY });
      return value ? migrate(JSON.parse(value)) : null;
    }
    const v = localStorage.getItem(KEY);
    return v ? migrate(JSON.parse(v)) : null;
  } catch { return null; }
}

/** This device's printer: its own saved settings, else the business default from the server, else 58 mm. */
export async function loadPrinter(): Promise<PrinterSettings> {
  const local = await readLocal();
  let server: Partial<ThermalLayout> | null = null;
  if (!local?.paperWidthMm) {
    try { server = (await api<{ thermal: Partial<ThermalLayout> | null }>('/billing/print-settings')).thermal; } catch { /* offline / no permission */ }
  }
  const base = { ...DEFAULT_PRINTER, ...(server || {}), ...(local || {}) } as PrinterSettings;
  return { ...base, ...sanitizeLayout(base), mode: base.mode || 'rawbt', device: base.device || null };
}
export async function savePrinter(s: PrinterSettings) {
  const value = JSON.stringify(s);
  if (isNative()) { const { Preferences } = await import('@capacitor/preferences'); await Preferences.set({ key: KEY, value }); }
  else { try { localStorage.setItem(KEY, value); } catch { /* storage unavailable */ } }
}
/** Admin: make this layout the default for every phone and the web ERP. */
export async function saveLayoutForAll(s: PrinterSettings) {
  await api('/billing/settings', { method: 'PATCH', body: JSON.stringify({ thermalPrinter: sanitizeLayout(s) }) });
}

export async function listPairedPrinters(): Promise<PrinterDevice[]> {
  if (!isNative()) throw new Error('Bluetooth printing is available in the Android app only.');
  return (await ThermalPrinter.listPaired()).devices;
}

function escPosCopies(canvas: HTMLCanvasElement, dots: number, copies: number): string {
  const one = canvasToEscPos(canvas, dots);
  const all = new Uint8Array(one.length * copies);
  for (let i = 0; i < copies; i++) all.set(one, i * one.length);
  return bytesToBase64(all);
}

export async function printReceipt(m: InvoiceModel, s: PrinterSettings): Promise<string> {
  const spec = paperSpec(s);
  const copies = layoutOf(s).copies;
  if (s.mode === 'rawbt' && isNative()) {
    // Portrait raster at the exact printer width, then feed + cut: nothing for RawBT to scale or rotate.
    const canvas = await renderReceiptCanvas(m, spec);
    try {
      await NativePrint.printRawBt({ data: escPosCopies(canvas, spec.dots, copies) });
      return copies > 1 ? `Sent ${copies} copies to RawBT` : 'Sent to RawBT printer';
    } catch (e) {
      if ((e as { code?: string }).code === 'NO_RAWBT') throw new Error('RawBT app is not installed. Install RawBT from Play Store, or choose "Bluetooth (direct)" in printer settings.');
      throw e;
    }
  }
  if (s.mode === 'bluetooth' && isNative()) {
    if (!s.device) throw new Error('Choose a paired printer in Printer settings first.');
    const canvas = await renderReceiptCanvas(m, spec);
    await ThermalPrinter.print({ address: s.device.address, data: escPosCopies(canvas, spec.dots, copies) });
    return `Sent to ${s.device.name}`;
  }
  await printPdf(await buildReceiptPdf(m, spec), `${m.number}_Receipt.pdf`, false);
  return 'Opened print dialog';
}

/** Clearly labelled sample used only for "Test print" and the preview — never stored or sent anywhere. */
export function testReceiptModel(businessName = 'PRINTER TEST'): InvoiceModel {
  return {
    number: 'TEST-PRINT', date: new Date().toISOString(), dueDate: null, status: 'test',
    business: { name: businessName, address: 'Test print — not an invoice', phone: '', whatsapp: '', email: '' },
    customer: { name: 'PRINTER TEST', address: '', whatsapp: '' },
    paymentMethod: 'Cash', paymentTerms: '', notes: '', terms: '',
    lines: [
      { no: 1, product: 'Sample tea', pack: '100g', qty: 2, unit: 18000, shopPrice: null, discount: 0, total: 36000 },
      { no: 2, product: 'සිංහල අකුරු පරීක්ෂාව', pack: '50g', qty: 1, unit: 9000, shopPrice: null, discount: 0, total: 9000 },
    ],
    showShopPrice: false, showCustomerWhatsapp: false,
    subtotal: 45000, itemDiscount: 0, invoiceDiscount: 0, total: 45000, paid: 45000, outstanding: 0,
  };
}

/** Sends the receipt to RawBT, or shares the receipt image with another printer app. */
export async function shareReceiptToPrinterApp(m: InvoiceModel, s: PrinterSettings): Promise<string> {
  if (isNative()) { try { return await printReceipt(m, { ...s, mode: 'rawbt' }); } catch { /* no RawBT: share the image instead */ } }
  const how = await shareFile(await buildReceiptPng(m, paperSpec(s)), `${m.number.replace(/[^A-Za-z0-9-]+/g, '_')}_Receipt.png`, { title: `Receipt ${m.number}` });
  return how === 'downloaded' ? 'Receipt image downloaded' : 'Choose your printer app (e.g. RawBT)';
}
