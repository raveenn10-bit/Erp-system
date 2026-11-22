export const apiBase=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8787';
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{const response=await fetch(`${apiBase}/api${path}`,{...init,credentials:'include',headers:{'Content-Type':'application/json',...init.headers},cache:'no-store'});const data=await response.json().catch(()=>({error:'Unexpected response'}));if(!response.ok)throw new Error(data.error||'Request failed');return data as T;}
export const money=(cents:number)=>new Intl.NumberFormat('en-LK',{style:'currency',currency:'LKR',maximumFractionDigits:2}).format(cents/100);
export const idempotency=()=>crypto.randomUUID()+crypto.randomUUID();
