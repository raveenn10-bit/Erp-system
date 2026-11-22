import type {Context, Next} from 'hono';
export type Env={Bindings:{DB:D1Database;FRONTEND_ORIGIN:string;SETUP_TOKEN?:string}};
export const now=()=>new Date().toISOString();
export const uuid=()=>crypto.randomUUID();
const enc=new TextEncoder();
export async function sha256(input:string){const b=await crypto.subtle.digest('SHA-256',enc.encode(input));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');}
export async function passwordHash(password:string){const salt=crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;}
function hex(bytes:Uint8Array){return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}
export async function verifyPassword(password:string,stored:string){const [alg,iteration,salt,expected]=stored.split('$');if(alg!=='pbkdf2'||!/^\d+$/.test(iteration)||!salt||!expected)return false;const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt.match(/.{2}/g)??[],s=>parseInt(s,16)),iterations:Number(iteration),hash:'SHA-256'},key,256);const got=hex(new Uint8Array(bits));let mismatch=got.length^expected.length;for(let i=0;i<Math.max(got.length,expected.length);i++)mismatch|=(got.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);return mismatch===0;}
export type Principal={id:string;name:string;role_id:string;admin:number};
export async function principal(c:Context<Env>):Promise<Principal|null>{const cookie=c.req.header('Cookie')?.match(/(?:^|;\s*)erp_session=([^;]+)/)?.[1];if(!cookie)return null;const digest=await sha256(cookie);return await c.env.DB.prepare(`SELECT u.id,u.name,u.role_id,r.admin FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).bind(digest,now()).first<Principal>();}
export async function permission(c:Context<Env>,p:Principal,cap:string){if(p.admin)return true;const row=await c.env.DB.prepare(`SELECT COALESCE((SELECT allowed FROM user_permissions WHERE user_id=? AND permission_key=?),(SELECT 1 FROM role_permissions WHERE role_id=? AND permission_key=?),0) AS allowed`).bind(p.id,cap,p.role_id,cap).first<{allowed:number}>();return row?.allowed===1;}
export async function requireUser(c:Context<Env>,next:Next){const p=await principal(c);if(!p)return c.json({error:'Please sign in'},401);c.set('principal' as never,p as never);await next();}
export function current(c:Context<Env>):Principal{return c.get('principal' as never) as Principal;}
export async function guard(c:Context<Env>,cap:string){if(!await permission(c,current(c),cap))return c.json({error:'Forbidden'},403);return null;}
export function sessionCookie(token:string,secure:boolean){return `erp_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure?'; Secure':''}`;}
export function clearCookie(secure:boolean){return `erp_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`;}
export function allowedOrigin(c:Context<Env>,origin:string){
  const sameOrigin=new URL(c.req.url).origin;
  const configured=(c.env.FRONTEND_ORIGIN||'').split(',').map(value=>value.trim()).filter(Boolean);
  return origin===sameOrigin||configured.includes(origin);
}
export function csrf(c:Context<Env>){const origin=c.req.header('Origin');return !!origin&&allowedOrigin(c,origin);}
export async function audit(db:D1Database,actor:string|null,action:string,entity:string|null,details=''){await db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)').bind(uuid(),actor,action,entity,details,now()).run();}
