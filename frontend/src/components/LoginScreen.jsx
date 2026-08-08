import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';

export function LoginScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleEmailAuth(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'signup') {
        if (password !== confirmPassword) {
          setError(t('auth.password_mismatch'));
          setLoading(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation required — move to the code-entry step
          setMode('verify');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw error;
      // Success: App.jsx's onAuthStateChange listener picks up the new session automatically, no extra action needed here.
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({ provider: 'google' });
  }

  if (mode === 'verify') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-app)]">
        <div className="w-full max-w-sm bg-[var(--bg-card)] rounded-lg shadow-[var(--shadow-card)] p-6">
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-2 text-center">
            {t('auth.verify_title')}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mb-4 text-center">
            {t('auth.check_email', { email })}
          </p>
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('auth.enter_code')}
              required
              className="w-full px-3 py-2 rounded-md border border-[var(--border-subtle)] text-sm text-center tracking-widest"
            />
            {error && <p className="text-sm text-[var(--danger-strong)]">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 rounded-md bg-[var(--brand-primary)] text-white font-medium disabled:opacity-50"
            >
              {loading ? t('auth.loading') : t('auth.verify')}
            </button>
          </form>
          <button
            onClick={() => { setMode('login'); setError(''); }}
            className="w-full text-sm text-[var(--text-secondary)] mt-3"
          >
            {t('auth.back_to_login')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-app)]">
      <div className="w-full max-w-sm bg-[var(--bg-card)] rounded-lg shadow-[var(--shadow-card)] p-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
          {mode === 'signup' ? t('auth.sign_up') : t('auth.log_in')}
        </h1>

        <form onSubmit={handleEmailAuth} className="space-y-3">
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.email')}
            required
            className="w-full px-3 py-2 rounded-md border border-[var(--border-subtle)] text-sm"
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.password')}
              required
              minLength={6}
              className="w-full px-3 py-2 pr-10 rounded-md border border-[var(--border-subtle)] text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              aria-label={showPassword ? t('auth.hide_password') : t('auth.show_password')}
            >
              {showPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>

          {mode === 'signup' && (
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('auth.confirm_password')}
                required
                minLength={6}
                className="w-full px-3 py-2 rounded-md border border-[var(--border-subtle)] text-sm"
              />
            </div>
          )}
          {error && <p className="text-sm text-[var(--danger-strong)]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 rounded-md bg-[var(--brand-primary)] text-white font-medium disabled:opacity-50"
          >
            {loading ? t('auth.loading') : (mode === 'signup' ? t('auth.sign_up') : t('auth.log_in'))}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); setConfirmPassword(''); setShowPassword(false); }}
          className="w-full text-sm text-[var(--text-secondary)] mt-3"
        >
          {mode === 'signup' ? t('auth.have_account') : t('auth.no_account')}
        </button>

        <div className="flex items-center gap-2 my-4">
          <div className="flex-1 h-px bg-[var(--border-subtle)]" />
          <span className="text-xs text-[var(--text-muted)]">{t('auth.or')}</span>
          <div className="flex-1 h-px bg-[var(--border-subtle)]" />
        </div>

        <button
          onClick={handleGoogleLogin}
          className="w-full px-4 py-2 rounded-md border border-[var(--border-subtle)] text-sm font-medium flex items-center justify-center gap-2"
        >
          {t('auth.google_signin')}
        </button>
      </div>
    </div>
  );
}

function EyeIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 8 11 8a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 8 11 8a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M2 2l20 20" />
    </svg>
  );
}
