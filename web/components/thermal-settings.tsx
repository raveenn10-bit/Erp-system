"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Printer, ReceiptText, Save } from "lucide-react";
import { api } from "@/lib/api";
import { sanitizeThermal, type InvoiceModel, type ThermalSettings } from "@/lib/invoice-model";
import { PrintRoot, runPrint, usePrintSettings } from "./invoice-actions";
import { ThermalReceipt } from "./invoice-document";

/** Clearly-labelled sample used only for the test print — never saved. */
function testModel(businessName: string): InvoiceModel {
  return {
    id: "test-print",
    number: "TEST-PRINT",
    dateLabel: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short", year: "numeric" }).format(new Date()),
    timeLabel: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date()),
    status: "posted",
    cancelled: false,
    business: { name: businessName || "Test print", address: "", phone: "", whatsapp: "", email: "" },
    customer: { shopName: "PRINTER TEST — not an invoice", address: "", whatsapp: "", whatsappRaw: "" },
    lines: [
      { id: "1", description: "Sample item", pack: "100g", priceType: "Wholesale", quantity: 2, unitCents: 27000, shopPriceCents: 0, discountCents: 0, lineCents: 54000 },
      { id: "2", description: "Sample item with a long description to test wrapping", pack: "200g", priceType: "Retail", quantity: 1, unitCents: 52000, shopPriceCents: 0, discountCents: 2000, lineCents: 50000 },
    ],
    subtotalCents: 104000,
    itemDiscountCents: 2000,
    invoiceDiscountCents: 0,
    totalCents: 104000,
    paidCents: 104000,
    outstandingCents: 0,
    paymentMethod: "Cash",
    paymentTerms: "",
    dueDate: "",
    notes: "",
    terms: "",
    showShopPrice: false,
  };
}

export function ThermalPrinterSettings({ businessName }: { businessName: string }) {
  const q = usePrintSettings();
  const client = useQueryClient();
  const [s, setS] = useState<ThermalSettings>(sanitizeThermal({}));
  const [preset, setPreset] = useState<"58" | "80" | "custom">("80");
  const [msg, setMsg] = useState("");
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setS(q.data.thermal);
    setPreset(q.data.thermal.paperWidthMm === 58 ? "58" : q.data.thermal.paperWidthMm === 80 ? "80" : "custom");
  }, [q.data]);

  const set = (patch: Partial<ThermalSettings>) => setS((cur) => sanitizeThermal({ ...cur, ...patch }));
  function choose(p: "58" | "80" | "custom") {
    setPreset(p);
    if (p === "58") set({ paperWidthMm: 58, printableWidthMm: 48 });
    if (p === "80") set({ paperWidthMm: 80, printableWidthMm: 72 });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/billing/settings", { method: "PATCH", body: JSON.stringify({ thermalPrinter: s }) });
      await client.invalidateQueries({ queryKey: ["print-settings"] });
      setMsg("Printer settings saved.");
    } catch (err) {
      setMsg((err as Error).message);
    }
  }
  function testPrint() {
    setPrinting(true);
    setTimeout(() => {
      runPrint("thermal", s);
      setTimeout(() => setPrinting(false), 2000);
    }, 30);
  }
  const model = testModel(businessName);
  return (
    <form className="panel form-panel" onSubmit={save} style={{ marginTop: 20 }}>
      <div className="panel-head">
        <h3>
          <ReceiptText size={18} style={{ verticalAlign: -3, marginRight: 8 }} />
          Thermal bill printer
        </h3>
      </div>
      <div className="thermal-grid">
        <div className="form-grid">
          <label className="span-2">
            Paper width
            <div className="segmented" role="radiogroup" aria-label="Paper width" style={{ width: "fit-content" }}>
              {(["58", "80", "custom"] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={preset === p} className={preset === p ? "on" : ""} onClick={() => choose(p)}>
                  {preset === p && <span className="seg-bg" />}
                  <span>{p === "custom" ? "Custom" : `${p}mm`}</span>
                </button>
              ))}
            </div>
          </label>
          {preset === "custom" && (
            <label>
              Custom paper width (mm)
              <input type="number" min={40} max={120} value={s.paperWidthMm} onChange={(e) => set({ paperWidthMm: +e.target.value })} />
            </label>
          )}
          <label>
            Printable width (mm)
            <input type="number" min={30} max={s.paperWidthMm} value={s.printableWidthMm} onChange={(e) => set({ printableWidthMm: +e.target.value })} />
          </label>
          <label>
            Font size (px)
            <input type="number" min={8} max={18} value={s.fontSizePx} onChange={(e) => set({ fontSizePx: +e.target.value })} />
          </label>
          <label>
            Print margin (mm)
            <input type="number" min={0} max={10} step={0.5} value={s.marginMm} onChange={(e) => set({ marginMm: +e.target.value })} />
          </label>
          <label>
            Copies
            <input type="number" min={1} max={5} value={s.copies} onChange={(e) => set({ copies: +e.target.value })} />
          </label>
          <label className="check-field">
            <input type="checkbox" checked={s.showLogo} onChange={(e) => set({ showLogo: e.target.checked })} />
            Print logo on receipt
          </label>
        </div>
        <div className="thermal-preview" aria-label="Receipt preview">
          <ThermalReceipt model={model} settings={s} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Bills print through the browser's print dialog to a printer paired with this phone or computer (Bluetooth or USB).
        Pair the printer in Android or Windows settings first. iPhone Safari can only reach AirPrint printers, so most
        Bluetooth thermal printers won't work from an iPhone.
      </p>
      {msg && <p className={msg.includes("saved") ? "badge" : "error"} style={{ marginTop: 10 }}>{msg}</p>}
      <div className="form-actions">
        <button className="primary">
          <Save size={16} /> Save printer settings
        </button>
        <button type="button" className="secondary" onClick={testPrint}>
          <Printer size={16} /> Test print
        </button>
      </div>
      <PrintRoot mode={printing ? "thermal" : null} model={model} thermal={s} />
    </form>
  );
}
