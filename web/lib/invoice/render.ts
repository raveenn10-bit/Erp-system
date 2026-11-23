'use client';
// Turns the invoice markup into real output files:
//  • A4 PDF: one jsPDF page per `.ninv-page`, rendered with the WebView's own
//    text engine so Sinhala/Tamil script is shaped correctly.
//  • Receipt PDF and ESC/POS raster bytes for Bluetooth thermal printers.
import { createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { InvoiceA4, InvoiceReceipt, A4_PX } from '@/components/invoice-document';
import type { InvoiceModel } from './model';

async function renderOffscreen<T>(el: ReactElement, width: number, work: (host: HTMLElement) => Promise<T>): Promise<T> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;background:#fff;z-index:-1;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(el));
    await document.fonts?.ready;
    await Promise.all(Array.from(host.querySelectorAll('img')).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    return await work(host);
  } finally {
    root.unmount();
    host.remove();
  }
}

async function snap(el: HTMLElement, scale: number) {
  const html2canvas = (await import('html2canvas')).default;
  return html2canvas(el, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: el.scrollWidth });
}

/** A4 invoice as a genuine PDF Blob (application/pdf), multi-page. */
export async function buildA4Pdf(m: InvoiceModel): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  return renderOffscreen(createElement(InvoiceA4, { m }), A4_PX.width, async host => {
    const pages = Array.from(host.querySelectorAll<HTMLElement>('.ninv-page'));
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pdf.setProperties({ title: `Invoice ${m.number}`, subject: m.customer.name, creator: 'Sanjeewa Distribution ERP', author: m.business.name });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await snap(pages[i], 2.2); // ≈200 dpi: sharp text, modest size
      if (i > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }
    return pdf.output('blob');
  });
}

/** Thermal receipt rendered to a 1-bit friendly canvas at printer dot width. */
export async function renderReceiptCanvas(m: InvoiceModel, dots: number): Promise<HTMLCanvasElement> {
  return renderOffscreen(createElement(InvoiceReceipt, { m, dots }), dots, async host => snap(host.firstElementChild as HTMLElement, 1));
}

/** Receipt as a black-and-white PNG (for printer apps such as RawBT that print images). */
export async function buildReceiptPng(m: InvoiceModel, dots: number): Promise<Blob> {
  const canvas = await renderReceiptCanvas(m, dots);
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not create receipt image'))), 'image/png'));
}

/** Receipt as PDF (for OS printing / sharing), width = paper width in mm. */
export async function buildReceiptPdf(m: InvoiceModel, dots: number, paperMm: number): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const canvas = await renderReceiptCanvas(m, dots);
  const h = (canvas.height / canvas.width) * paperMm;
  const pdf = new jsPDF({ unit: 'mm', format: [paperMm, Math.max(h, 40)], orientation: 'portrait' });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, paperMm, h);
  return pdf.output('blob');
}

/**
 * ESC/POS byte stream: initialise, raster image (GS v 0) in bands, feed, cut.
 * Raster printing is supported by virtually all ESC/POS printers and prints
 * Sinhala correctly because the text is already drawn as an image.
 */
export function canvasToEscPos(canvas: HTMLCanvasElement, dots: number): Uint8Array {
  const width = Math.min(canvas.width, dots);
  const bytesPerRow = Math.ceil(width / 8);
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, width, canvas.height);
  const out: number[] = [0x1b, 0x40]; // ESC @ initialise
  const BAND = 128;
  for (let y0 = 0; y0 < canvas.height; y0 += BAND) {
    const rows = Math.min(BAND, canvas.height - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    for (let y = y0; y < y0 + rows; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x >= width) continue;
          const p = (y * width + x) * 4;
          const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
          if (lum < 150 && data[p + 3] > 64) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }
  out.push(0x1b, 0x64, 0x04); // feed 4 lines
  out.push(0x1d, 0x56, 0x42, 0x00); // partial cut (ignored by printers without a cutter)
  return Uint8Array.from(out);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Generic: snapshot any on-screen document element into an A4 PDF (fits width, splits height). */
export async function elementToA4Pdf(el: HTMLElement, title: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const canvas = await snap(el, 2);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setProperties({ title, creator: 'Sanjeewa Distribution ERP' });
  const margin = 10, w = 210 - margin * 2, pageH = 297 - margin * 2;
  const pxPerMm = canvas.width / w, sliceH = Math.floor(pageH * pxPerMm);
  for (let y = 0, i = 0; y < canvas.height; y += sliceH, i++) {
    const part = document.createElement('canvas');
    part.width = canvas.width; part.height = Math.min(sliceH, canvas.height - y);
    part.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
    if (i > 0) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, w, part.height / pxPerMm);
  }
  return pdf.output('blob');
}
