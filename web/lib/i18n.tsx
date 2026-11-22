"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export type Language = "si" | "en";

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, defaultText?: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: "si",
  setLang: () => {},
  t: (key: string, defaultText?: string) => defaultText || key,
});

export const TRANSLATIONS: Record<Language, Record<string, string>> = {
  si: {
    // Top Bar & Global
    "app.title": "සංජීව බෙදාහැරීම් ERP",
    "app.subtitle": "නුගතලාව සිලෝන් ටී එක්ස්පෝර්ට් (පුද්) සමාගම",
    "lang.toggle": "English",
    "search.placeholder": "පාරිභෝගිකයින්, නිෂ්පාදන, බිල්පත් හෝ ගෙවීම් සොයන්න...",
    "search.no_results": "සොයාගැනීමට නොහැකි විය",
    "btn.save": "සුරකින්න",
    "btn.cancel": "අවලංගු කරන්න",
    "btn.close": "වසන්න",
    "btn.delete": "මකන්න",
    "btn.edit": "සංස්කරණය",
    "btn.print": "මුද්‍රණය",
    "btn.download": "බාගත කරන්න",
    "btn.preview": "පෙරදසුන",
    "btn.share": "බෙදාහරින්න",
    "btn.confirm": "ස්ථිර කරන්න",
    "btn.back": "ආපසු",
    "status.active": "සක්‍රීයයි",
    "status.inactive": "අක්‍රීයයි",
    "status.paid": "ගෙවා ඇත",
    "status.unpaid": "නොගෙවූ",
    "status.due": "හිඟ මුදල්",
    "status.posted": "ස්ථිර කළ",
    "status.draft": "කෙටුම්පත",

    // Navigation Categories
    "nav.cat.main": "ප්‍රධාන පාලක පුවරුව",
    "nav.cat.sales": "විකුණුම් සහ බිල්පත්",
    "nav.cat.inventory": "තොග සහ බෙදාහැරීම්",
    "nav.cat.customers": "පාරිභෝගිකයින් සහ නියෝජිතයින්",
    "nav.cat.finance": "මූල්‍ය සහ වාර්තා",
    "nav.cat.admin": "පරිපාලන සැකසුම්",

    // Navigation Items
    "nav.overview": "සාරාංශය (Dashboard)",
    "nav.pos": "Smart POS (ක්ෂණික විකුණුම්)",
    "nav.products": "නිෂ්පාදන (Products)",
    "nav.customers": "පාරිභෝගික සාප්පු (Customers)",
    "nav.inventory": "තොග පාලනය (Inventory)",
    "nav.invoices": "බිල්පත් (Invoices)",
    "nav.payments": "ගෙවීම් ලැබීම් (Payments)",
    "nav.credit_alerts": "ණය මතක් කිරීම් (Credit Alerts)",
    "nav.free_issues": "නොමිලේ සාම්පල (Free Issues)",
    "nav.consignments": "විකුණා ගෙවීම් (Consignments)",
    "nav.returns": "භාණ්ඩ ආපසු ගැනීම් (Returns)",
    "nav.expenses": "දෛනික වියදම් (Expenses)",
    "nav.cashbook": "මුදල් පොත (Cashbook)",
    "nav.revenue_analytics": "ආදායම් විශ්ලේෂණය (Analytics)",
    "nav.document_center": "ලේඛනාගාරය (Documents)",
    "nav.reports": "මූල්‍ය වාර්තා (Reports)",
    "nav.team": "සේවක මණ්ඩලය (Staff)",
    "nav.settings": "පද්ධති සැකසුම් (Settings)",

    // Smart POS
    "pos.title": "Smart POS විකුණුම් පර්යන්තය",
    "pos.subtitle": "වේගවත් බිල්පත් නිකුත් කිරීම සහ ස්වයංක්‍රීය තොග අඩු වීම",
    "pos.search_product": "නිෂ්පාදනයක් හෝ Barcode එකක් සොයන්න...",
    "pos.select_customer": "පාරිභෝගික සාප්පුව තෝරන්න",
    "pos.cart_empty": "සාප්පු කරත්තය හිස්ය. වම්පසින් නිෂ්පාදන එක් කරන්න.",
    "pos.cart_title": "වත්මන් බිල්පත (Shopping Cart)",
    "pos.checkout": "විකුණුම ස්ථිර කරන්න (Checkout)",
    "pos.save_send_whatsapp": "සුරකින්න සහ WhatsApp යවන්න",
    "pos.thermal_bill": "කුඩා බිල්පත (Thermal Print)",
    "pos.a4_invoice": "A4 ඉන්වොයිසිය",
    "pos.subtotal": "මුළු එකතුව (Subtotal)",
    "pos.discount": "වට්ටම් (Discount)",
    "pos.grand_total": "ශුද්ධ එකතුව (Total)",
    "pos.amount_paid": "ගෙවූ මුදල (Paid)",
    "pos.balance_due": "ඉතිරි මුදල (Balance)",
    "pos.credit_sale": "ණය විකුණුමකි (Credit)",
    "pos.cash_sale": "අත්පිට මුදල් (Cash)",
    "pos.bank_sale": "බැංකු තැන්පතු (Bank)",
    "pos.items_count": "අයිතම ගණන",

    // Customer & Credit Ledger
    "cust.title": "පාරිභෝගික ගිණුම් විස්තරය",
    "cust.owner": "හිමිකරු",
    "cust.phone": "දුරකථන අංකය",
    "cust.whatsapp": "WhatsApp අංකය",
    "cust.address": "ලිපිනය",
    "cust.credit_limit": "ණය සීමාව",
    "cust.available_credit": "ඉතිරි ණය සීමාව",
    "cust.outstanding": "ගෙවීමට ඇති මුළු ණය",
    "cust.overdue": "ප්‍රමාද වූ ණය (Overdue)",
    "cust.receive_payment": "ගෙවීමක් ලබාගන්න",
    "cust.print_statement": "ගිණුම් ප්‍රකාශනය මුද්‍රණය",

    // Passwords & Security
    "pwd.title": "මුරපදය වෙනස් කිරීම",
    "pwd.current": "වත්මන් මුරපදය",
    "pwd.new": "නව මුරපදය",
    "pwd.confirm": "නව මුරපදය තහවුරු කරන්න",
    "pwd.submit": "මුරපදය යාවත්කාලීන කරන්න",
    "pwd.success": "මුරපදය සාර්ථකව වෙනස් කරන ලදී.",

    // Alerts & Notifications
    "alerts.due_soon": "ණය ගෙවීමේ දිනය ළඟයි",
    "alerts.overdue": "ණය ගෙවීම ප්‍රමාද වී ඇත",
    "alerts.send_wa": "WhatsApp මතක් කිරීමක් යවන්න",
    "alerts.mark_read": "කියවූ බව සටහන් කරන්න",
  },
  en: {
    // Top Bar & Global
    "app.title": "Sanjeewa Distribution ERP",
    "app.subtitle": "Nugathalawa Ceylon Tea Export (Pvt) Ltd",
    "lang.toggle": "සිංහල",
    "search.placeholder": "Search customers, products, invoices, or payments...",
    "search.no_results": "No results found",
    "btn.save": "Save",
    "btn.cancel": "Cancel",
    "btn.close": "Close",
    "btn.delete": "Delete",
    "btn.edit": "Edit",
    "btn.print": "Print",
    "btn.download": "Download",
    "btn.preview": "Preview",
    "btn.share": "Share",
    "btn.confirm": "Confirm",
    "btn.back": "Back",
    "status.active": "Active",
    "status.inactive": "Inactive",
    "status.paid": "Paid",
    "status.unpaid": "Unpaid",
    "status.due": "Due",
    "status.posted": "Posted",
    "status.draft": "Draft",

    // Navigation Categories
    "nav.cat.main": "Main Workspace",
    "nav.cat.sales": "Sales & Billing",
    "nav.cat.inventory": "Inventory & Distribution",
    "nav.cat.customers": "Customers & Field Sales",
    "nav.cat.finance": "Finance & Reports",
    "nav.cat.admin": "Administration",

    // Navigation Items
    "nav.overview": "Dashboard",
    "nav.pos": "Smart POS",
    "nav.products": "Products",
    "nav.customers": "Customers & Shops",
    "nav.inventory": "Inventory Control",
    "nav.invoices": "Invoices & Billing",
    "nav.payments": "Payments",
    "nav.credit_alerts": "Credit Alerts",
    "nav.free_issues": "Free Issues",
    "nav.consignments": "Consignments",
    "nav.returns": "Sales Returns",
    "nav.expenses": "Expenses",
    "nav.cashbook": "Cashbook",
    "nav.revenue_analytics": "Revenue Analytics",
    "nav.document_center": "Document Center",
    "nav.reports": "Financial Reports",
    "nav.team": "Team & Staff",
    "nav.settings": "Settings",

    // Smart POS
    "pos.title": "Smart POS Terminal",
    "pos.subtitle": "Instant invoice generation & automated inventory deduction",
    "pos.search_product": "Search product or scan barcode...",
    "pos.select_customer": "Select Customer / Shop",
    "pos.cart_empty": "Cart is empty. Select products on the left to begin.",
    "pos.cart_title": "Current Order (Cart)",
    "pos.checkout": "Checkout Invoice",
    "pos.save_send_whatsapp": "Save & Send WhatsApp",
    "pos.thermal_bill": "Print Bill (Thermal)",
    "pos.a4_invoice": "A4 Invoice",
    "pos.subtotal": "Subtotal",
    "pos.discount": "Discount",
    "pos.grand_total": "Grand Total",
    "pos.amount_paid": "Amount Paid",
    "pos.balance_due": "Balance Due",
    "pos.credit_sale": "Credit Sale",
    "pos.cash_sale": "Cash",
    "pos.bank_sale": "Bank Transfer",
    "pos.items_count": "Items",

    // Customer & Credit Ledger
    "cust.title": "Customer Account Details",
    "cust.owner": "Owner",
    "cust.phone": "Phone",
    "cust.whatsapp": "WhatsApp",
    "cust.address": "Address",
    "cust.credit_limit": "Credit Limit",
    "cust.available_credit": "Available Credit",
    "cust.outstanding": "Total Outstanding",
    "cust.overdue": "Overdue Balance",
    "cust.receive_payment": "Receive Payment",
    "cust.print_statement": "Print Statement",

    // Passwords & Security
    "pwd.title": "Change Password",
    "pwd.current": "Current Password",
    "pwd.new": "New Password",
    "pwd.confirm": "Confirm New Password",
    "pwd.submit": "Update Password",
    "pwd.success": "Password successfully updated.",

    // Alerts & Notifications
    "alerts.due_soon": "Payment Due Soon",
    "alerts.overdue": "Payment Overdue",
    "alerts.send_wa": "Send WhatsApp Reminder",
    "alerts.mark_read": "Mark as Read",
  },
};

const LANG_STORAGE_KEY = "sanjeewa_erp_lang_pref_v1";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("si");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY) as Language;
      if (saved === "si" || saved === "en") {
        setLangState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  function setLang(newLang: Language) {
    setLangState(newLang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, newLang);
    } catch {
      // ignore
    }
  }

  function t(key: string, defaultText?: string): string {
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.si;
    if (dict[key]) return dict[key];
    const fallback = TRANSLATIONS.en;
    if (fallback[key]) return fallback[key];
    return defaultText || key;
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
