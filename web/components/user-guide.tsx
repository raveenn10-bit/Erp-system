'use client';
import { useMemo, useState } from 'react';
import {
  ArrowDownLeft, BarChart3, Bell, BookOpen, Box, Building2, Check, ChevronDown, ClipboardCheck, CloudOff, Gift,
  Info, LayoutDashboard, LogIn, PackageCheck, Printer, ReceiptText, RotateCcw, Search, Settings, ShieldCheck,
  ShieldOff, Sparkles, Sun, TriangleAlert, Truck, Users, Wallet, Warehouse, X,
} from 'lucide-react';
import { GUIDES, PERMISSIONS, roleOf, type GuideRole, type GuideSection } from '@/lib/guide';

const ICONS: Record<string, typeof Box> = {
  ArrowDownLeft, BarChart3, Bell, Box, Building2, ClipboardCheck, CloudOff, Gift, LayoutDashboard, LogIn, PackageCheck,
  Printer, ReceiptText, RotateCcw, Settings, ShieldOff, Sparkles, Sun, Truck, Users, Wallet, Warehouse,
};
const ROLE_LABEL: Record<GuideRole, string> = { admin: 'Admin', sales_rep: 'Sales Rep', staff: 'Staff' };

function Section({ s, n, open, toggle }: { s: GuideSection; n: number; open: boolean; toggle: () => void }) {
  const Icon = ICONS[s.icon] || BookOpen;
  return (
    <article className={`ug-sec ${open ? 'open' : ''}`} id={`ug-${s.id}`}>
      <button className="ug-sec-head" onClick={toggle} aria-expanded={open}>
        <span className="ug-num">{String(n).padStart(2, '0')}</span>
        <span className="ug-ic"><Icon size={18} /></span>
        <span className="ug-t"><b>{s.si}</b><small>{s.title}</small></span>
        <ChevronDown size={18} className="ug-chev" />
      </button>
      {open && (
        <div className="ug-body">
          {s.path && <p className="ug-path"><span>යන්නේ කොහෙද?</span>{s.path}</p>}
          {s.intro && <p className="ug-intro">{s.intro}</p>}
          {s.steps && <ol className="ug-steps">{s.steps.map((t, i) => <li key={i}><span>{i + 1}</span><p>{t}</p></li>)}</ol>}
          {s.example && (
            <div className="ug-ex">
              <div className="ug-ex-h">උදාහරණය · Example (පුහුණු දත්ත පමණි)</div>
              <table><tbody>{s.example.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
            </div>
          )}
          {s.tip && <p className="ug-call tip"><Info size={16} /><span>{s.tip}</span></p>}
          {s.warn && <p className="ug-call warn"><TriangleAlert size={16} /><span>{s.warn}</span></p>}
        </div>
      )}
    </article>
  );
}

/** In-app, role-based user guide (Sinhala). Admin can read every role's guide. */
export function UserGuide({ user }: { user: { admin?: number | boolean; role_id?: string } }) {
  const mine = roleOf(user);
  const [role, setRole] = useState<GuideRole>(mine);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ [GUIDES[mine].sections[0].id]: true });
  const [showPerms, setShowPerms] = useState(false);
  const g = GUIDES[role];
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return g.sections;
    return g.sections.filter(s => JSON.stringify(s).toLowerCase().includes(t));
  }, [g, q]);
  const roles: GuideRole[] = user.admin ? ['admin', 'sales_rep', 'staff'] : [mine];
  const jump = (id: string) => { setOpen(o => ({ ...o, [id]: true })); setTimeout(() => document.getElementById(`ug-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };

  return (
    <div className="ug">
      <header className="ug-hero">
        <span className="ug-badge"><BookOpen size={14} /> User Guide · පරිශීලක මාර්ගෝපදේශය</span>
        <h2>{g.si}</h2>
        <p className="ug-who">{g.title} · {g.who}</p>
        <p>{g.intro}</p>
      </header>

      {roles.length > 1 && (
        <div className="ug-roles" role="tablist" aria-label="Choose role guide">
          {roles.map(r => (
            <button key={r} role="tab" aria-selected={role === r} className={role === r ? 'on' : ''}
              onClick={() => { setRole(r); setQ(''); setOpen({ [GUIDES[r].sections[0].id]: true }); }}>
              {ROLE_LABEL[r]}{r === mine ? ' (ඔබ)' : ''}
            </button>
          ))}
        </div>
      )}

      <label className="ug-search">
        <Search size={16} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="සොයන්න… (උදා: බිල්පත, print, PIN)" aria-label="Search the guide" />
        {q && <button aria-label="Clear" onClick={() => setQ('')}><X size={14} /></button>}
      </label>

      {!q && (
        <nav className="ug-chips" aria-label="Guide topics">
          {g.sections.map(s => <button key={s.id} onClick={() => jump(s.id)}>{s.si}</button>)}
          <button className="perm" onClick={() => { setShowPerms(true); setTimeout(() => document.getElementById('ug-perms')?.scrollIntoView({ behavior: 'smooth' }), 50); }}>
            <ShieldCheck size={13} /> Permissions
          </button>
        </nav>
      )}

      <div className="ug-list">
        {list.map((s) => (
          <Section key={s.id} s={s} n={g.sections.indexOf(s) + 1} open={!!open[s.id] || !!q} toggle={() => setOpen(o => ({ ...o, [s.id]: !o[s.id] }))} />
        ))}
        {!list.length && <p className="ug-empty">“{q}” සඳහා කිසිවක් හමු නොවීය.</p>}
      </div>

      <section className="ug-perms" id="ug-perms">
        <button className="ug-sec-head" onClick={() => setShowPerms(v => !v)} aria-expanded={showPerms}>
          <span className="ug-ic"><ShieldCheck size={18} /></span>
          <span className="ug-t"><b>අවසර (Permissions)</b><small>කාටද මොනවද කළ හැක්කේ</small></span>
          <ChevronDown size={18} className="ug-chev" />
        </button>
        {showPerms && (
          <div className="ug-perm-wrap">
            <table>
              <thead><tr><th>කාර්යය</th>{(['admin', 'sales_rep', 'staff'] as GuideRole[]).map(r => <th key={r} className={r === role ? 'cur' : ''}>{r === 'sales_rep' ? 'Rep' : ROLE_LABEL[r]}</th>)}</tr></thead>
              <tbody>
                {PERMISSIONS.map(p => (
                  <tr key={p.en}>
                    <td><b>{p.si}</b><small>{p.en}</small></td>
                    {(['admin', 'sales_rep', 'staff'] as GuideRole[]).map(r => (
                      <td key={r} className={r === role ? 'cur' : ''} aria-label={p[r] ? 'allowed' : 'not allowed'}>
                        {p[r] ? <Check size={16} className="yes" /> : <X size={15} className="no" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ug-note">Role සහ අවසර වෙනස් කළ හැක්කේ Admin ට පමණි (Menu › Team). Server එකද සෑම ක්‍රියාවකදීම අවසර පරීක්ෂා කරයි.</p>
          </div>
        )}
      </section>

      <p className="ug-foot">උදාහරණවල ඇති නම්, දුරකථන අංක සහ මිල පුහුණුව සඳහා පමණි — ඇත්ත ERP එකට ඔබේ ව්‍යාපාරයේ නිවැරදි දත්ත දාන්න.</p>
    </div>
  );
}
