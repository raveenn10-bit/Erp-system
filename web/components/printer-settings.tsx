'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bluetooth, Printer, ReceiptText, RefreshCw, Save, Share2 } from 'lucide-react';
import { InvoiceReceipt } from '@/components/invoice-document';
import { isNative, type PrinterDevice } from '@/lib/native';
import {
  DEFAULT_PRINTER, listPairedPrinters, loadPrinter, paperSpec, printReceipt, sanitizeLayout, saveLayoutForAll,
  savePrinter, testReceiptModel, type PrinterSettings,
} from '@/lib/invoice/printer';

type Preset = '58' | '80' | 'custom';
const presetOf = (s: PrinterSettings): Preset => (s.paperWidthMm === 58 ? '58' : s.paperWidthMm === 80 ? '80' : 'custom');

/**
 * Thermal bill printer settings: printer connection (this phone) + receipt layout
 * (paper width, printable width, font size, margin, copies, logo) with live preview
 * and test print. Admin can save the layout as the default for every device.
 */
export function PrinterSettingsPanel({ admin = false, businessName = '', onChange, embedded = false }: {
  admin?: boolean; businessName?: string; onChange?: (s: PrinterSettings) => void; embedded?: boolean;
}) {
  const [s, setS] = useState<PrinterSettings>(DEFAULT_PRINTER);
  const [devices, setDevices] = useState<PrinterDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const native = isNative();
  useEffect(() => { loadPrinter().then(v => { setS(v); onChange?.(v); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every change is kept on this phone straight away.
  function update(patch: Partial<PrinterSettings>) {
    setS(cur => {
      const next = { ...cur, ...patch };
      const out = { ...next, ...sanitizeLayout(next) };
      savePrinter(out); onChange?.(out);
      return out;
    });
  }
  function choose(p: Preset) {
    if (p === '58') update({ paperWidthMm: 58, printableWidthMm: 48 });
    else if (p === '80') update({ paperWidthMm: 80, printableWidthMm: 72 });
    else update({ paperWidthMm: s.paperWidthMm === 58 || s.paperWidthMm === 80 ? 76 : s.paperWidthMm, printableWidthMm: s.paperWidthMm === 58 || s.paperWidthMm === 80 ? 68 : s.printableWidthMm });
  }
  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label); setMsg(null);
    try { const r = await fn(); if (r) setMsg({ t: r, ok: true }); }
    catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
    finally { setBusy(null); }
  }
  const spec = paperSpec(s);
  const sample = useMemo(() => testReceiptModel(businessName || 'Nugathalawa Ceylon Tea Export (Pvt) Ltd'), [businessName]);
  const preset = presetOf(s);
  // Preview scaled from printer dots to screen (~2.2 px per mm looks right on phones).
  const previewScale = Math.min(1, 240 / spec.dots);

  return (
    <section className={`panel prn ${embedded ? 'embedded' : ''}`} aria-label="Thermal bill printer settings">
      <div className="panel-head"><h3><ReceiptText size={18} /> Thermal bill printer · <span lang="si">රිසිට් මුද්‍රණය</span></h3></div>
      <div className="prn-grid">
        <div className="prn-form">
          <fieldset>
            <legend>Printer · <span lang="si">මුද්‍රණ ක්‍රමය</span> <small>(this phone)</small></legend>
            <div className="seg-row">
              {(['rawbt', 'bluetooth', 'system'] as const).map(mode => (
                <button key={mode} type="button" className={s.mode === mode ? 'primary' : 'secondary'} aria-pressed={s.mode === mode} onClick={() => update({ mode })} disabled={mode !== 'system' && !native}>
                  {mode === 'rawbt' ? 'RawBT app (recommended)' : mode === 'bluetooth' ? 'Bluetooth (direct)' : 'Android / browser print'}
                </button>
              ))}
            </div>
            {s.mode === 'rawbt' && <p className="muted">Pair the printer inside the RawBT app once. Each receipt is then sent portrait, at the exact width, and cut at the end.</p>}
            {s.mode === 'bluetooth' && (
              <>
                <p className="muted">Pair the printer in Android Settings → Bluetooth. <b>{s.device ? `Selected: ${s.device.name}` : 'No printer selected'}</b></p>
                <button type="button" className="secondary" disabled={!!busy} onClick={() => run('devices', async () => { setDevices(await listPairedPrinters()); })}>
                  <Bluetooth size={14} />{busy === 'devices' ? 'Loading…' : 'Find paired printers'}
                </button>
                {devices && (devices.length ? (
                  <ul className="device-list">{devices.map(d => (
                    <li key={d.address}><button type="button" className={s.device?.address === d.address ? 'primary' : 'secondary'} onClick={() => update({ device: d })}>{d.name}<small>{d.address}</small></button></li>
                  ))}</ul>
                ) : <p className="muted">No paired devices found.</p>)}
              </>
            )}
          </fieldset>

          <fieldset>
            <legend>Paper · <span lang="si">කඩදාසි</span></legend>
            <div className="seg-row" role="radiogroup" aria-label="Paper width">
              {(['58', '80', 'custom'] as const).map(p => (
                <button key={p} type="button" role="radio" aria-checked={preset === p} className={preset === p ? 'primary' : 'secondary'} onClick={() => choose(p)}>{p === 'custom' ? 'Custom' : `${p} mm`}</button>
              ))}
            </div>
            <div className="prn-fields">
              {preset === 'custom' && (
                <label>Paper width (mm)<input type="number" inputMode="numeric" min={40} max={120} value={s.paperWidthMm} onChange={e => update({ paperWidthMm: +e.target.value })} /></label>
              )}
              <label>Printable width (mm)<input type="number" inputMode="numeric" min={30} max={s.paperWidthMm} value={s.printableWidthMm} onChange={e => update({ printableWidthMm: +e.target.value })} /></label>
              <label>Font size<input type="number" inputMode="numeric" min={8} max={18} value={s.fontSizePx} onChange={e => update({ fontSizePx: +e.target.value })} /></label>
              <label>Side margin (mm)<input type="number" inputMode="decimal" min={0} max={10} step={0.5} value={s.marginMm} onChange={e => update({ marginMm: +e.target.value })} /></label>
              <label>Copies<input type="number" inputMode="numeric" min={1} max={5} value={s.copies} onChange={e => update({ copies: +e.target.value })} /></label>
              <label className="check-field"><input type="checkbox" checked={s.showLogo} onChange={e => update({ showLogo: e.target.checked })} /> Print logo</label>
            </div>
            <p className="muted">58 mm paper → printable 48 mm (384 dots). 80 mm → 72 mm (576 dots). If text is cut at the edges, lower the printable width or add margin.</p>
          </fieldset>
        </div>

        <div className="prn-preview" aria-label="Receipt preview">
          <div className="prn-paper" style={{ width: Math.round(spec.dots * previewScale) + 16 }}>
            <div style={{ width: spec.dots, zoom: previewScale } as React.CSSProperties}>
              <InvoiceReceipt m={sample} spec={spec} />
            </div>
          </div>
          <small>{s.paperWidthMm} mm paper · {spec.dots} dots · preview</small>
        </div>
      </div>

      {msg && <p className={`ninv-msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.t}</p>}
      <div className="form-actions">
        <button type="button" className="primary" disabled={!!busy} onClick={() => run('test', () => printReceipt(testReceiptModel(businessName || 'PRINTER TEST'), s))}>
          <Printer size={16} />{busy === 'test' ? 'Printing…' : 'Test print'}
        </button>
        <button type="button" className="secondary" disabled={!!busy} onClick={() => run('save', async () => { await savePrinter(s); return 'Saved on this phone · මෙම දුරකථනයේ සුරැකිණි'; })}>
          <Save size={16} /> Save
        </button>
        {admin && (
          <button type="button" className="secondary" disabled={!!busy} onClick={() => run('all', async () => { await saveLayoutForAll(s); return 'Saved as the default for all phones and the web ERP.'; })}>
            <Share2 size={16} />{busy === 'all' ? 'Saving…' : 'Save for all devices'}
          </button>
        )}
        <button type="button" className="secondary icon-only" aria-label="Reload saved settings" onClick={() => loadPrinter().then(setS)}><RefreshCw size={16} /></button>
      </div>
    </section>
  );
}
