export function asCents(value:number){if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid cents');return value;}
export function lineTotal(cents:number,quantity:number){asCents(cents);if(!Number.isSafeInteger(quantity)||quantity<=0)throw new Error('Invalid quantity');const total=cents*quantity;if(!Number.isSafeInteger(total))throw new Error('Amount too large');return total;}
export function sumLines(lines:{unitPriceCents:number;quantity:number}[]){return lines.reduce((sum,line)=>{const next=sum+lineTotal(line.unitPriceCents,line.quantity);if(!Number.isSafeInteger(next))throw new Error('Amount too large');return next;},0);}
export function dueDate(date:string,days:number){if(!Number.isInteger(days)||days<0||days>45)throw new Error('Credit days must be between 0 and 45');const iso=date.slice(0,10);const d=new Date(`${iso}T00:00:00Z`);if(Number.isNaN(d.getTime()))throw new Error('Invalid date');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function reminderDate(due:string){const d=new Date(`${due}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-14);return d.toISOString().slice(0,10);}

export type Discount={type:'fixed'|'percent';value:number};

export function discountAmount(baseCents:number,discount?:Discount){
  asCents(baseCents);
  if(!discount)return 0;
  asCents(discount.value);
  const amount=discount.type==='percent'
    ? Math.round(baseCents*Math.min(discount.value,10000)/10000)
    : discount.value;
  if(amount>baseCents)throw new Error('Discount exceeds amount');
  return amount;
}

export function invoiceTotals(lines:{unitPriceCents:number;quantity:number;discount?:Discount}[],invoiceDiscount?:Discount){
  const subtotal=sumLines(lines);
  const itemDiscountCents=lines.reduce((sum,line)=>sum+discountAmount(lineTotal(line.unitPriceCents,line.quantity),line.discount),0);
  const afterItems=subtotal-itemDiscountCents;
  const invoiceDiscountCents=discountAmount(afterItems,invoiceDiscount);
  return {subtotalCents:subtotal,itemDiscountCents,invoiceDiscountCents,totalDiscountCents:itemDiscountCents+invoiceDiscountCents,totalCents:afterItems-invoiceDiscountCents};
}

export function normalizeWhatsApp(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) {
    return "94" + digits.slice(1);
  }
  if (digits.length === 9 && digits.startsWith("7")) {
    return "94" + digits;
  }
  if (digits.startsWith("94") && digits.length === 11) {
    return digits;
  }
  return digits;
}

export function formatWhatsApp(phone: string): string {
  const norm = normalizeWhatsApp(phone);
  if (norm.startsWith("94") && norm.length === 11) {
    return `+94 ${norm.slice(2, 4)} ${norm.slice(4, 7)} ${norm.slice(7)}`;
  }
  return phone;
}
