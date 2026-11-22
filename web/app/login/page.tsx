'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api} from '@/lib/api';
import {ArrowRight,ShieldCheck,ChartNoAxesCombined} from 'lucide-react';
import {motion,useReducedMotion} from 'motion/react';

export default function Login(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const router=useRouter();
  const reduced=useReducedMotion();

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
      <section className="login-brand">
        <div className="login-logo">
          <img src="/nugathalawa-logo.jpg" alt="Nugathalawa Ceylon Tea" />
        </div>
        <div className="login-copy">
          <span className="eyebrow light">NUGATHALAWA CEYLON TEA · DISTRIBUTION ERP</span>
          <h1>Every sale.<br/>Every shop.<br/><em>In clear view.</em></h1>
          <p>Reliable operations and distribution management, from warehouse stock to delivery and payments.</p>
          <p className="si" lang="si" style={{marginTop: 10, fontSize: 14, opacity: .9}}>තොග, බිල්පත් සහ ගෙවීම් — එකම තැනකින්.</p>
        </div>
        <div className="login-features">
          <span><ShieldCheck size={18}/> Secure access</span>
          <span><ChartNoAxesCombined size={18}/> Live business insights</span>
        </div>
      </section>
      <section className="login-form-wrap">
        <motion.div
          className="login-card"
          initial={reduced ? false : {opacity: 0, y: 16}}
          animate={{opacity: 1, y: 0}}
          transition={{duration: .35, ease: [0.22, 0.8, 0.24, 1]}}
        >
          <div className="login-card-brand">
            <img src="/nugathalawa-logo.jpg" alt="" />
            <div>
              <span className="eyebrow" style={{fontSize: 11}}>SANJEEWA DISTRIBUTION ERP</span>
              <b>Nugathalawa Ceylon Tea Export</b>
            </div>
          </div>
          <h2>Sign in to your workspace</h2>
          <p>Enter your account credentials to continue. <span className="si" lang="si">ඔබගේ ගිණුමට පිවිසෙන්න.</span></p>
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
        </motion.div>
      </section>
    </main>
  );
}
