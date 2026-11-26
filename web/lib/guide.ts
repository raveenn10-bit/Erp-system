// In-app user guides, one per role, in Sinhala with English screen names.
// Examples are training values only — never real customers or prices.

export type GuideRole = 'admin' | 'sales_rep' | 'staff';
export type GuideSection = {
  id: string; icon: string; title: string; si: string;
  path?: string;                       // where to tap in the app
  intro?: string;
  steps?: string[];
  example?: Array<[string, string]>;   // field → example value
  tip?: string;
  warn?: string;
};
export type Guide = { role: GuideRole; title: string; si: string; who: string; intro: string; sections: GuideSection[] };

// ---------------- permissions (from the live roles/role_permissions tables) ----------------
export const PERMISSIONS: Array<{ si: string; en: string; admin: boolean; sales_rep: boolean; staff: boolean }> = [
  { si: 'Dashboard බැලීම', en: 'View dashboard', admin: true, sales_rep: true, staff: true },
  { si: 'නිෂ්පාදන බැලීම', en: 'View products', admin: true, sales_rep: true, staff: true },
  { si: 'නිෂ්පාදන එකතු / වෙනස් කිරීම', en: 'Create / edit products', admin: true, sales_rep: false, staff: false },
  { si: 'තොග බැලීම', en: 'View stock', admin: true, sales_rep: true, staff: false },
  { si: 'තොග එකතු / අඩු කිරීම (Adjust)', en: 'Adjust stock', admin: true, sales_rep: false, staff: false },
  { si: 'තොග මාරු කිරීම (Transfers)', en: 'Stock transfers', admin: true, sales_rep: false, staff: false },
  { si: 'තමාට පවරා ඇති කඩ බැලීම', en: 'View assigned shops', admin: true, sales_rep: true, staff: true },
  { si: 'සියලු කඩ බැලීම', en: 'View all shops', admin: true, sales_rep: false, staff: false },
  { si: 'නව කඩයක් ලියාපදිංචි කිරීම', en: 'Register shops', admin: true, sales_rep: true, staff: false },
  { si: 'කඩ විස්තර / ණය සීමාව වෙනස් කිරීම', en: 'Edit shops / credit limit', admin: true, sales_rep: false, staff: false },
  { si: 'බිල්පත් බැලීම', en: 'View invoices', admin: true, sales_rep: true, staff: false },
  { si: 'බිල්පත් සෑදීම (Finalize)', en: 'Create invoices', admin: true, sales_rep: true, staff: false },
  { si: 'බිල්පත් අවලංගු කිරීම', en: 'Cancel invoices', admin: true, sales_rep: false, staff: false },
  { si: 'ගෙවීම් බැලීම / ලියාපදිංචි කිරීම', en: 'View / record payments', admin: true, sales_rep: true, staff: false },
  { si: 'නොමිලේ නිකුත් කිරීම් (Free Issues)', en: 'Free issues', admin: true, sales_rep: true, staff: false },
  { si: 'භාර තොග (Consignments) – සෑදීම, settle, return', en: 'Consignments', admin: true, sales_rep: true, staff: false },
  { si: 'තමාගේ route / vehicle stock බැලීම', en: 'View own route & stock', admin: true, sales_rep: true, staff: false },
  { si: 'දවස අවසාන තොග ගණන් යැවීම', en: 'Submit end-of-day count', admin: true, sales_rep: true, staff: false },
  { si: 'Vehicles / Routes කළමනාකරණය', en: 'Manage vehicles & routes', admin: true, sales_rep: false, staff: false },
  { si: 'තොග වෙනස්කම් අනුමත කිරීම', en: 'Approve stock variances', admin: true, sales_rep: false, staff: false },
  { si: 'වියදම් (Expenses)', en: 'Expenses', admin: true, sales_rep: false, staff: false },
  { si: 'වාර්තා (Reports)', en: 'Reports', admin: true, sales_rep: false, staff: false },
  { si: 'රාජකාරිය (Start / End duty) — තමාගේ ස්ථානය බෙදාගැනීම', en: 'Duty & own GPS location', admin: true, sales_rep: true, staff: true },
  { si: 'සජීවී නියෝජිත ලුහුබැඳීම (සිතියම)', en: 'Live rep tracking (map)', admin: true, sales_rep: false, staff: false },
  { si: 'කණ්ඩායම / පරිශීලකයන් (Team)', en: 'Team & users', admin: true, sales_rep: false, staff: false },
  { si: 'ව්‍යාපාර සැකසුම් (Settings)', en: 'Business settings', admin: true, sales_rep: false, staff: false },
];

// ---------------- shared app sections ----------------
const LOGIN: GuideSection = {
  id: 'login', icon: 'LogIn', title: 'Login', si: 'ඇප් එකට පිවිසීම',
  steps: [
    'Nugathalawa ERP app එක open කරන්න.',
    '4-Digit PIN tab එකේ Username එක ටයිප් කර, ඔබේ අංක 4 PIN එක ඔබන්න — හෝ Password tab එකෙන් username/email සහ මුරපදය දාන්න.',
    'පළමු වතාවට log වූ පසු "Enable Biometric Login" ඇසුවොත් Enable ඔබන්න. ඊළඟ වතාවේ සිට ඇඟිලි සලකුණෙන්/මුහුණෙන් පමණක් පිවිසිය හැක.',
    'Biometric වැඩ නොකළොත් "Use PIN or Password · PIN හෝ මුරපදය" ඔබන්න.',
  ],
  warn: 'ඔබේ PIN / මුරපදය කාටවත් දෙන්න එපා. දුරකථනය වෙනස් කළොත් මුලින් PIN/මුරපදයෙන් පිවිසිය යුතුයි.',
};
const OFFLINE: GuideSection = {
  id: 'offline', icon: 'CloudOff', title: 'Offline & Sync Center', si: 'අන්තර්ජාලය නැති විට',
  intro: 'අන්තර්ජාලය නැති වුවත් බිල්පත්, ගෙවීම්, Free Issues, Consignments, තොග මාරු සහ දවස අවසාන ගණන් දුරකථනයේ සුරැකේ.',
  steps: [
    'අන්තර්ජාලය නැති විට බිල්පතක් Finalize කළ විට "saved on this phone · PENDING SYNC" පණිවිඩය පෙන්වයි.',
    'තිරයේ පහළ දකුණේ ඇති status chip එක බලන්න: Online — Synced / Offline / Pending Upload / Conflict.',
    'අන්තර්ජාලය ආ විට ඉබේම යවයි. Chip එක tap කර Sync Center විවෘත කර "Sync Now" ද ඔබිය හැක.',
    'Synced වූ පසු බිල්පතට සැබෑ INV-… අංකය ලැබේ.',
  ],
  warn: '"Conflict" පෙන්වුවොත් (උදා: තොග මදි) එය මකා දමන්න එපා — Admin ට කියන්න. තොග නිවැරදි කළ පසු Retry ඔබන්න. Upload නොවූ දේවල් තිබියදී Sign out නොකරන්න.',
};
const PRINT: GuideSection = {
  id: 'print', icon: 'Printer', title: 'Print & WhatsApp', si: 'බිල්පත මුද්‍රණය / යැවීම',
  path: 'බිල්පත Finalize කළ පසු විවෘත වන invoice තිරය',
  steps: [
    'Send PDF on WhatsApp — PDF එක සමඟ WhatsApp විවෘත වේ; කඩේ chat එක තෝරා ඇත්දැයි බලා Send ඔබන්න.',
    'Print receipt 58mm — Bluetooth thermal printer එකෙන් රිසිට්පත මුද්‍රණය වේ.',
    'Printer මුලින්ම සකසන්න: ⚙ (Printer settings) → "RawBT app (recommended)" → 58 mm තෝරන්න. RawBT app එකේ printer එක pair කර තිබිය යුතුයි.',
    'Download PDF — A4 බිල්පත Documents/SanjeewaERP folder එකට සුරැකේ. Print A4 — Wi-Fi printer එකකින් මුද්‍රණයට.',
  ],
  tip: 'රිසිට්පත ඇලවී / කුඩාවට එන්නේ නම් Printer settings හි 58 mm සහ RawBT app තෝරා ඇත්දැයි බලන්න.',
};
const UPDATES: GuideSection = {
  id: 'updates', icon: 'Sparkles', title: 'App updates', si: 'යාවත්කාලීන කිරීම්',
  steps: [
    'බොහෝ updates ඉබේම download වේ — "Update downloaded" පෙන්වූ විට Restart now ඔබන්න, නැත්නම් ඊළඟ වතාවේ app එක විවෘත කළ විට යෙදේ.',
    '"New update available" පෙන්වූ විට පමණක් Update now ඔබා download වූ ගොනුව install කරන්න. දත්ත නැති නොවේ.',
    'App version එක බැලීමට: status chip → Sync Center → App version / Check for updates.',
  ],
};

// ---------------- Admin ----------------
const admin: Guide = {
  role: 'admin', title: 'Admin Guide', si: 'පරිපාලක මාර්ගෝපදේශය', who: 'ව්‍යාපාර හිමිකරු / කළමනාකරු',
  intro: 'Admin ට සියලුම menu සහ permissions ඇත. නව පද්ධතියක් ආරම්භ කරන විට පහත පිළිවෙළට කරන්න: Products → Inventory → Customers → Team → Invoices → Payments → Reports.',
  sections: [
    LOGIN,
    { id: 'products', icon: 'Box', title: 'Products', si: 'නිෂ්පාදන', path: 'Menu › Products › Add a product',
      steps: ['Product name, SKU සහ variant විස්තර දාන්න.', 'Unit එකට pack / box / kg වැනි ඒකකය දාන්න (100g නොවේ).', 'මිල ගණන් 4 දාලා Add product ඔබන්න.'],
      example: [['Product name', 'Nugathalawa Ceylon Tea'], ['SKU', 'NCT-100'], ['Variant label', '100 g pack'], ['Unit', 'pack'], ['Weight in grams', '100'], ['Low stock alert', '10'], ['Wholesale price', '180'], ['Retail price', '220'], ['Shop selling price', '200'], ['Unit cost', '140']],
      tip: '50g, 100g, 200g සඳහා වෙන වෙනම variant/SKU භාවිත කරන්න.' },
    { id: 'inventory', icon: 'Warehouse', title: 'Inventory', si: 'තොග', path: 'Menu › Inventory › Stock adjustment',
      steps: ['Product variant එක තෝරන්න.', 'Quantity change: එකතු කිරීමට + අංකය (100), අඩු කිරීමට − අංකය (-5).', 'Reason දාලා Record movement ඔබන්න.'],
      example: [['Product variant', 'Nugathalawa Ceylon Tea · 100 g pack'], ['Quantity change', '100'], ['Reason', 'Opening stock']],
      warn: 'තොග 0 නම් බිල්පත Finalize නොවේ ("Not enough stock"). විකුණුම් පටන් ගැනීමට පෙර ආරම්භක තොග දාන්න. බිල්පතක් post කළ විට තොග ඉබේම අඩු වේ — නැවත අතින් අඩු නොකරන්න.' },
    { id: 'customers', icon: 'Building2', title: 'Customers', si: 'කඩ / ගනුදෙනුකරුවන්', path: 'Menu › Customers › Register a shop',
      steps: ['කඩේ විස්තර දාන්න.', 'Credit limit සහ Credit period (උපරිම දින 45) සකසන්න.', 'Assign sales rep තෝරලා Register shop ඔබන්න.'],
      example: [['Shop name', 'Galle City Grocery'], ['Owner name', 'Nimal Perera'], ['WhatsApp', '0771234567'], ['Address', 'Main Street, Galle'], ['Customer type', 'Wholesale'], ['Credit limit (LKR)', '20000'], ['Credit period (days)', '30'], ['Assign sales rep', 'අදාළ නියෝජිතයා']],
      warn: 'Credit limit 0 නම් ණයට බිල්පත් දැමිය නොහැක ("over the credit limit"). අනුමත මුදලට පමණක් සකසන්න.' },
    { id: 'team', icon: 'Users', title: 'Team', si: 'Sales Rep / Staff එකතු කිරීම', path: 'Menu › Team',
      steps: ['නම, email, username, role (Sales Representative / Staff) සහ මුරපදය දාලා user එක සාදන්න.', 'Edit Credentials මඟින් username, අංක 4 PIN සහ මුරපදය සකසන්න / වෙනස් කරන්න.', 'Sales rep ට තොග location එකක් (warehouse) සහ කඩ පවරන්න.'],
      warn: 'Admin මුරපදය සහ PIN එක ශක්තිමත් ඒවා කරන්න (උදා: Admin2026 / 2026 වැනි පොදු ඒවා නොවේ). සේවයෙන් ඉවත් වූ අයගේ account එක වහාම ඉවත් කරන්න.' },
    { id: 'distribution', icon: 'Truck', title: 'Distribution & Logistics', si: 'බෙදාහැරීම', path: 'Menu › Distribution',
      steps: ['Vehicles: වාහනය (අංකය, වර්ගය, driver) එකතු කරන්න.', 'Daily routes: දිනය, sales rep, වාහනය සහ කඩ තෝරා route එක සාදන්න.', 'Vehicle loading / Stock transfer: Main warehouse සිට වාහනයට තොග මාරු කර confirm කරන්න.', 'දවස අවසානයේ rep යවන තොග ගණන් පරීක්ෂා කර වෙනසක් ඇත්නම් Approve කරන්න.'],
      example: [['From', 'Main warehouse'], ['To', 'AAA vehicle stock'], ['Product', '100 g tea pack'], ['Quantity', '20']],
      tip: 'Main 100 න් 20ක් මාරු කළ පසු Main 80ක් සහ වාහනයේ 20ක් විය යුතුයි. Transfer සහ invoice දෙකක් — තොග දෙවරක් අඩු නොකරන්න.' },
    { id: 'invoices', icon: 'ReceiptText', title: 'Invoices / POS', si: 'බිල්පත්', path: 'Menu › Invoices (හෝ පහළ මැද + Bill බොත්තම)',
      steps: ['Customer / Shop සහ Stock location තෝරන්න.', 'Product සහ Quantity දාන්න; Price type (Wholesale / Retail) පරීක්ෂා කරන්න.', 'Payment method සහ මුලින් ලැබුණු මුදල (Initial payment) දාන්න.', 'සියල්ල පරීක්ෂා කර Finalize invoice ඔබන්න. පසුවට තබාගන්න නම් Save draft.'],
      example: [['Customer', 'Galle City Grocery'], ['Stock location', 'Main warehouse'], ['Product', '100 g pack × 10'], ['Price', 'Wholesale Rs.180 → Rs.1,800'], ['Payment method', 'Cash'], ['Initial payment', '1000']],
      warn: 'Finalize කළ බිල්පත වෙනස් කළ නොහැක. වැරදි නම් Returns මඟින් credit note එකක් දාන්න. Finalize නොවුණොත් බොත්තමට ඉහළින් රතු පාටින් හේතුව පෙන්වයි (තොග මදි / ණය සීමාව).' },
    PRINT,
    { id: 'payments', icon: 'Wallet', title: 'Payments', si: 'ගෙවීම්', path: 'Menu › Payments › Record a payment',
      steps: ['අදාළ invoice එක තෝරන්න.', 'ලැබුණු මුදල සහ ක්‍රමය දාලා Record payment ඔබන්න.'],
      example: [['Invoice', 'INV-…'], ['Collected amount', '800'], ['Method', 'Cash']],
      warn: 'බිල්පත සාදන විට දැමූ මුල් ගෙවීම නැවත මෙහි දාන්න එපා — ඉතිරි මුදල පමණක්.' },
    { id: 'free', icon: 'Gift', title: 'Free Issues', si: 'නොමිලේ නිකුත් කිරීම්', path: 'Menu › Free Issues',
      steps: ['කඩය, warehouse, product, quantity සහ හේතුව දාන්න.', 'Create free issue note ඔබන්න.'], example: [['Product', '100 g pack'], ['Quantity', '2'], ['Reason', 'Promotional sample']] },
    { id: 'consign', icon: 'PackageCheck', title: 'Consignments', si: 'භාර තොග (Sale or Return)', path: 'Menu › Consignments',
      steps: ['Delivery note එක සාදන්න (උදා: පැකට් 20).', 'කඩය විකුණූ ප්‍රමාණය කී විට "Settle sold quantity" → 12.', 'ආපසු ලැබුණු ඒවා "Return consignment stock" → 8 (Saleable / Damaged).'],
      warn: 'භාර තොග විකුණුමක් ලෙස සලකන්නේ settle කළ ප්‍රමාණය පමණයි.' },
    { id: 'alerts', icon: 'Bell', title: 'Credit Alerts', si: 'ණය මතක් කිරීම්', path: 'Menu › Credit Alerts',
      steps: ['ප්‍රමාද වූ / හිඟ බිල්පත් බලන්න.', 'Reminder / WhatsApp යැවීමට පෙර Payments හි ගෙවීම් දැනටමත් ලැබී ඇත්දැයි බලන්න.'] },
    { id: 'expenses', icon: 'ArrowDownLeft', title: 'Expenses', si: 'වියදම්', path: 'Menu › Expenses › Add expense',
      steps: ['දිනය, වර්ගය, මුදල සහ විස්තරය දාලා Save කරන්න.'], example: [['Category', 'Fuel'], ['Amount', '2500'], ['Note', 'Route Galle']] },
    { id: 'returns', icon: 'RotateCcw', title: 'Returns', si: 'ආපසු භාණ්ඩ', path: 'Menu › Returns',
      steps: ['මුල් invoice එක, හේතුව, product සහ qty දාන්න.', 'නැවත විකිණිය හැකි නම් Restock = Yes, හානි නම් No.', 'Issue credit note ඔබන්න.'], example: [['Reason', 'Damaged goods'], ['Qty × price', '2 × 180 = Rs.360'], ['Restock?', 'No']] },
    { id: 'reports', icon: 'BarChart3', title: 'Reports', si: 'වාර්තා', path: 'Menu › Reports',
      steps: ['Report වර්ගය සහ From / To දින තෝරන්න.', 'CSV (Excel) හෝ PDF ඔබා download කරන්න — Documents/SanjeewaERP folder එකට සුරැකේ.'],
      tip: 'වාර්තාවේ මුළු ගණන් invoice / payment ලැයිස්තු සමඟ ගැළපේදැයි ඉඳහිට පරීක්ෂා කරන්න.' },
    { id: 'tracking', icon: 'MapPin', title: 'Live Rep Tracking', si: 'සජීවී නියෝජිත ලුහුබැඳීම', path: 'Menu › Live Tracking',
      steps: ['"All reps" තේරූ විට රාජකාරියේ සිටින නියෝජිතයින් සිතියමේ පෙනේ: කොළ = Online, තැඹිලි = සංඥා නැත, අළු = රාජකාරියෙන් පිට (අවසන් ස්ථානය).', 'නියෝජිතයෙකු සහ දිනයක් තෝරා ඒ දවසේ ගිය මාර්ගය, දුර, කඩ පැමිණීම් (V) සහ බිල්පත් (B) බලන්න.', 'සිතියම තත්පර 30 කට වරක් යාවත්කාලීන වේ.'],
      tip: 'ස්ථාන පෙනෙන්නේ Admin ට පමණයි. නියෝජිතයා "Start duty" කළ සිට "End duty" කරන තුරු පමණක් ලුහුබඳිනු ලැබේ.' },
    { id: 'settings', icon: 'Settings', title: 'Settings', si: 'සැකසුම්', path: 'Menu › Settings',
      steps: ['ව්‍යාපාර නම, ලිපිනය, දුරකථන, WhatsApp, invoice terms සකසන්න — මේවා බිල්පත් / රිසිට්පත් වල පෙන්වයි.', 'Biometric login on/off: Settings / Profile › Biometric login.'] },
    OFFLINE, UPDATES,
  ],
};

// ---------------- Sales Rep ----------------
const rep: Guide = {
  role: 'sales_rep', title: 'Sales Rep Guide', si: 'විකුණුම් නියෝජිත මාර්ගෝපදේශය', who: 'අලුතින් පැමිණි Sales Representative',
  intro: 'ඔබට පවරා ඇති කඩ, තොග සහ route පමණක් පෙනේ. Reports, Expenses, Team, Settings Admin ට පමණයි. දිනපතා වැඩ පිළිවෙළ පහතින්.',
  sections: [
    LOGIN,
    { id: 'day', icon: 'Sun', title: 'Daily workflow', si: 'දිනපතා වැඩ පිළිවෙළ',
      steps: ['උදේ: app එක open කර Sync chip එක "Online — Synced" දැයි බලන්න.', 'Distribution: අද route එක, කඩ ලැයිස්තුව සහ වාහනයේ / ඔබේ තොග බලන්න.', 'කඩයට ගොස් → බිල්පත දාන්න → රිසිට්පත print / WhatsApp PDF යවන්න.', 'ගෙවීම් ලැබුණු විට Payments හි ලියාපදිංචි කරන්න.', 'සවස: ඉතිරි තොග ගණන් කර දවස අවසාන ගණන් (Reconciliation) යවන්න.'] },
    { id: 'duty', icon: 'MapPin', title: 'Start / End duty (GPS)', si: 'රාජකාරිය ආරම්භ / අවසන් කිරීම', path: 'Menu › Overview › Duty',
      steps: ['උදේ වැඩ පටන් ගන්නකොට Start duty ඔබන්න. Location අවසරය ඉල්ලුවොත් "While using the app" + Precise තෝරන්න.', 'රාජකාරියේ සිටින විට "On duty" notification එක පෙනේ — තිරය lock කළත් ස්ථානය තත්පර 30 කට වරක් office එකට යයි.', 'කඩයකට ගිය විට Check in at shop හි කඩය තෝරා Check in ඔබන්න.', 'දවසේ වැඩ ඉවර වූ විට End duty ඔබන්න — එවිට ලුහුබැඳීම නතර වේ.'],
      tip: 'අන්තර්ජාලය නැති විටත් ස්ථාන දුරකථනයේ සුරැකී, signal ආ විට ස්වයංක්‍රීයව යවයි.',
      warn: 'Web browser එකෙන් නම් page එක open කර තිරය on කර තබා ගත යුතුය. දවස පුරා ලුහුබැඳීමට Android app එක භාවිතා කරන්න.' },
    { id: 'route', icon: 'Truck', title: 'My route & stock', si: 'මගේ route / තොග', path: 'Menu › Distribution',
      steps: ['අද දින route එක තෝරන්න — පිවිසිය යුතු කඩ පෙනේ.', 'වාහනයට පටවා ඇති (loading) තොග ප්‍රමාණ පරීක්ෂා කරන්න; වෙනසක් ඇත්නම් වහාම Admin ට කියන්න.'],
      tip: 'ඔබට තොග එකතු කිරීමට / මාරු කිරීමට අවසර නැත — එය Admin කරයි.' },
    { id: 'shop', icon: 'Building2', title: 'Register a shop', si: 'නව කඩයක්', path: 'Menu › Customers › Register a shop',
      steps: ['කඩ නම, හිමිකරු, WhatsApp අංකය, ලිපිනය දාන්න.', 'Register shop ඔබන්න. ණය සීමාව Admin සකසයි.'],
      example: [['Shop name', 'Galle City Grocery'], ['Owner', 'Nimal Perera'], ['WhatsApp', '0771234567'], ['Address', 'Main Street, Galle']] },
    { id: 'bill', icon: 'ReceiptText', title: 'Make a bill', si: 'බිල්පතක් දැමීම', path: 'පහළ මැද + (Bill) බොත්තම',
      steps: ['කඩය සහ Stock location (ඔබේ වාහනය / තොගය) තෝරන්න.', 'Product, Quantity දාන්න — මුළු මුදල පහළින් පෙනේ.', 'කඩය දැන් ගෙවූ මුදල Initial payment ලෙස දාන්න (ණයට නම් 0).', 'පරීක්ෂා කර Finalize invoice ඔබන්න.'],
      example: [['Shop', 'Galle City Grocery'], ['Stock location', 'මගේ vehicle stock'], ['Product', '100 g pack × 10'], ['Total', 'Rs.1,800'], ['Initial payment', '1000']],
      warn: 'Finalize කළ පසු වෙනස් කළ නොහැක. "Not enough stock" හෝ "over the credit limit" පෙන්වුවොත් Admin අමතන්න.' },
    PRINT,
    { id: 'collect', icon: 'Wallet', title: 'Collect payment', si: 'ණය මුදල් එකතු කිරීම', path: 'පහළ Collect › Record a payment',
      steps: ['Invoice එක තෝරා ලැබුණු මුදල දාලා Record payment ඔබන්න.'], example: [['Invoice', 'INV-…'], ['Amount', '800'], ['Method', 'Cash']],
      warn: 'ලැබුණු මුදල පමණක් දාන්න. එකම ගෙවීම දෙවරක් දාන්න එපා.' },
    { id: 'free', icon: 'Gift', title: 'Free Issues', si: 'නොමිලේ නිකුත් කිරීම්', path: 'Menu › Free Issues',
      steps: ['කඩය, product, qty සහ හේතුව දාලා Create ඔබන්න.'], tip: 'නොමිලේ දෙන භාණ්ඩ invoice එකකට දාන්න එපා.' },
    { id: 'consign', icon: 'PackageCheck', title: 'Consignments', si: 'භාර තොග', path: 'Menu › Consignments',
      steps: ['භාර දෙන විට Delivery note සාදන්න.', 'නැවත යන විට විකුණූ ප්‍රමාණය Settle කරන්න; ඉතිරි ඒවා Return කරන්න.'] },
    { id: 'eod', icon: 'ClipboardCheck', title: 'End-of-day count', si: 'දවස අවසාන තොග ගණන්', path: 'Menu › Distribution › අද route › Reconciliation',
      steps: ['වාහනයේ ඉතිරි සෑම product එකක්ම ගණන් කර ඇති ප්‍රමාණය දාන්න.', 'Submit ඔබන්න. වෙනසක් ඇත්නම් Admin අනුමත කරයි.'], warn: 'ඇත්තටම ගණන් කළ ප්‍රමාණය පමණක් දාන්න.' },
    OFFLINE, UPDATES,
  ],
};

// ---------------- Staff ----------------
const staff: Guide = {
  role: 'staff', title: 'Staff Guide', si: 'කාර්ය මණ්ඩල මාර්ගෝපදේශය', who: 'කාර්යාල / ගබඩා සහායක',
  intro: 'Staff account එකට බැලීමට පමණක් අවසර ඇත: Dashboard, නිෂ්පාදන සහ පවරා ඇති කඩ. බිල්පත්, ගෙවීම්, තොග වෙනස් කිරීම් කළ නොහැක — ඒවා අවශ්‍ය නම් Admin ගෙන් role එක වෙනස් කරගන්න.',
  sections: [
    LOGIN,
    { id: 'dash', icon: 'LayoutDashboard', title: 'Overview', si: 'දළ විශ්ලේෂණය', path: 'Menu › Overview', steps: ['අද විකුණුම්, මාසික විකුණුම් සහ මතක් කිරීම් බලන්න.'] },
    { id: 'products', icon: 'Box', title: 'Products', si: 'නිෂ්පාදන / මිල', path: 'Menu › Products', steps: ['නිෂ්පාදන, variants සහ මිල ගණන් සොයා බලන්න (වෙනස් කළ නොහැක).'] },
    { id: 'customers', icon: 'Building2', title: 'Customers', si: 'කඩ', path: 'Menu › Customers', steps: ['ඔබට පවරා ඇති කඩවල දුරකථන / ලිපින බලන්න.'] },
    { id: 'denied', icon: 'ShieldOff', title: 'If you see "not allowed"', si: 'අවසර නැති විට',
      steps: ['සමහර menu පෙනුනත් සුරැකීමේදී "Forbidden / not allowed" පෙන්වන්නේ අවසර නැති නිසායි.', 'අවශ්‍ය නම් Admin ට කියා Sales Representative role එක හෝ අදාළ අවසර ලබාගන්න.'] },
    UPDATES,
  ],
};

export const GUIDES: Record<GuideRole, Guide> = { admin, sales_rep: rep, staff };
export const roleOf = (user: { admin?: number | boolean; role_id?: string }): GuideRole =>
  user.admin ? 'admin' : user.role_id === 'sales_rep' ? 'sales_rep' : 'staff';
