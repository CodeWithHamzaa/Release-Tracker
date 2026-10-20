// Config differences between the two environments' vault env files, per role.
// Values arrive redacted from the API (and only for admins); this view never
// sees a secret.

import React, { useState } from 'react';
import { FileCog, Lock } from 'lucide-react';
import type { EnvironmentComparison, ConfigChange } from '@/lib/envCompare';
import { EmptyState, Pill, Tone } from '../ui';

const CHANGE: Record<ConfigChange, { label: string; tone: Tone }> = {
  added: { label: 'missing on target', tone: 'warn' },
  removed: { label: 'target only', tone: 'muted' },
  changed: { label: 'differs', tone: 'info' },
  'env-specific': { label: 'env-specific', tone: 'muted' },
};
const ACTION: Record<string, { label: string; tone: Tone }> = {
  add: { label: 'add', tone: 'ok' },
  review: { label: 'decide by hand', tone: 'warn' },
  keep: { label: 'keep target', tone: 'muted' },
};

const Value: React.FC<{ v: string | null; secret: boolean }> = ({ v, secret }) =>
  secret ? (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400"><Lock className="h-3 w-3" /> hidden</span>
  ) : v === null ? (
    <span className="text-xs text-zinc-500">—</span>
  ) : (
    <span className="break-all font-mono text-xs text-zinc-100">{v}</span>
  );

export const ConfigDiffTable: React.FC<{ comparison: EnvironmentComparison; roles?: string[] }> = ({ comparison, roles }) => {
  const [showEnvSpecific, setShowEnvSpecific] = useState(false);
  const list = comparison.roles.filter((r) => !roles || roles.includes(r.role)).filter((r) => r.config.length || r.missingRequired.length);
  const S = comparison.sourceEnv.toUpperCase();
  const T = comparison.targetEnv.toUpperCase();
  if (!list.length) return <EmptyState title="No env files to compare">Upload both environments' env files to the Configuration vault.</EmptyState>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <span>
          {comparison.valuesIncluded ? 'Values are redacted where sensitive.' : 'Values are hidden: only administrators see config values.'} Keys are never deleted and files never overwritten by a plan.
        </span>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={showEnvSpecific} onChange={(e) => setShowEnvSpecific(e.target.checked)} className="accent-emerald-500" />
          Show env-specific keys
        </label>
      </div>
      {list.map((role) =>
        role.config.map((f) => {
          const keys = f.keys.filter((k) => showEnvSpecific || k.change !== 'env-specific');
          return (
            <section key={`${role.role}:${f.path}`} className="overflow-hidden rounded-xl border border-white/15" aria-label={`${role.role} ${f.path}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
                <FileCog className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-semibold text-white">{role.role}</span>
                <span className="font-mono text-xs text-zinc-300">{f.path}</span>
                {f.presence !== 'both' && <Pill tone="warn">{f.presence === 'source-only' ? `only on ${S}` : `only on ${T}`}</Pill>}
                {f.targetEncrypted && <Pill tone="info" title="The target copy holds ENC[...] values">encrypted on {T}</Pill>}
                {f.duplicates.target.length > 0 && <Pill tone="warn" title={f.duplicates.target.join(', ')}>{f.duplicates.target.length} duplicate key(s) on {T}</Pill>}
              </div>
              {keys.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="text-[11px] uppercase tracking-wider text-zinc-400">
                      <tr>
                        <th className="px-3 py-2">Key</th>
                        <th className="px-3 py-2">Difference</th>
                        <th className="px-3 py-2">{S}</th>
                        <th className="px-3 py-2">{T}</th>
                        <th className="px-3 py-2">Proposed for {T}</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k.key} className="border-t border-white/10 align-top" title={k.reason}>
                          <td className="px-3 py-2 font-mono text-zinc-100">{k.key}{k.environmentSpecific && <span className="ml-1 text-[10px] text-zinc-500">per-env</span>}</td>
                          <td className="px-3 py-2"><Pill tone={CHANGE[k.change].tone}>{CHANGE[k.change].label}</Pill></td>
                          <td className="px-3 py-2"><Value v={k.sourceValue} secret={k.secret} /></td>
                          <td className="px-3 py-2"><Value v={k.targetValue} secret={k.secret} /></td>
                          <td className="px-3 py-2"><Value v={k.proposedValue} secret={k.secret} /></td>
                          <td className="px-3 py-2">
                            <Pill tone={ACTION[k.action].tone}>{ACTION[k.action].label}</Pill>
                            <div className="mt-1 max-w-xs text-[11px] text-zinc-400">{k.reason}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-3 py-2 text-xs text-zinc-400">{f.presence === 'both' ? 'No differences to act on.' : 'Compare by hand: one side has no copy in the vault.'}</p>
              )}
            </section>
          );
        })
      )}
      {list.filter((r) => r.missingRequired.length).map((r) => (
        <p key={r.role} className="text-xs text-amber-300">{r.role}: the {T} compose file uses {r.missingRequired.map((v) => `\${${v}}`).join(', ')} with no default, and {T}'s .env does not set it.</p>
      ))}
    </div>
  );
};
