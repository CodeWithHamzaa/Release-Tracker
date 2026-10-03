import React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { sortFindings, RiskBand, RiskReport } from '@/lib/riskEngine';
import { canProceed } from '@/lib/riskInputs';

export const BAND: Record<RiskBand, { label: string; cls: string; Icon: typeof ShieldAlert }> = {
  low: { label: 'Low risk', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', Icon: CheckCircle2 },
  medium: { label: 'Medium risk', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', Icon: AlertTriangle },
  high: { label: 'High risk', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300', Icon: ShieldAlert },
  blocked: { label: 'Blocked', cls: 'border-rose-500/50 bg-rose-500/20 text-rose-200', Icon: AlertOctagon },
};

const SEV = {
  blocker: 'border-rose-500/50 bg-rose-500/10 text-rose-200',
  high: 'border-rose-500/30 bg-rose-500/5 text-rose-300',
  medium: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
} as const;

export const RiskBadge: React.FC<{ report: RiskReport }> = ({ report }) => {
  const b = BAND[report.band];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${b.cls}`}>
      <b.Icon className="h-3.5 w-3.5" /> {b.label}
      {report.band !== 'blocked' && <span className="font-mono normal-case tracking-normal opacity-80">{report.score}/100</span>}
    </span>
  );
};

// Findings for one promotion. Blockers stop the scripts; each HIGH finding
// needs a "reviewed" tick before they can be copied or downloaded.
export const RiskPanel: React.FC<{
  report: RiskReport;
  reviewed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  title?: string;
}> = ({ report, reviewed, onToggle, title = 'Pre-flight risk check' }) => {
  const gate = canProceed(report.findings, reviewed);
  return (
    <section aria-label="Risk check" className="space-y-3 rounded-xl border border-white/15 bg-surface-base p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <RiskBadge report={report} />
        <span className="text-xs text-zinc-400">
          {report.counts.blocker} blocker · {report.counts.high} high · {report.counts.medium} medium
        </span>
      </div>
      {report.findings.length === 0 && <p className="text-xs text-emerald-300">Nothing found. The checks that could be run were clean.</p>}
      <ul className="space-y-2">
        {sortFindings(report.findings).map((f) => (
          <li key={f.id} className={`rounded-lg border p-3 text-xs ${SEV[f.severity]}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-current px-1.5 py-px text-[10px] font-bold uppercase tracking-wider">{f.severity}</span>
              <span className="font-semibold text-zinc-100">{f.title}</span>
              <span className="text-zinc-400">{f.role}</span>
              <span className="flex-1" />
              {f.severity === 'high' && (
                <label className="flex cursor-pointer items-center gap-1.5 text-zinc-200">
                  <input type="checkbox" className="accent-emerald-500" checked={reviewed.has(f.id)} onChange={() => onToggle(f.id)} aria-label={`Reviewed: ${f.title}`} />
                  Reviewed
                </label>
              )}
            </div>
            <p className="mt-1 text-zinc-300">{f.detail}</p>
          </li>
        ))}
      </ul>
      {!gate.ok && (
        <p role="status" className="text-xs font-semibold text-amber-300">
          Scripts are locked: {gate.reason}
        </p>
      )}
    </section>
  );
};
