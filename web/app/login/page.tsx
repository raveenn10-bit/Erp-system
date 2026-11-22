'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api} from '@/lib/api';
import {ArrowRight,ShieldCheck,ChartNoAxesCombined} from 'lucide-react';

export default function Login(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const router=useRouter();

  async function submit(e:React.FormEvent){
    e.preventDefault();
    setBusy(true);
    setError('');
    try{
      await api('/login',{method:'POST',body:JSON.stringify({email,password})});
      router.push('/dashboard');
    }catch(e){
      setError((e as Error).message);
    }finally{
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand" style={{backgroundImage: 'linear-gradient(rgba(14, 50, 35, 0.82), rgba(14, 50, 35, 0.90)), url(/nugathalawa-banner.jpg)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="brand-mark" style={{padding: 0, overflow: 'hidden', width: 64, height: 64, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <img src="/nugathalawa-logo.jpg" alt="Nugathalawa Ceylon Tea" style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </div>
        <div className="login-copy">
          <span className="eyebrow light">NUGATHALAWA CEYLON TEA · DISTRIBUTION ERP</span>
          <h1>Every sale.<br/>Every shop.<br/><em>In clear view.</em></h1>
          <p>Reliable operations and distribution management, from warehouse stock to delivery and payments.</p>
        </div>
        <div className="login-features">
          <span><ShieldCheck size={19}/> Secure access</span>
          <span><ChartNoAxesCombined size={19}/> Live business insights</span>
        </div>
      </section>
      <section className="login-form-wrap">
        <div className="login-card">
          <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16}}>
            <img src="/nugathalawa-logo.jpg" alt="Logo" style={{width: 44, height: 44, borderRadius: '50%', objectFit: 'cover'}} />
            <div>
              <span className="eyebrow" style={{marginBottom: 0, fontSize: 11}}>SANJEEWA DISTRIBUTION ERP</span>
              <div style={{fontSize: 13, fontWeight: 700, color: '#0e927d'}}>Nugathalawa Ceylon Tea Export</div>
            </div>
          </div>
          <h2>Sign in to your workspace</h2>
          <p>Enter your account credentials to continue.</p>
          <form onSubmit={submit}>
            <label>Email address
              <input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@business.com" required/>
            </label>
            <label>Password
              <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password" required/>
            </label>
            {error&&<div className="error" role="alert">{error}</div>}
            <button className="primary wide" disabled={busy}>{busy?'Signing in…':'Sign in'} <ArrowRight size={18}/></button>
          </form>
          <small>Developed by Harsh Apex Digital Solutions</small>
        </div>
      </section>
    </main>
  );
}
