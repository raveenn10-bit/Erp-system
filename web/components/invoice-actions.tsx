"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Share2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  buildInvoiceModel,
  displayPhone,
  pdfFileName,
  sanitizeThermal,
  validatePhone,
  lkr,
  type InvoiceDetail,
  type InvoiceModel,
  type ThermalSettings,
} from "@/lib/invoice-model";
import { buildA4InvoicePdf, buildThermalPdf, canShareFiles, downloadBlob } from "@/lib/invoice-pdf";
import { InvoiceDocument, ThermalReceipt } from "./invoice-document";

export type PrintSettings = {
  showShopPrice: boolean;
  showCustomerWhatsapp: boolean;
  thermal: ThermalSettings;
};

export function usePrintSettings() {
  return useQuery({
    queryKey: ["print-settings"],
    queryFn: async (): Promise<PrintSettings> => {
      const r = await api<{ showShopPrice: boolean; showCustomerWhatsapp: boolean; thermal: unknown }>(
        "/billing/print-settings",
      );
      return { ...r, thermal: sanitizeThermal(r.thermal) };
    },
    staleTime: 60_000,
  });
}

type PrintMode = null | "a4" | "thermal";

/**
 * Print through the browser with a dedicated print root portalled to <body>.
 * Everything else is hidden for the duration of the print, and the @page size
 * is set for the chosen paper (A4 or the configured roll width).
 */
let printToken = 0;
const PX_TO_MM = 25.4 / 96;
/** Roll printers have no fixed page height: size the page to the receipt itself. */
function measureReceiptMm(): number {
  const root = document.querySelector<HTMLElement>(".print-root-thermal");
  const first = root?.querySelector<HTMLElement>(".receipt");
  if (!root || !first) return 200;
  root.classList.add("measuring");
  const h = first.getBoundingClientRect().height;
  root.classList.remove("measuring");
  return Math.ceil(h * PX_TO_MM) + 4;
}
function thermalPageCss(t?: ThermalSettings, heightMm = 200) {
  const w = t?.paperWidthMm ?? 80;
  const m = t?.marginMm ?? 2;
  return `@page { size: ${w}mm ${heightMm + m * 2}mm; margin: ${m}mm; }`;
}
export function runPrint(mode: "a4" | "thermal", thermal?: ThermalSettings) {
  const token = ++printToken;
  const style = document.createElement("style");
  style.id = "invoice-page-size";
  style.textContent =
    mode === "a4"
      ? "@page { size: A4 portrait; margin: 12mm 12mm 14mm; }"
      : thermalPageCss(thermal);
  document.getElementById("invoice-page-size")?.remove();
  document.head.appendChild(style);
  document.body.classList.remove("print-a4", "print-thermal");
  document.body.classList.add("print-invoice", `print-${mode}`);
  const cleanup = () => {
    if (token !== printToken) return; // a newer print job owns the page now
    document.body.classList.remove("print-invoice", "print-a4", "print-thermal");
    style.remove();
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  // let React paint the print root, then wait for images (logo) to decode
  requestAnimationFrame(async () => {
    if (mode === "thermal") style.textContent = thermalPageCss(thermal, measureReceiptMm());
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".print-root img"));
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => undefined))));
    window.print();
    // Safari on iOS may not fire afterprint
    setTimeout(cleanup, 1500);
  });
}

export function PrintRoot({
  mode,
  model,
  thermal,
}: {
  mode: PrintMode;
  model: InvoiceModel | null;
  thermal: ThermalSettings;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  if (!host || !mode || !model) return null;
  return createPortal(
    <div className={`print-root print-root-${mode}`} aria-hidden="true">
      {mode === "a4" ? (
        <InvoiceDocument model={model} />
      ) : (
        Array.from({ length: thermal.copies }, (_, n) => (
          <div className="receipt-copy" key={n}>
            <ThermalReceipt model={model} settings={thermal} />
          </div>
        ))
      )}
    </div>,
    host,
  );
}

const A4_PX = 794; // 210mm at 96dpi

export function InvoiceActions({ id, close }: { id: string; close: () => void }) {
  const detail = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api<InvoiceDetail>(`/invoices/${id}`),
  });
  const printSettings = usePrintSettings();
  const ps = printSettings.data;
  const thermal = ps?.thermal ?? sanitizeThermal({});
  const model = useMemo(
    () =>
      detail.data
        ? buildInvoiceModel(detail.data, {
            showShopPrice: !!ps?.showShopPrice,
            showCustomerWhatsapp: ps?.showCustomerWhatsapp ?? true,
          })
        : null,
    [detail.data, ps?.showShopPrice, ps?.showCustomerWhatsapp],
  );

  /* ---------- preview scaling ---------- */
  const viewport = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit to width
  const [pageH, setPageH] = useState(1123);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      setFit(Math.min(1, (el.clientWidth - 2) / A4_PX));
      if (page.current) setPageH(page.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (page.current) ro.observe(page.current);
    return () => ro.disconnect();
  }, [model]);
  const scale = zoom ?? fit;

  /* ---------- actions ---------- */
  const [busy, setBusy] = useState<string>("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode>(null);
  const pdfCache = useRef<{ key: string; blob: Blob } | null>(null);

  const getPdf = useCallback(async () => {
    if (!model) throw new Error("Invoice not loaded");
    const key = `${model.id}:${model.totalCents}:${model.paidCents}:${model.status}:${model.customer.whatsapp}`;
    if (pdfCache.current?.key === key) return pdfCache.current.blob;
    const blob = await buildA4InvoicePdf(model, { logoSrc: "/nugathalawa-logo.jpg" });
    pdfCache.current = { key, blob };
    return blob;
  }, [model]);

  async function downloadPdf() {
    if (!model) return;
    setBusy("pdf");
    setNotice(null);
    try {
      downloadBlob(await getPdf(), pdfFileName(model));
      setNotice({ kind: "ok", text: `Downloaded ${pdfFileName(model)}` });
    } catch (e) {
      setNotice({ kind: "err", text: `Could not create the PDF: ${(e as Error).message}` });
    } finally {
      setBusy("");
    }
  }
  async function downloadReceiptPdf() {
    if (!model) return;
    setBusy("receipt");
    try {
      downloadBlob(await buildThermalPdf(model, thermal), pdfFileName(model, "receipt"));
    } catch (e) {
      setNotice({ kind: "err", text: `Could not create the receipt PDF: ${(e as Error).message}` });
    } finally {
      setBusy("");
    }
  }
  function print(mode: "a4" | "thermal") {
    setPrintMode(mode);
    // wait one frame so the portal renders the chosen layout
    setTimeout(() => runPrint(mode, thermal), 30);
  }

  /* ---------- WhatsApp ---------- */
  const [waInput, setWaInput] = useState("");
  const [savingWa, setSavingWa] = useState(false);
  useEffect(() => {
    if (model) setWaInput(displayPhone(model.customer.whatsappRaw));
  }, [model?.id, model?.customer.whatsappRaw]); // eslint-disable-line react-hooks/exhaustive-deps
  const phone = validatePhone(waInput);
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    if (typeof File === "undefined") return;
    setCanNativeShare(canShareFiles(new File(["%PDF-1.4"], "probe.pdf", { type: "application/pdf" })));
  }, []);

  const message = model
    ? `Hello ${model.customer.shopName},\n\nPlease find your invoice ${model.number} from ${model.business.name} attached as a PDF.\n\nTotal: ${lkr(model.totalCents)}\nPaid: ${lkr(model.paidCents)}\nBalance: ${lkr(model.outstandingCents)}\n\nThank you!`
    : "";

  async function sharePdf() {
    if (!model) return;
    setBusy("share");
    setNotice(null);
    try {
      const blob = await getPdf();
      const file = new File([blob], pdfFileName(model), { type: "application/pdf" });
      if (!canShareFiles(file)) throw new Error("This device can't share files.");
      await navigator.share({ files: [file], title: `Invoice ${model.number}`, text: message });
      setNotice({
        kind: "info",
        text: "Share sheet opened. Delivery isn't confirmed automatically, so check the chat in WhatsApp.",
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setNotice({ kind: "err", text: `Sharing failed: ${(e as Error).message}. Use Download PDF and Open WhatsApp instead.` });
    } finally {
      setBusy("");
    }
  }
  function openWhatsApp() {
    if (!phone.ok) {
      setNotice({ kind: "err", text: phone.message });
      return;
    }
    window.open(
      `https://wa.me/${phone.normalized}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setNotice({ kind: "info", text: "WhatsApp opened. Attach the downloaded PDF in the chat before sending." });
  }
  async function saveNumber() {
    if (!model) return;
    if (!phone.ok) {
      setNotice({ kind: "err", text: phone.message });
      return;
    }
    setSavingWa(true);
    try {
      await api(`/invoices/${model.id}/whatsapp`, {
        method: "PATCH",
        body: JSON.stringify({ whatsapp: phone.normalized }),
      });
      await detail.refetch();
      setNotice({ kind: "ok", text: "WhatsApp number saved for this invoice." });
    } catch (e) {
      setNotice({ kind: "err", text: (e as Error).message });
    } finally {
      setSavingWa(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div
        className="dialog-card invoice-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={model ? `Invoice ${model.number}` : "Invoice"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="iv-head">
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">Invoice</span>
            <h3>{model?.number || "Loading…"}</h3>
          </div>
          <div className="iv-zoom" role="group" aria-label="Zoom">
            <button className="secondary" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.3, +(scale - 0.15).toFixed(2)))}>
              <Minus size={15} />
            </button>
            <button className="secondary iv-zoom-label" onClick={() => setZoom(null)} title="Fit to width">
              {zoom === null ? "Fit" : `${Math.round(scale * 100)}%`}
            </button>
            <button className="secondary" aria-label="Zoom in" onClick={() => setZoom(Math.min(1.6, +(scale + 0.15).toFixed(2)))}>
              <Plus size={15} />
            </button>
          </div>
          <button className="secondary iv-close" onClick={close} aria-label="Close invoice">
            <X size={18} />
          </button>
        </div>

        <div className="iv-body">
          {detail.isLoading ? (
            <div className="loader" />
          ) : detail.isError || !model ? (
            <div className="error">Could not load this invoice. You may not have access to it.</div>
          ) : (
            <>
              <div className="iv-viewport" ref={viewport}>
                <div className="iv-stage" style={{ width: A4_PX * scale, height: pageH * scale }}>
                  <div ref={page} className="iv-page" style={{ transform: `scale(${scale})` }}>
                    <InvoiceDocument model={model} />
                  </div>
                </div>
              </div>

              <section className="iv-wa" aria-label="Send PDF via WhatsApp">
                <div className="iv-wa-title">
                  <MessageCircle size={18} />
                  <b>Send PDF via WhatsApp</b>
                </div>
                <label className="iv-wa-field">
                  Recipient number
                  <div className="iv-wa-row">
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={waInput}
                      onChange={(e) => setWaInput(e.target.value)}
                      placeholder="07X XXX XXXX or +44…"
                      aria-invalid={!!waInput && !phone.ok}
                    />
                    <button className="secondary" type="button" onClick={saveNumber} disabled={savingWa || !phone.ok}>
                      <Save size={15} /> {savingWa ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {waInput && !phone.ok && <small className="iv-err">{phone.message}</small>}
                </label>
                <div className="iv-wa-actions">
                  {canNativeShare && (
                    <button className="primary" onClick={sharePdf} disabled={busy === "share"}>
                      {busy === "share" ? <Loader2 size={16} className="spin" /> : <Share2 size={16} />}
                      Share PDF
                    </button>
                  )}
                  <button className="secondary" onClick={downloadPdf} disabled={busy === "pdf"}>
                    <Download size={16} /> Download PDF
                  </button>
                  <button className="secondary" onClick={openWhatsApp} disabled={!phone.ok}>
                    <MessageCircle size={16} /> Open WhatsApp
                  </button>
                </div>
                <p className="iv-hint">
                  {canNativeShare
                    ? "Share PDF opens your phone's share sheet; pick WhatsApp and the contact."
                    : "WhatsApp links can't attach files. Download the PDF, then open WhatsApp and attach it."}
                </p>
              </section>
              {notice && (
                <p className={`iv-notice ${notice.kind}`} role="status">
                  {notice.text}
                </p>
              )}
            </>
          )}
        </div>

        {model && (
          <div className="iv-actions">
            <button className="primary" onClick={downloadPdf} disabled={busy === "pdf"}>
              {busy === "pdf" ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              <span>Download PDF</span>
            </button>
            <button className="secondary" onClick={() => print("a4")}>
              <Printer size={16} />
              <span>Print Invoice</span>
            </button>
            <button className="secondary" onClick={() => print("thermal")}>
              <ReceiptText size={16} />
              <span>Print Bill</span>
              <small>{thermal.paperWidthMm}mm</small>
            </button>
            <button className="secondary" onClick={downloadReceiptPdf} disabled={busy === "receipt"} title="Receipt as PDF">
              <Download size={16} />
              <span>Receipt PDF</span>
            </button>
          </div>
        )}
      </div>
      <PrintRoot mode={printMode} model={model} thermal={thermal} />
    </div>
  );
}
