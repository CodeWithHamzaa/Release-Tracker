import React, { useState } from 'react';
import { Layers, LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';

// Email + password sign-in. There is deliberately no sign-up: users are
// created in Supabase (Authentication -> Users -> Add user).
export const LoginView: React.FC<{ notice?: string | null }> = ({ notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setIsLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setIsLoading(false);
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Wrong email or password.'
          : signInError.message
      );
    }
    // On success App's onAuthStateChange listener swaps this view out.
  };

  const inputClass =
    'w-full px-3 py-2 bg-[#1f1f23] border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex items-center justify-center px-4 font-sans">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8 space-y-5"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-emerald-400">
            <Layers className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white">Release Tracker</h1>
            <p className="text-xs text-zinc-500">Sign in to continue</p>
          </div>
        </div>

        {(error || notice) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-800/70 bg-rose-950/40 p-3 text-xs text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-400" />
            <span>{error || notice}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="login-email" className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="login-password" className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          Sign in
        </button>
      </form>
    </div>
  );
};
