'use client';
// Android (Capacitor) integration layer. Every function is safe to call in a
// normal browser: it falls back to standard web behaviour there.
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = () => typeof window !== 'undefined' && Capacitor.isNativePlatform();

/** Public origin of the ERP Worker (used for API calls and shareable invoice links). */
export function publicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (configured) return configured;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

// ---------- Local Android plugins (see android/app/src/main/java/...) ----------
type PrinterDevice = { name: string; address: string };
interface NativePrintPlugin {
  printPdf(o: { path: string; jobName: string; a4?: boolean }): Promise<{ started: boolean }>;
  shareToWhatsApp(o: { path: string; phone?: string; text?: string; mime?: string }): Promise<{ apps: number }>;
  printRawBt(o: { data: string }): Promise<void>;
}
interface ThermalPrinterPlugin {
  listPaired(): Promise<{ devices: PrinterDevice[] }>;
  print(o: { address: string; data: string }): Promise<{ bytes: number }>;
}
export const NativePrint = registerPlugin<NativePrintPlugin>('NativePrint');
export const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>('ThermalPrinter');
export type { PrinterDevice };

// ---------- Files ----------
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(binary);
}
export const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

/** Writes a file into the app's private cache and returns its native URI. */
export async function writeCacheFile(blob: Blob, fileName: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const path = `invoices/${safeFileName(fileName)}`;
  const res = await Filesystem.writeFile({ path, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true });
  return res.uri;
}

/** Opens the Android share sheet for a file (WhatsApp, Gmail, Drive, Files, …). */
export async function shareFile(blob: Blob, fileName: string, opts: { title?: string; text?: string } = {}) {
  if (isNative()) {
    const uri = await writeCacheFile(blob, fileName);
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: opts.title, text: opts.text, files: [uri], dialogTitle: opts.title || 'Share invoice' });
    return 'shared' as const;
  }
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: opts.title, text: opts.text });
    return 'shared' as const;
  }
  downloadInBrowser(blob, fileName);
  return 'downloaded' as const;
}

function downloadInBrowser(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Android: opens WhatsApp / WhatsApp Business with the file attached and the
 * customer's chat pre-selected where WhatsApp allows it. Falls back to the
 * normal share sheet. Returns how it was handled.
 */
export async function shareToWhatsApp(blob: Blob, fileName: string, phone: string, text: string): Promise<'whatsapp' | 'shared' | 'downloaded'> {
  if (isNative()) {
    try {
      const uri = await writeCacheFile(blob, fileName);
      await NativePrint.shareToWhatsApp({ path: uri, phone, text, mime: blob.type || 'application/pdf' });
      return 'whatsapp';
    } catch { /* WhatsApp missing or refused: use share sheet */ }
  }
  return shareFile(blob, fileName, { title: fileName, text });
}

/**
 * Saves a file where the user can find it. On Android it goes to
 * Documents/SanjeewaERP; if the device refuses, the share sheet opens so the
 * user can pick "Save to Files" / Drive instead.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<string> {
  if (!isNative()) { downloadInBrowser(blob, fileName); return 'Downloaded'; }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    await Filesystem.writeFile({ path: `SanjeewaERP/${safeFileName(fileName)}`, data: await blobToBase64(blob), directory: Directory.Documents, recursive: true });
    return `Saved to Documents/SanjeewaERP/${safeFileName(fileName)}`;
  } catch {
    await shareFile(blob, fileName, { title: fileName });
    return 'Choose where to save the file';
  }
}

/** Prints a PDF with Android's print service; in a browser opens it for printing. */
export async function printPdf(blob: Blob, fileName: string, a4 = true) {
  if (isNative()) {
    const uri = await writeCacheFile(blob, fileName);
    await NativePrint.printPdf({ path: uri, jobName: fileName.replace(/\.pdf$/i, ''), a4 });
    return;
  }
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) downloadInBrowser(blob, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Replacement for jsPDF's pdf.save(), which does nothing inside Android WebView. */
export async function savePdfDoc(pdf: { output(type: 'blob'): Blob; save(name: string): unknown }, fileName: string) {
  if (!isNative()) { pdf.save(fileName); return; }
  toast(await saveFile(pdf.output('blob'), fileName));
}

/**
 * Print button for on-screen documents (Free Issue, Consignment, …).
 * Browser: window.print(). Android: snapshot the sheet into an A4 PDF and
 * open the Android print dialog (WebView has no window.print()).
 */
export async function printDocumentSheet(from: HTMLElement, title: string) {
  if (!isNative()) { window.print(); return; }
  const sheet = (from.closest('.document-sheet') || from.closest('[role="dialog"]')) as HTMLElement | null;
  if (!sheet) { toast('Nothing to print'); return; }
  try {
    const { elementToA4Pdf } = await import('./invoice/render');
    sheet.classList.add('capturing');
    const blob = await elementToA4Pdf(sheet, title);
    await printPdf(blob, `${safeFileName(title)}.pdf`, true);
  } catch (e) {
    toast((e as Error).message || 'Printing failed');
  } finally { sheet.classList.remove('capturing'); }
}

/** Opens a URL outside the app (WhatsApp, browser). Capacitor hands external URLs to Android. */
export function openExternal(url: string) {
  if (isNative()) { window.location.assign(url); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Small transient message at the bottom of the screen (used by native flows). */
export function toast(message: string) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'native-toast'; el.setAttribute('role', 'status'); el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// ---------- App shell integration ----------
let started = false;
export async function initNativeShell(onBack: () => boolean) {
  if (!isNative() || started) return;
  started = true;
  document.documentElement.classList.add('native-app');
  const [{ App }, { StatusBar, Style }, { SplashScreen }, { Keyboard }] = await Promise.all([
    import('@capacitor/app'), import('@capacitor/status-bar'), import('@capacitor/splash-screen'), import('@capacitor/keyboard'),
  ]);
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#0C5051' }).catch(() => {});
  Keyboard.addListener('keyboardDidShow', () => {
    const el = document.activeElement as HTMLElement | null;
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  });
  // External links (wa.me, maps, web) must leave the app instead of replacing it.
  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url ? String(url) : '';
    if (/^(https?:|mailto:|tel:|whatsapp:)/i.test(href) && !href.startsWith(window.location.origin)) {
      window.location.assign(href);
      return null;
    }
    return nativeOpen(url, target, features);
  }) as typeof window.open;

  // Android WebView ignores <a download> for blob:/data: URLs (CSV exports,
  // statements, PDFs). Route those downloads to real file saving instead.
  const webFetch: typeof fetch = (window as unknown as { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch ?? fetch;
  const handleDownload = (a: HTMLAnchorElement) => {
    const href = a.href || '';
    if (!a.hasAttribute('download') || !/^(blob:|data:)/.test(href)) return false;
    const name = a.getAttribute('download') || 'download';
    webFetch(href).then(r => r.blob()).then(b => saveFile(b, name)).then(msg => toast(msg)).catch(() => toast('Could not save the file'));
    return true;
  };
  // Any jsPDF doc.save() anywhere in the app → real file on Android.
  import('jspdf').then(({ jsPDF }) => {
    (jsPDF as unknown as { API: { save: (this: { output(t: 'blob'): Blob }, name?: string) => unknown } }).API.save = function (name = 'document.pdf') {
      saveFile(this.output('blob'), name).then(toast).catch(() => toast('Could not save the PDF'));
      return this;
    };
  }).catch(() => {});
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { if (!handleDownload(this)) anchorClick.call(this); };
  document.addEventListener('click', e => {
    const a = (e.target as Element | null)?.closest?.('a[download]') as HTMLAnchorElement | null;
    if (a && handleDownload(a)) e.preventDefault();
  }, true);

  App.addListener('backButton',({ canGoBack }) => {
    if (onBack()) return;                 // a dialog/drawer was closed
    if (canGoBack && window.location.pathname !== '/dashboard' && window.location.pathname !== '/') { window.history.back(); return; }
    App.minimizeApp();                    // never kill the app (keeps session warm)
  });
  setTimeout(() => SplashScreen.hide().catch(() => {}), 150);
}
