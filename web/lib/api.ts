// Production serves the static Next.js export and API from the same Worker.
// NEXT_PUBLIC_API_URL remains available for an explicitly separate API origin.
export const apiBase=process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/,'')||'';
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{const response=await fetch(`${apiBase}/api${path}`,{...init,credentials:'include',headers:{'Content-Type':'application/json',...init.headers},cache:'no-store'});const data=await response.json().catch(()=>({error:'Unexpected response'}));if(!response.ok)throw new Error(data.error||'Request failed');return data as T;}
export const money=(cents:number)=>new Intl.NumberFormat('en-LK',{style:'currency',currency:'LKR',maximumFractionDigits:2}).format(cents/100);
export const idempotency=()=>crypto.randomUUID()+crypto.randomUUID();

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
