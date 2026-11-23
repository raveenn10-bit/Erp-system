'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowRight, ShieldCheck, ChartNoAxesCombined, KeyRound, Sparkles, Delete, Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

export default function Login() {
  const [mode, setMode] = useState<'password' | 'passcode'>('passcode');
  const [username, setUsername] = useState('Admin');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const reduced = useReducedMotion();
  const pinInputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please enter your username or email.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Invalid username or password.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPasscode(pinStr?: string) {
    const code = pinStr || passcode.join('');
    if (code.length !== 4) {
      setError('Please enter a 4-digit passcode.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim() || undefined,
          passcode: code,
        }),
      });
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Invalid passcode.');
      setPasscode(['', '', '', '']);
      pinInputRefs[0].current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function handlePinChange(index: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const nextPin = [...passcode];
    nextPin[index] = digit;
    setPasscode(nextPin);
    setError('');

    if (digit && index < 3) {
      pinInputRefs[index + 1].current?.focus();
    }

    if (nextPin.every((d) => d !== '')) {
      submitPasscode(nextPin.join(''));
    }
  }

  function handlePinKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !passcode[index] && index > 0) {
      pinInputRefs[index - 1].current?.focus();
    }
  }

  function handleKeypadPress(num: string) {
    const emptyIndex = passcode.findIndex((d) => d === '');
    if (emptyIndex !== -1) {
      handlePinChange(emptyIndex, num);
    }
  }

  function handleKeypadDelete() {
    const lastFilled = [...passcode].reverse().findIndex((d) => d !== '');
    if (lastFilled !== -1) {
      const idx = 3 - lastFilled;
      const nextPin = [...passcode];
      nextPin[idx] = '';
      setPasscode(nextPin);
      pinInputRefs[idx].current?.focus();
    }
  }

  function handleQuickAdminFill() {
    setUsername('Admin');
    if (mode === 'password') {
      setPassword('Admin2026');
    } else {
      setPasscode(['2', '0', '2', '6']);
      submitPasscode('2026');
    }
  }

  useEffect(() => {
    if (mode === 'passcode') {
      pinInputRefs[0].current?.focus();
    }
  }, [mode]);

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="login-logo">
          <img src="/nugathalawa-logo.jpg" alt="Nugathalawa Ceylon Tea" />
        </div>
        <div className="login-copy">
          <span className="eyebrow light">NUGATHALAWA CEYLON TEA · DISTRIBUTION ERP</span>
          <h1>
            Every sale.
            <br />
            Every shop.
            <br />
            <em>In clear view.</em>
          </h1>
          <p>
            Reliable operations and distribution management, from warehouse stock to delivery and payments.
          </p>
          <p className="si" lang="si" style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
            තොග, බිල්පත් සහ ගෙවීම් — එකම තැනකින්.
          </p>
        </div>
        <div className="login-features">
          <span>
            <ShieldCheck size={18} /> Secure access
          </span>
          <span>
            <ChartNoAxesCombined size={18} /> Live business insights
          </span>
        </div>
      </section>

      <section className="login-form-wrap">
        <motion.div
          className="login-card"
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 0.8, 0.24, 1] }}
        >
          <div className="login-card-brand">
            <img src="/nugathalawa-logo.jpg" alt="" />
            <div>
              <span className="eyebrow" style={{ fontSize: 11 }}>
                SANJEEWA DISTRIBUTION ERP
              </span>
              <b>Nugathalawa Ceylon Tea Export</b>
            </div>
          </div>

          <h2>Sign in to your workspace</h2>
          <p>
            Enter your credentials or use quick passcode.
            <span className="si" lang="si" style={{ display: 'block', fontSize: 13, marginTop: 4 }}>
              මුරපදය හෝ අංක 4 කේතය (PIN) මඟින් පිවිසෙන්න.
            </span>
          </p>

          {/* Mode Switch Tabs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              background: 'var(--brand-background, #F3FAF6)',
              padding: 4,
              borderRadius: 12,
              marginBottom: 20,
              border: '1px solid var(--brand-border, #DDEBE5)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMode('passcode');
                setError('');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 14px',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 700,
                border: 'none',
                background: mode === 'passcode' ? 'var(--brand-primary, #0C5051)' : 'transparent',
                color: mode === 'passcode' ? '#FFFFFF' : 'var(--brand-text-muted, #647773)',
                transition: 'all 0.2s',
              }}
            >
              <Sparkles size={15} color={mode === 'passcode' ? 'var(--brand-accent, #92FD6F)' : 'currentColor'} />
              <span>4-Digit PIN (ඉක්මන්)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('password');
                setError('');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 14px',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 700,
                border: 'none',
                background: mode === 'password' ? 'var(--brand-primary, #0C5051)' : 'transparent',
                color: mode === 'password' ? '#FFFFFF' : 'var(--brand-text-muted, #647773)',
                transition: 'all 0.2s',
              }}
            >
              <KeyRound size={15} color={mode === 'password' ? 'var(--brand-accent, #92FD6F)' : 'currentColor'} />
              <span>Password (මුරපදය)</span>
            </button>
          </div>

          {/* Quick Admin Helper Chip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(12, 80, 81, 0.05)',
              border: '1px dashed var(--brand-border, #DDEBE5)',
              borderRadius: 10,
              padding: '8px 12px',
              marginBottom: 18,
              fontSize: 12,
            }}
          >
            <div style={{ color: 'var(--brand-text, #142C2A)' }}>
              <strong>Admin:</strong> Username <code>Admin</code> | PIN <code>2026</code>
            </div>
            <button
              type="button"
              onClick={handleQuickAdminFill}
              style={{
                background: 'var(--brand-accent, #92FD6F)',
                color: 'var(--brand-text, #142C2A)',
                border: 'none',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Autofill Admin
            </button>
          </div>

          {mode === 'passcode' ? (
            /* 4-Digit Passcode Mode */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-text-muted, #647773)', marginBottom: 6, display: 'block' }}>
                  Username / පරිශීලක නාමය
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Admin, or your username"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--brand-border, #DDEBE5)',
                    background: '#FFFFFF',
                    fontSize: 14,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-text, #142C2A)', marginBottom: 8, display: 'block', textAlign: 'center' }}>
                  Enter 4-Digit PIN (අංක 4 රහස් අංකය)
                </label>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, margin: '8px 0 16px' }}>
                  {passcode.map((digit, i) => (
                    <input
                      key={i}
                      ref={pinInputRefs[i]}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handlePinChange(i, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(i, e)}
                      style={{
                        width: 54,
                        height: 58,
                        textAlign: 'center',
                        fontSize: 24,
                        fontWeight: 800,
                        borderRadius: 12,
                        border: digit
                          ? '2px solid var(--brand-primary, #0C5051)'
                          : '1.5px solid var(--brand-border, #DDEBE5)',
                        background: digit ? 'rgba(146, 253, 111, 0.12)' : '#FFFFFF',
                        color: 'var(--brand-primary, #0C5051)',
                        outline: 'none',
                        boxShadow: digit ? '0 0 0 2px rgba(12, 80, 81, 0.1)' : 'none',
                        transition: 'all 0.15s',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Mobile / Field Numeric Keypad */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  maxWidth: 280,
                  margin: '0 auto',
                  width: '100%',
                }}
              >
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => handleKeypadPress(n)}
                    style={{
                      height: 48,
                      borderRadius: 10,
                      border: '1px solid var(--brand-border, #DDEBE5)',
                      background: '#FFFFFF',
                      fontSize: 18,
                      fontWeight: 700,
                      color: 'var(--brand-text, #142C2A)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setPasscode(['', '', '', '']);
                    pinInputRefs[0].current?.focus();
                  }}
                  style={{
                    height: 48,
                    borderRadius: 10,
                    border: '1px solid var(--brand-border, #DDEBE5)',
                    background: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--brand-text-muted, #647773)',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handleKeypadPress('0')}
                  style={{
                    height: 48,
                    borderRadius: 10,
                    border: '1px solid var(--brand-border, #DDEBE5)',
                    background: '#FFFFFF',
                    fontSize: 18,
                    fontWeight: 700,
                    color: 'var(--brand-text, #142C2A)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleKeypadDelete}
                  style={{
                    height: 48,
                    borderRadius: 10,
                    border: '1px solid var(--brand-border, #DDEBE5)',
                    background: '#FFFFFF',
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--brand-text-muted, #647773)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Delete size={18} />
                </button>
              </div>

              {error && (
                <div className="error" role="alert" style={{ textAlign: 'center', marginTop: 8 }}>
                  {error}
                </div>
              )}

              <button
                type="button"
                className="primary wide"
                disabled={busy || passcode.some((d) => !d)}
                onClick={() => submitPasscode()}
                style={{
                  background: 'var(--brand-primary, #0C5051)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  marginTop: 8,
                }}
              >
                {busy ? 'Signing in…' : 'Sign in with PIN'} <ArrowRight size={18} />
              </button>
            </div>
          ) : (
            /* Username & Password Mode */
            <form onSubmit={submitPassword}>
              <label>
                Username or Email / පරිශීලක නාමය
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. Admin or user@business.com"
                  required
                />
              </label>
              <label style={{ marginTop: 14 }}>
                Password / මුරපදය
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="e.g. Admin2026"
                  required
                />
              </label>

              {error && (
                <div className="error" role="alert" style={{ marginTop: 12 }}>
                  {error}
                </div>
              )}

              <button
                className="primary wide"
                disabled={busy}
                style={{
                  background: 'var(--brand-primary, #0C5051)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  marginTop: 18,
                }}
              >
                {busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} />
              </button>
            </form>
          )}

          <small style={{ marginTop: 24 }}>Developed by Harsh Apex Digital Solutions</small>
        </motion.div>
      </section>
    </main>
  );
}
