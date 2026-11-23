"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bluetooth, Download, MessageCircle, Printer, ReceiptText, RefreshCw, Settings2, Share2, X } from "lucide-react";
import { api, formatWhatsApp, normalizeWhatsApp } from "@/lib/api";
import { isNative, openExternal, printPdf, saveFile, shareFile, shareToWhatsApp, type PrinterDevice } from "@/lib/native";
import { pdfFileName, toInvoiceModel, whatsappMessage, type InvoiceDetail } from "@/lib/invoice/model";
import { InvoiceA4, A4_PX } from "@/components/invoice-document";
import { DEFAULT_PRINTER, listPairedPrinters, loadPrinter, paperSpec, printReceipt, savePrinter, shareReceiptToPrinterApp, testReceiptModel, type PrinterSettings } from "@/lib/invoice/printer";

/** Scales the fixed-size A4 pages down to the available width (no overflow on phones). */
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1), [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const fit = () => {
      if (!outer.current || !inner.current) return;
      const s = Math.min(1, outer.current.clientWidth / A4_PX.width);
      setScale(s); setHeight(inner.current.scrollHeight * s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div className="ninv-preview" ref={outer} style={{ height }}>
      <div ref={inner} style={{ width: A4_PX.width, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}

export function InvoiceActions({ id, close }: { id: string; close: () => void }) {
  const detail = useQuery({ queryKey: ["invoice", id], queryFn: () => api<InvoiceDetail>(`/invoices/${id}`) });
  const settings = useQuery({ queryKey: ["billing-settings"], queryFn: () => api<Record<string, string>>("/billing/settings") });
  const data = detail.data;
  const model = useMemo(() => (data ? toInvoiceModel(data, settings.data) : null), [data, settings.data]);

  const [waInput, setWaInput] = useState("");
  const [isUpdatingWa, setIsUpdatingWa] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [printer, setPrinter] = useState<PrinterSettings>(DEFAULT_PRINTER);
  const [showPrinter, setShowPrinter] = useState(false);
  const [devices, setDevices] = useState<PrinterDevice[] | null>(null);
  const pdfCache = useRef<{ key: string; blob: Blob } | null>(null);

  useEffect(() => { loadPrinter().then(setPrinter); }, []);
  useEffect(() => {
    if (data?.invoice) setWaInput(data.invoice.customer_whatsapp || data.invoice.whatsapp || "");
  }, [data?.invoice]);

  const note = (text: string, ok = true) => setMsg({ text, ok });
  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label); setMsg(null);
    try { const r = await fn(); if (r) note(r); }
    catch (e) { const t = (e as Error).message || "Something went wrong"; if (!/cancel/i.test(t)) note(t, false); }
    finally { setBusy(null); }
  }
  async function pdf(): Promise<Blob> {
    if (!model) throw new Error("Invoice not loaded");
    const key = JSON.stringify(model);
    if (pdfCache.current?.key === key) return pdfCache.current.blob;
    const { buildA4Pdf } = await import("@/lib/invoice/render");
    const blob = await buildA4Pdf(model);
    pdfCache.current = { key, blob };
    return blob;
  }
  // The public /view/invoice page on the production Worker renders unstyled
  // (its CSP blocks the page styles), so messages carry the PDF, not the link.

  async function updateWhatsappNumber() {
    if (!data) return;
    if (!normalizeWhatsApp(waInput)) { note("Please enter a valid WhatsApp number.", false); return; }
    setIsUpdatingWa(true); setMsg(null);
    try {
      await api<{ ok: boolean; whatsapp: string }>(`/invoices/${data.invoice.id}/whatsapp`, { method: "PATCH", body: JSON.stringify({ whatsapp: waInput }) });
      note("WhatsApp recipient updated.");
      await detail.refetch();
    } catch (err) { note((err as Error).message, false); }
    finally { setIsUpdatingWa(false); }
  }

  // Send the real PDF straight into WhatsApp / WhatsApp Business. Where WhatsApp
  // honours it the customer's chat opens directly; the user still taps Send.
  const sendPdf = () => run("share", async () => {
    if (!model) return;
    const phone = normalizeWhatsApp(waInput || model.customer.whatsapp);
    const text = whatsappMessage(model);
    const how = await shareToWhatsApp(await pdf(), pdfFileName(model, "A4"), phone, text);
    if (how === "downloaded") return "PDF downloaded — attach it in WhatsApp.";
    if (how === "whatsapp") return phone ? `WhatsApp opened with the PDF. Check it's ${model.customer.name} (${formatWhatsApp(phone)}), then tap Send.` : "WhatsApp opened with the PDF — pick the customer and tap Send.";
    return "Choose WhatsApp, then the customer.";
  });
  // Text-only message straight into the customer's chat (recipient pre-filled, no attachment).
  function openChat() {
    if (!model) return;
    const phone = normalizeWhatsApp(waInput || model.customer.whatsapp);
    if (!phone) { note("Please enter a valid WhatsApp number first.", false); return; }
    openExternal(`https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage(model).replace("is attached", "is ready"))}`);
  }

  async function choosePrinterList() {
    await run("devices", async () => { setDevices(await listPairedPrinters()); });
  }
  async function updatePrinter(next: PrinterSettings) { setPrinter(next); await savePrinter(next); }

  const native = isNative();
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div className="dialog-card document-sheet invoice-sheet" role="dialog" aria-modal="true" aria-label="Invoice" onMouseDown={(e) => e.stopPropagation()}>
        <button className="secondary document-close" onClick={close}><X size={16} />Close</button>
        {detail.isLoading ? (
          <div className="ninv-skeleton" aria-busy="true"><div /><div /><div /><div /></div>
        ) : detail.isError ? (
          <div className="error">Could not load invoice. <button className="secondary" onClick={() => detail.refetch()}><RefreshCw size={14} />Retry</button></div>
        ) : model && (
          <>
            <div className="ninv-actions" role="toolbar" aria-label="Invoice actions">
              <button className="primary wa" disabled={!!busy} onClick={sendPdf}><MessageCircle size={16} />{busy === "share" ? "Preparing PDF…" : "Send PDF on WhatsApp · WhatsApp යවන්න"}</button>
              <button className="secondary" disabled={!!busy} onClick={() => run("save", async () => saveFile(await pdf(), pdfFileName(model, "A4")))}><Download size={16} />{busy === "save" ? "Saving…" : "Download PDF"}</button>
              <button className="secondary" disabled={!!busy} onClick={() => run("print", async () => { await printPdf(await pdf(), pdfFileName(model, "A4"), true); })}><Printer size={16} />{busy === "print" ? "Preparing…" : "Print A4"}</button>
              <button className="secondary" disabled={!!busy} onClick={() => run("receipt", () => printReceipt(model, printer))}><ReceiptText size={16} />{busy === "receipt" ? "Printing…" : `Print receipt ${paperSpec(printer).mm}mm`}</button>
              <button className="secondary" disabled={!!busy} onClick={() => run("rawbt", () => shareReceiptToPrinterApp(model, printer))}><Printer size={16} />{busy === "rawbt" ? "Preparing…" : "Receipt image → other app"}</button>
              <button className="secondary" disabled={!!busy} onClick={() => run("other", async () => { await shareFile(await pdf(), pdfFileName(model, "A4"), { title: `Invoice ${model.number}` }); })}><Share2 size={16} />Share…</button>
              <button className="secondary icon-only" aria-label="Printer settings" aria-expanded={showPrinter} onClick={() => setShowPrinter(v => !v)}><Settings2 size={16} /></button>
            </div>
            {msg && <p className={`inv-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}

            {showPrinter && (
              <section className="printer-panel" aria-label="Thermal printer settings">
                <h3><Bluetooth size={16} /> Receipt printer</h3>
                <div className="seg-row">
                  {(["rawbt", "bluetooth", "system"] as const).map(mode => (
                    <button key={mode} className={printer.mode === mode ? "primary" : "secondary"} onClick={() => updatePrinter({ ...printer, mode })} disabled={mode !== "system" && !native}>
                      {mode === "rawbt" ? "RawBT app (recommended)" : mode === "bluetooth" ? "Bluetooth (direct)" : "Android print service"}
                    </button>
                  ))}
                </div>
                <div className="seg-row">
                  {(["58", "80", "custom"] as const).map(paper => (
                    <button key={paper} className={printer.paper === paper ? "primary" : "secondary"} onClick={() => updatePrinter({ ...printer, paper })}>{paper === "custom" ? "Custom" : `${paper} mm`}</button>
                  ))}
                </div>
                {printer.paper === "custom" && (
                  <div className="seg-row">
                    <label>Paper width (mm)<input type="number" inputMode="numeric" min={40} max={112} value={printer.customMm} onChange={e => updatePrinter({ ...printer, customMm: Number(e.target.value) })} /></label>
                    <label>Printable dots<input type="number" inputMode="numeric" min={200} max={832} step={8} value={printer.customDots} onChange={e => updatePrinter({ ...printer, customDots: Number(e.target.value) })} /></label>
                  </div>
                )}
                {printer.mode === "bluetooth" && (
                  <>
                    <p className="muted">Pair the printer first in Android Settings → Bluetooth. Status: <b>{printer.device ? `Selected: ${printer.device.name}` : "No printer selected"}</b></p>
                    <div className="seg-row">
                      <button className="secondary" disabled={!!busy} onClick={choosePrinterList}><RefreshCw size={14} />{busy === "devices" ? "Loading…" : "Find paired printers"}</button>
                    </div>
                    {devices && (devices.length ? (
                      <ul className="device-list">
                        {devices.map(d => (
                          <li key={d.address}><button className={printer.device?.address === d.address ? "primary" : "secondary"} onClick={() => updatePrinter({ ...printer, device: d })}>{d.name}<small>{d.address}</small></button></li>
                        ))}
                      </ul>
                    ) : <p className="muted">No paired devices found.</p>)}
                  </>
                )}
                <button className="secondary" disabled={!!busy} onClick={() => run("test", () => printReceipt(testReceiptModel(), printer))}><Printer size={14} />{busy === "test" ? "Printing…" : "Test print"}</button>
              </section>
            )}

            <div className="ninv-wa">
              <MessageCircle size={18} />
              <label>WhatsApp recipient
                <input type="tel" inputMode="tel" value={waInput} onChange={(e) => setWaInput(e.target.value)} placeholder="e.g. 077 123 4567" />
              </label>
              <button className="secondary" type="button" disabled={isUpdatingWa} onClick={updateWhatsappNumber}>{isUpdatingWa ? "Saving…" : "Update number"}</button>
              <button className="secondary" type="button" onClick={openChat}>Text only</button>
            </div>

            <ScaledPreview><InvoiceA4 m={model} /></ScaledPreview>
          </>
        )}
      </div>
    </div>
  );
}
