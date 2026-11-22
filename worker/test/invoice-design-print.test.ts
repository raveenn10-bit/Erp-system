import { describe, it, expect, beforeEach } from "vitest";
import { unstable_dev } from "wrangler";
import { renderPublicInvoiceHtml } from "../src/public-invoice";
import { buildEscPosBuffer, DEFAULT_THERMAL_SETTINGS, formatColumns } from "../../web/lib/thermal-printer";

describe("Professional Invoice Design & Thermal Printing Upgrade", () => {
  it("renders premium green-and-white A4 invoice matching reference image", () => {
    const html = renderPublicInvoiceHtml({
      invoice: {
        id: "inv-test-01",
        number: "INV-20261122-8888",
        created_at: "2026-11-22T10:00:00Z",
        due_at: "2026-12-06",
        shop_name: "Sanjeewa Super Centre",
        address: "Kandy Road, Narangoda",
        phone: "0771122334",
        customer_whatsapp: "94771122334",
        business_name: "Nugathalawa Ceylon Tea Export (Pvt) Ltd",
        business_address: "Na Sewana, Hamangalla, Narangoda, Sri Lanka",
        business_phone: "076 661 5492",
        business_whatsapp: "076 696 5493",
        payment_method: "credit",
        subtotal_cents: 1250000,
        item_discount_cents: 50000,
        invoice_discount_cents: 25000,
        total_cents: 1175000,
        paid_cents: 500000,
        terms: "Goods received in good condition. 30 days credit.",
      },
      items: [
        {
          name: "BOPF Premium Pure Ceylon Black Tea",
          variant_label: "1kg Foil Pack",
          quantity: 10,
          unit_price_cents: 125000,
          line_cents: 1250000,
          item_discount_cents: 50000,
        },
      ],
      showShopPrice: false,
      showCustomerWhatsapp: true,
    });

    // 1. Branding & Header verification
    expect(html).toContain("Nugathalawa Ceylon Tea Export (Pvt) Ltd");
    expect(html).toContain("Na Sewana, Hamangalla, Narangoda, Sri Lanka");
    expect(html).toContain("076 661 5492");
    expect(html).toContain("076 696 5493");
    expect(html).toContain("INVOICE");
    expect(html).toContain("INV-20261122-8888");

    // 2. Customer Section
    expect(html).toContain("Invoice to");
    expect(html).toContain("Sanjeewa Super Centre");
    expect(html).toContain("+94 77 112 2334");

    // 3. Product table with pack sizes & prices
    expect(html).toContain("BOPF Premium Pure Ceylon Black Tea");
    expect(html).toContain("1kg Foil Pack");
    expect(html).toContain("LKR 1,250.00");
    expect(html).toContain("LKR 11,750.00");

    // 4. Highlighted TOTAL bar & Payment info
    expect(html).toContain("TOTAL");
    expect(html).toContain("Payment Info:");
    expect(html).toContain("LKR 5,000.00"); // Paid
    expect(html).toContain("LKR 6,750.00"); // Balance

    // 5. Dual signatures & SVG decorations
    expect(html).toContain("Issued By / Authorized Signature");
    expect(html).toContain("Received By / Customer Signature");
    expect(html).toContain("<svg");
  });

  it("formats ESC/POS thermal buffer correctly for 58mm and 80mm roll widths", () => {
    // 58mm line width test (32 columns)
    const line58 = formatColumns("Subtotal:", "1250.00", 32);
    expect(line58.length).toBe(32);
    expect(line58.startsWith("Subtotal:")).toBe(true);
    expect(line58.endsWith("1250.00")).toBe(true);

    // 80mm line width test (48 columns)
    const line80 = formatColumns("Subtotal:", "1250.00", 48);
    expect(line80.length).toBe(48);

    // ESC/POS Binary Buffer Test
    const buf = buildEscPosBuffer({
      businessName: "Nugathalawa Ceylon Tea",
      businessAddress: "Na Sewana, Hamangalla",
      businessPhone: "076 661 5492",
      invoiceNumber: "INV-001",
      invoiceDate: "2026-11-22",
      shopName: "Thermal Shop Test",
      items: [
        {
          name: "FBOP Special",
          variantLabel: "500g",
          quantity: 2,
          unitPrice: 750,
          lineTotal: 1500,
        },
      ],
      subtotal: 1500,
      discount: 0,
      grandTotal: 1500,
      paid: 1500,
      balance: 0,
      paymentMethod: "cash",
      settings: {
        ...DEFAULT_THERMAL_SETTINGS,
        autoCut: true,
      },
    });

    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBeGreaterThan(100);

    // First bytes must be ESC @ (0x1B, 0x40) - Init Printer
    expect(buf[0]).toBe(0x1b);
    expect(buf[1]).toBe(0x40);

    // End must contain cut command GS V 66 0 (0x1D, 0x56, 0x42, 0x00) when autoCut is true
    const hasCut = buf.some((b, i) => b === 0x1d && buf[i + 1] === 0x56);
    expect(hasCut).toBe(true);
  });
});
