/**
 * Sanjeewa Distribution ERP — Bluetooth Thermal Printer & ESC/POS Integration
 * Supports 58mm and 80mm paper widths, Web Bluetooth API and Browser Print Dialog fallback.
 */

export interface ThermalSettings {
  printerName: string;
  paperWidth: "58mm" | "80mm" | "custom";
  customWidthMm: number;
  fontSize: "small" | "normal" | "large";
  textDensity: "normal" | "high";
  showLogo: boolean;
  showQr: boolean;
  autoCut: boolean;
  copies: number;
  defaultMode: "browser" | "bluetooth";
}

export const DEFAULT_THERMAL_SETTINGS: ThermalSettings = {
  printerName: "Bluetooth Thermal POS",
  paperWidth: "58mm",
  customWidthMm: 58,
  fontSize: "normal",
  textDensity: "normal",
  showLogo: true,
  showQr: true,
  autoCut: false,
  copies: 1,
  defaultMode: "browser",
};

const STORAGE_KEY = "sanjeewa_erp_thermal_settings_v1";

export function getThermalSettings(): ThermalSettings {
  if (typeof window === "undefined") return DEFAULT_THERMAL_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THERMAL_SETTINGS;
    return { ...DEFAULT_THERMAL_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_THERMAL_SETTINGS;
  }
}

export function saveThermalSettings(settings: Partial<ThermalSettings>): ThermalSettings {
  const current = getThermalSettings();
  const updated = { ...current, ...settings };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage error
    }
  }
  return updated;
}

export function getLineWidthChars(paperWidth: "58mm" | "80mm" | "custom", customWidthMm = 58): number {
  if (paperWidth === "80mm") return 48;
  if (paperWidth === "58mm") return 32;
  // Custom: roughly 1 char per 1.8mm
  return Math.max(24, Math.floor(customWidthMm / 1.8));
}

export function formatColumns(left: string, right: string, width = 32): string {
  const leftClean = left.trim();
  const rightClean = right.trim();
  const spaceNeeded = width - leftClean.length - rightClean.length;
  if (spaceNeeded > 0) {
    return leftClean + " ".repeat(spaceNeeded) + rightClean;
  }
  // If too long, truncate left text slightly
  const maxLeft = Math.max(4, width - rightClean.length - 1);
  return leftClean.slice(0, maxLeft) + " " + rightClean;
}

export function formatCentered(text: string, width = 32): string {
  const t = text.trim();
  if (t.length >= width) return t.slice(0, width);
  const leftPad = Math.floor((width - t.length) / 2);
  const rightPad = width - t.length - leftPad;
  return " ".repeat(leftPad) + t + " ".repeat(rightPad);
}

export function makeDashes(width = 32, char = "-"): string {
  return char.repeat(width);
}

/**
 * Builds an ESC/POS binary command buffer for standard receipt printers.
 */
export function buildEscPosBuffer(data: {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  invoiceNumber: string;
  invoiceDate: string;
  shopName: string;
  customerPhone?: string;
  repName?: string;
  items: Array<{
    name: string;
    variantLabel?: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    discount?: number;
  }>;
  subtotal: number;
  discount: number;
  grandTotal: number;
  paid: number;
  balance: number;
  paymentMethod: string;
  verificationUrl?: string;
  settings?: ThermalSettings;
}): Uint8Array {
  const s = data.settings || getThermalSettings();
  const width = getLineWidthChars(s.paperWidth, s.customWidthMm);
  const encoder = new TextEncoder();
  const chunks: number[] = [];

  function addBytes(...bytes: number[]) {
    chunks.push(...bytes);
  }

  function addText(str: string) {
    const encoded = encoder.encode(str);
    for (let i = 0; i < encoded.length; i++) {
      chunks.push(encoded[i]);
    }
  }

  function addLine(str = "") {
    addText(str + "\n");
  }

  // 1. ESC @ — Initialize printer
  addBytes(0x1b, 0x40);

  // High density / bold mode if configured
  if (s.textDensity === "high") {
    addBytes(0x1b, 0x47, 0x01); // Turn on double-strike
  }

  for (let copy = 0; copy < Math.max(1, s.copies); copy++) {
    if (copy > 0) {
      addLine("\n" + makeDashes(width, "=") + "\n");
      addLine(formatCentered(`** DUPLICATE COPY (${copy + 1}) **`, width));
      addLine(makeDashes(width, "=") + "\n");
    }

    // 2. Header (Centered, bold title)
    addBytes(0x1b, 0x61, 0x01); // Center align
    addBytes(0x1b, 0x21, 0x20); // Double height
    addLine(data.businessName.toUpperCase());
    addBytes(0x1b, 0x21, 0x00); // Normal text
    addLine(data.businessAddress);
    addLine(`Tel: ${data.businessPhone}`);
    addLine(makeDashes(width, "-"));

    addBytes(0x1b, 0x45, 0x01); // Bold on
    addLine("SALES RECEIPT");
    addBytes(0x1b, 0x45, 0x00); // Bold off

    // 3. Meta info (Left aligned)
    addBytes(0x1b, 0x61, 0x00); // Left align
    addLine(formatColumns(`Inv: ${data.invoiceNumber}`, `Date: ${data.invoiceDate}`, width));
    addLine(`Customer: ${data.shopName}`);
    if (data.customerPhone) {
      addLine(`Phone: ${data.customerPhone}`);
    }
    if (data.repName) {
      addLine(`Sales Rep: ${data.repName}`);
    }
    addLine(makeDashes(width, "-"));

    // 4. Items table
    addLine(formatColumns("ITEM / DESC", "TOTAL (LKR)", width));
    addLine(makeDashes(width, "."));

    for (const item of data.items) {
      const desc = item.variantLabel ? `${item.name} (${item.variantLabel})` : item.name;
      addLine(desc.slice(0, width));
      const subLine = `${item.quantity} x ${item.unitPrice.toFixed(2)}`;
      const totalStr = item.lineTotal.toFixed(2);
      addLine(formatColumns(subLine, totalStr, width));
      if (item.discount && item.discount > 0) {
        addLine(formatColumns(" (Item Disc)", `-${item.discount.toFixed(2)}`, width));
      }
    }

    addLine(makeDashes(width, "-"));

    // 5. Totals
    addLine(formatColumns("Subtotal:", data.subtotal.toFixed(2), width));
    if (data.discount > 0) {
      addLine(formatColumns("Discount:", `-${data.discount.toFixed(2)}`, width));
    }

    // Grand total double-width/bold
    addBytes(0x1b, 0x45, 0x01); // Bold on
    addBytes(0x1b, 0x21, 0x10); // Double width
    addLine(formatColumns("TOTAL:", `LKR ${data.grandTotal.toFixed(2)}`, Math.floor(width / 2)));
    addBytes(0x1b, 0x21, 0x00); // Normal size
    addBytes(0x1b, 0x45, 0x00); // Bold off

    addLine(formatColumns("Paid Amount:", data.paid.toFixed(2), width));
    addBytes(0x1b, 0x45, 0x01); // Bold on
    addLine(formatColumns("BALANCE DUE:", `LKR ${data.balance.toFixed(2)}`, width));
    addBytes(0x1b, 0x45, 0x00); // Bold off
    addLine(`Payment Method: ${data.paymentMethod.toUpperCase()}`);

    addLine(makeDashes(width, "-"));

    // 6. Footer & Signatures
    addBytes(0x1b, 0x61, 0x01); // Center align
    addLine("Thank you for your business!");
    addLine("ස්තූතියි! නැවත එන්න.");
    if (data.verificationUrl && s.showQr) {
      addLine(`Verify: ${data.verificationUrl}`);
    }

    addLine("\n");
    addBytes(0x1b, 0x61, 0x00); // Left align
    addLine(formatColumns("Issued By: ______", "Received: ______", width));
    addLine("\n\n\n"); // Feed paper

    // 7. Auto-cut if supported & enabled
    if (s.autoCut) {
      addBytes(0x1d, 0x56, 0x42, 0x00); // GS V 66 0 (Feed and partial cut)
    }
  }

  return new Uint8Array(chunks);
}

/**
 * Check if Web Bluetooth is available in the current browser.
 */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/**
 * Connect to a paired Bluetooth thermal printer and send ESC/POS bytes.
 */
export async function printViaBluetooth(
  buffer: Uint8Array,
  onStatus?: (status: string) => void
): Promise<{ ok: boolean; message: string }> {
  if (!isBluetoothSupported()) {
    throw new Error(
      "Web Bluetooth is not supported by this browser. Please use Chrome on Android/Desktop or use the Browser Print Fallback."
    );
  }

  onStatus?.("Scanning for Bluetooth printers...");

  try {
    // Known standard Bluetooth SPP & ESC/POS printer service UUIDs
    const device = await (navigator as any).bluetooth.requestDevice({
      filters: [
        { namePrefix: "MPT" },
        { namePrefix: "RP" },
        { namePrefix: "POS" },
        { namePrefix: "Printer" },
        { namePrefix: "Thermal" },
        { namePrefix: "Bluetooth" },
      ],
      optionalServices: [
        "000018f0-0000-1000-8000-00805f9b34fb",
        "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
        "49535343-fe7d-4ae5-8fa9-9fafd205e455",
        0xffe0,
        0x18f0,
      ],
      acceptAllDevices: false,
    }).catch(async () => {
      // Fallback: accept all devices if filtered name not matched
      return await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          "000018f0-0000-1000-8000-00805f9b34fb",
          "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
          "49535343-fe7d-4ae5-8fa9-9fafd205e455",
          0xffe0,
          0x18f0,
        ],
      });
    });

    if (!device) {
      return { ok: false, message: "No printer selected." };
    }

    onStatus?.(`Connecting to ${device.name || "Bluetooth Printer"}...`);
    const server = await device.gatt.connect();

    // Search for writable characteristic across available services
    let targetChar: any = null;
    const services = await server.getPrimaryServices();

    for (const service of services) {
      try {
        const chars = await service.getCharacteristics();
        for (const char of chars) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            targetChar = char;
            break;
          }
        }
      } catch {
        // continue search
      }
      if (targetChar) break;
    }

    if (!targetChar) {
      throw new Error("Could not find a writable ESC/POS characteristic on this printer.");
    }

    onStatus?.("Sending print commands to printer...");

    // Send in chunks of 100 bytes to avoid BLE MTU overflow
    const chunkSize = 100;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const slice = buffer.slice(offset, offset + chunkSize);
      if (targetChar.properties.writeWithoutResponse) {
        await targetChar.writeValueWithoutResponse(slice);
      } else {
        await targetChar.writeValue(slice);
      }
      // Small pause between packets
      await new Promise((r) => setTimeout(r, 25));
    }

    onStatus?.("Receipt printed successfully!");
    return { ok: true, message: `Printed successfully to ${device.name || "Thermal Printer"}` };
  } catch (err: any) {
    if (err.name === "NotFoundError" || err.message?.includes("cancelled")) {
      return { ok: false, message: "Bluetooth printer selection was cancelled." };
    }
    throw err;
  }
}

/**
 * Universal Browser Print Fallback:
 * Injects a hidden print stylesheet formatted strictly for the chosen paper width,
 * invoking the OS print dialog directly to whatever Bluetooth/USB printer is paired.
 */
export function printReceiptViaBrowser(receiptElementId: string, settings?: ThermalSettings): void {
  const s = settings || getThermalSettings();
  const widthMm = s.paperWidth === "80mm" ? 80 : s.paperWidth === "custom" ? s.customWidthMm : 58;

  const elem = document.getElementById(receiptElementId);
  if (!elem) {
    window.print();
    return;
  }

  // Create isolated print frame
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    window.print();
    return;
  }

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Receipt</title>
        <style>
          @page {
            size: ${widthMm}mm auto;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            width: ${widthMm}mm;
            padding: 3mm;
            font-family: -apple-system, BlinkMacSystemFont, "Courier New", Courier, monospace;
            font-size: ${s.fontSize === "small" ? "10px" : s.fontSize === "large" ? "13px" : "11px"};
            line-height: 1.35;
            color: #000;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .thermal-receipt {
            width: 100%;
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 4px 0; }
          .double-divider { border-top: 2px dashed #000; margin: 6px 0; }
          .row { display: flex; justify-content: space-between; margin: 2px 0; }
          .total-box { font-size: 1.15em; font-weight: bold; margin: 4px 0; }
        </style>
      </head>
      <body>
        ${elem.innerHTML}
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  }, 250);
}
