// Shared UI building blocks. Pages import these instead of keeping their own
// copies of card / button / input styles, copy buttons and status pills.

import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Copy, Info } from 'lucide-react';
import { copyText } from '../download';
import { ENVIRONMENTS, PROMOTION_PATHS } from '@/lib/environments';

// ── Style tokens ────────────────────────────────────────────────────────────

export const card = 'rounded-2xl border border-white/15 bg-white/[0.02] p-5 sm:p-6';
export const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed';
export const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed';
export const inputClass =
  'w-full px-3 py-2 bg-surface-overlay border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';
export const selectClass =
  'rounded-lg border border-zinc-700/80 bg-surface-overlay px-2.5 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30';
export const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-1.5';

// ── Small components ────────────────────────────────────────────────────────

export const CopyButton: React.FC<{ text: string; label?: string; className?: string }> = ({ text, label = 'Copy', className = btn }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
};

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';
const TONE: Record<Tone, string> = {
  ok: 'border-emerald-800 bg-emerald-950/30 text-emerald-300',
  warn: 'border-amber-700 bg-amber-950/40 text-amber-300',
  bad: 'border-rose-800 bg-rose-950/40 text-rose-300',
  info: 'border-sky-800 bg-sky-950/40 text-sky-300',
  muted: 'border-white/15 text-zinc-300',
};

export const Pill: React.FC<{ tone: Tone; children: React.ReactNode; title?: string }> = ({ tone, children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>
    {children}
  </span>
);

export function Message({ kind, children }: { kind: 'error' | 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const styles = {
    error: 'border-rose-800/70 bg-rose-950/40 text-rose-300',
    ok: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300',
    warn: 'border-amber-800/70 bg-amber-950/30 text-amber-300',
    info: 'border-sky-800/70 bg-sky-950/30 text-sky-200',
  }[kind];
  const Icon = kind === 'ok' ? CheckCircle2 : kind === 'warn' ? AlertTriangle : kind === 'info' ? Info : AlertCircle;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </div>
  );
}

export const PageHeader: React.FC<{ icon: React.ElementType; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }> = ({ icon: Icon, title, subtitle, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
        <Icon className="h-5 w-5 text-emerald-400" />
        {title}
      </h1>
      {subtitle && <p className="mt-1 text-sm text-zinc-300">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const EmptyState: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
    <p className="text-sm font-semibold text-zinc-200">{title}</p>
    {children && <div className="mt-1 text-xs text-zinc-400">{children}</div>}
  </div>
);

// Source → target picker used by the Differences page and the planner.
export const EnvironmentPairPicker: React.FC<{
  source: string;
  target: string;
  onChange: (source: string, target: string) => void;
}> = ({ source, target, onChange }) => (
  <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs text-zinc-300">
      <span className={labelClass}>From</span>
      <select aria-label="Source environment" value={source} onChange={(e) => onChange(e.target.value, target)} className={selectClass}>
        {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e.toUpperCase()}</option>)}
      </select>
    </label>
    <span className="pb-2 text-zinc-400" aria-hidden>→</span>
    <label className="text-xs text-zinc-300">
      <span className={labelClass}>To</span>
      <select aria-label="Target environment" value={target} onChange={(e) => onChange(source, e.target.value)} className={selectClass}>
        {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e.toUpperCase()}</option>)}
      </select>
    </label>
    <div className="flex gap-1 pb-0.5">
      {PROMOTION_PATHS.map(([s, t]) => (
        <button key={`${s}${t}`} type="button" className={`${btn} ${source === s && target === t ? 'border-emerald-500/60 text-emerald-200' : ''}`} onClick={() => onChange(s, t)}>
          {s.toUpperCase()} → {t.toUpperCase()}
        </button>
      ))}
    </div>
  </div>
);

// ── Status vocabulary ───────────────────────────────────────────────────────
// One meaning per word across the app: what a comparison row needs, and how
// sure the tracker is about a version.

export const SERVICE_STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  update: { label: 'Update', tone: 'info', help: 'The source runs a different build: the target needs it.' },
  unchanged: { label: 'Same', tone: 'ok', help: 'Same build on both sides.' },
  missing: { label: 'Missing on target', tone: 'warn', help: 'The target has no such service: it must be added to the compose file by hand.' },
  'target-only': { label: 'Target only', tone: 'muted', help: 'Only the target has it. Never removed automatically.' },
  conflict: { label: 'Conflict', tone: 'bad', help: 'Evidence disagrees (expected vs a recent report, or a floating tag). Resolve before planning.' },
  unknown: { label: 'Unknown', tone: 'muted', help: 'No version evidence.' },
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = SERVICE_STATUS[status] ?? { label: status, tone: 'muted' as Tone, help: '' };
  return <Pill tone={s.tone} title={s.help}>{s.label}</Pill>;
};

// Where a version comes from.
export const EvidenceBadge: React.FC<{ kind: 'expected-vault' | 'expected-record' | 'observed' | 'stale' | 'old' | 'unknown' | 'image-id'; title?: string }> = ({ kind, title }) => {
  const map: Record<string, { label: string; tone: Tone; help: string }> = {
    'expected-vault': { label: 'expected · vault', tone: 'muted', help: 'From the vault compose file.' },
    'expected-record': { label: 'expected · record', tone: 'muted', help: 'From a deployed build record newer than the vault file.' },
    observed: { label: 'observed', tone: 'ok', help: 'A health report from the last 7 days shows it running.' },
    stale: { label: 'observed · stale', tone: 'warn', help: 'Last report is more than 7 days old.' },
    old: { label: 'observed · old', tone: 'bad', help: 'Last report is more than 30 days old.' },
    unknown: { label: 'unverified', tone: 'warn', help: 'No health report shows this running.' },
    'image-id': { label: 'image ID', tone: 'info', help: 'Immutable image ID recorded by a deployment receipt.' },
  };
  const m = map[kind];
  return <Pill tone={m.tone} title={title ?? m.help}>{m.label}</Pill>;
};

export const INCLUSION: Record<string, { label: string; tone: Tone }> = {
  verified: { label: 'verified', tone: 'ok' },
  recorded: { label: 'in release note', tone: 'ok' },
  declared: { label: 'mapped, unverified', tone: 'warn' },
  inferred: { label: 'inferred, unverified', tone: 'warn' },
  'not-included': { label: 'not included', tone: 'bad' },
  unknown: { label: 'unknown', tone: 'muted' },
};
