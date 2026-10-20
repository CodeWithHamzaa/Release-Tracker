// Service-by-service comparison of two environments, one card per server
// role. Read-only on the Differences page; with `selection` it becomes the
// planner's build picker (one build per service).

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Server } from 'lucide-react';
import type { EnvironmentComparison, RoleComparison, ServiceComparison, ServiceSide } from '@/lib/envCompare';
import type { PlanningContext } from '../../usePlanner';
import { EvidenceBadge, INCLUSION, Pill, StatusBadge, selectClass } from '../ui';

export type Selection = Record<string, { version: string | null }>;

const env = (e: string) => e.toUpperCase();
const short = (id: string | null) => (id ? `${id.slice(0, 19)}…` : null);
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null);

const SideCell: React.FC<{ side: ServiceSide }> = ({ side }) => {
  const e = side.expected;
  const o = side.observed;
  if (!e && !o) return <span className="text-xs text-zinc-500">—</span>;
  return (
    <div className="space-y-1">
      {e && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm text-white">{e.tag ?? '?'}</span>
          <EvidenceBadge kind={e.source === 'record' ? 'expected-record' : 'expected-vault'} title={e.source === 'record' ? `Build record ${e.recordStatus ?? ''} ${date(e.at) ?? ''}` : `Vault compose v${e.vaultVersion ?? '?'}`} />
          {e.recordStatus === 'PENDING' && <Pill tone="warn" title="Deployed, awaiting confirmation">pending</Pill>}
        </div>
      )}
      {o ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {(!e || o.tag !== e.tag) && <span className="font-mono text-sm text-zinc-200">{o.tag ?? '?'}</span>}
          <EvidenceBadge kind={o.freshness === 'fresh' ? 'observed' : o.freshness} title={`${o.from} report, ${date(o.at)} · ${o.state}${o.health ? `, ${o.health}` : ''}`} />
        </div>
      ) : (
        e && <EvidenceBadge kind="unknown" />
      )}
      {side.imageId && <div className="font-mono text-[11px] text-sky-300" title={side.imageId}>{short(side.imageId)}</div>}
    </div>
  );
};

const RoleHeader: React.FC<{ role: RoleComparison; sourceEnv: string; targetEnv: string }> = ({ role, sourceEnv, targetEnv }) => {
  const t = role.targetServer;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">{role.role}</h3>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span>
          {env(targetEnv)} server: {t.ip ? <span className="font-mono text-zinc-200">{t.ip}</span> : <span className="text-amber-300">IP unknown</span>}
          {' · '}
          {t.composePath ? <span className="font-mono text-zinc-200">{t.composePath}</span> : <span className="text-amber-300">folder unknown</span>}
        </span>
        <span>
          reports: {env(sourceEnv)} {role.observedAt.source ? date(role.observedAt.source) : <span className="text-amber-300">none</span>}, {env(targetEnv)}{' '}
          {role.observedAt.target ? date(role.observedAt.target) : <span className="text-amber-300">none</span>}
        </span>
      </div>
    </div>
  );
};

const Row: React.FC<{
  row: ServiceComparison;
  context?: PlanningContext;
  selection?: Selection;
  locked?: boolean; // full sync: included automatically
  onToggle?: (key: string, on: boolean) => void;
  onVersion?: (key: string, version: string | null) => void;
  cols: number;
}> = ({ row, context, selection, locked, onToggle, onVersion, cols }) => {
  const [open, setOpen] = useState(false);
  const selectable = !!selection;
  const picked = !!selection?.[row.key] || !!locked;
  const builds = context?.services[row.key]?.builds ?? [];
  const changes = context?.services[row.key]?.changes ?? [];
  const canPick = row.status !== 'unknown' && !(row.status === 'target-only' && !builds.length);
  const details = row.reasons.length + row.source.notes.length + row.target.notes.length + row.composeDiff.length > 0;

  return (
    <>
      <tr className={`border-t border-white/10 align-top ${picked ? 'bg-emerald-500/[0.04]' : ''}`}>
        {selectable && (
          <td className="px-3 py-2.5">
            <input
              type="checkbox"
              aria-label={`Include ${row.service}`}
              checked={picked}
              disabled={!canPick || locked}
              onChange={(e) => onToggle?.(row.key, e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
          </td>
        )}
        <td className="px-3 py-2.5">
          <button type="button" onClick={() => setOpen(!open)} disabled={!details} className="flex items-center gap-1 text-left font-mono text-sm text-white disabled:cursor-default" aria-expanded={open}>
            {details ? open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" /> : <span className="w-3.5" />}
            {row.service}
          </button>
        </td>
        <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
        <td className="px-3 py-2.5"><SideCell side={row.target} /></td>
        <td className="px-3 py-2.5"><SideCell side={row.source} /></td>
        {selectable && (
          <td className="px-3 py-2.5">
            {picked && builds.length > 0 && !locked ? (
              <select
                aria-label={`Build of ${row.service}`}
                value={selection?.[row.key]?.version ?? ''}
                onChange={(e) => onVersion?.(row.key, e.target.value || null)}
                className={`${selectClass} max-w-[11rem] font-mono text-xs`}
              >
                <option value="">source build ({row.desired?.tag ?? '?'})</option>
                {builds.map((b) => (
                  <option key={b.version} value={b.version}>{b.version} · {b.environments.join('/')}</option>
                ))}
              </select>
            ) : (
              <span className="font-mono text-xs text-zinc-300">{picked ? row.desired?.tag ?? '?' : '—'}</span>
            )}
          </td>
        )}
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {changes.length === 0 && <span className="text-xs text-zinc-500">—</span>}
            {changes.map((c) => (
              <Pill key={c.key} tone={INCLUSION[c.inclusion]?.tone ?? 'muted'} title={`${c.title ?? ''} ${c.detail}`.trim()}>
                {c.key} · {INCLUSION[c.inclusion]?.label ?? c.inclusion}
              </Pill>
            ))}
          </div>
        </td>
      </tr>
      {open && details && (
        <tr className="bg-white/[0.015]">
          <td colSpan={cols} className="px-4 pb-3 pt-1 text-xs text-zinc-300">
            <ul className="list-disc space-y-1 pl-5">
              {[...row.reasons, ...row.target.notes, ...row.source.notes].map((r, i) => <li key={i}>{r}</li>)}
              {row.composeDiff.map((d) => (
                <li key={d.field}>
                  Compose <span className="font-mono">{d.field}</span>: source <span className="font-mono text-zinc-100">{d.source || '—'}</span>, target <span className="font-mono text-zinc-100">{d.target || '—'}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
};

export const ComparisonTable: React.FC<{
  comparison: EnvironmentComparison;
  context?: PlanningContext;
  selection?: Selection;
  autoKeys?: Set<string>; // full sync: rows included automatically
  onToggle?: (key: string, on: boolean) => void;
  onVersion?: (key: string, version: string | null) => void;
  hideUnchanged?: boolean;
}> = ({ comparison, context, selection, autoKeys, onToggle, onVersion, hideUnchanged }) => {
  const selectable = !!selection;
  const cols = selectable ? 7 : 5;
  return (
    <div className="space-y-4">
      {comparison.roles.map((role) => {
        const rows = role.services.filter((s) => !hideUnchanged || s.status !== 'unchanged');
        return (
          <section key={role.role} className="overflow-hidden rounded-2xl border border-white/15 bg-white/[0.02]" aria-label={role.role}>
            <RoleHeader role={role} sourceEnv={comparison.sourceEnv} targetEnv={comparison.targetEnv} />
            {role.notes.length > 0 && (
              <ul className="space-y-0.5 border-b border-white/10 bg-amber-950/10 px-4 py-2 text-xs text-amber-200">
                {role.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
            {rows.length ? (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="text-[11px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      {selectable && <th className="w-8 px-3 py-2"><span className="sr-only">Include</span></th>}
                      <th className="px-3 py-2">Service</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">{env(comparison.targetEnv)} now</th>
                      <th className="px-3 py-2">{env(comparison.sourceEnv)}</th>
                      {selectable && <th className="px-3 py-2">Deploy build</th>}
                      <th className="px-3 py-2">Features / fixes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <Row key={row.key} row={row} context={context} selection={selection} locked={autoKeys?.has(row.key) && !selection?.[row.key]} onToggle={onToggle} onVersion={onVersion} cols={cols} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-3 text-xs text-zinc-400">All services match.</p>
            )}
          </section>
        );
      })}
    </div>
  );
};
