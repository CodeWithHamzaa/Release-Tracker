// One release event in the feed. Collapsed: purpose, build count, target
// servers, date, badges and the status toggle. Expanded: every service with
// its image tag and owner, config and notes, and the release actions
// (promote, undo, runbook). The bundle status is the bundle's own; each
// service keeps its own status, shown per row.

import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  ChevronDown,
  Loader2,
  Pencil,
  Route,
  Server,
  Sliders,
  Terminal,
  Undo2,
} from 'lucide-react';
import type { ReleaseRecord } from '@/lib/types';
import { mismatchedRecords, nextEnvironment, ReleaseBundle } from '@/lib/releaseFeed';
import { ENVIRONMENTS, sameEnvironment } from '@/lib/environments';
import { btn } from './ui';
import { ReceiptSummary } from './ReceiptSummary';

export interface ReleaseBundleCardProps {
  bundle: ReleaseBundle;
  promotedFromLabel: string | null; // e.g. 'SIT · "Chat fixes"'
  isExpanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onSetStatus: (bundle: ReleaseBundle, status: string) => void;
  onApplyStatus: (bundle: ReleaseBundle) => void;
  onPromote: (bundle: ReleaseBundle, target: string) => void;
  onUndo: (bundle: ReleaseBundle) => void;
  onRunbook: (bundle: ReleaseBundle) => void;
  onEditRecord: (record: ReleaseRecord) => void;
  onPlanRecord?: (record: ReleaseRecord) => void;
}

const TOGGLE = [
  { value: 'PENDING', label: 'Pending', on: 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40' },
  { value: 'SUCCESS', label: 'Success', on: 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40' },
  { value: 'FAILED', label: 'Fail', on: 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40' },
] as const;

const STATUS_TEXT: Record<string, string> = {
  SUCCESS: 'text-emerald-300',
  FAILED: 'text-rose-300',
  PENDING: 'text-amber-300',
  PLANNED: 'text-sky-300',
};

function envStyles(env: string): string {
  const upper = env.toUpperCase();
  if (upper.includes('PROD')) return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
  if (upper.includes('UAT')) return 'bg-purple-500/10 text-purple-300 border-purple-500/20';
  return 'bg-sky-500/10 text-sky-300 border-sky-500/20';
}

const hasText = (s?: string | null): s is string => typeof s === 'string' && s.trim().length > 0;

export const ConfigChangeBadge: React.FC = () => (
  <span
    className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-orange-400/60 bg-orange-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-orange-200 shadow-[0_0_10px_rgba(251,146,60,0.25)]"
    title="This release changes environment variables or configuration on the servers"
  >
    <AlertTriangle className="h-3.5 w-3.5" />
    Config Change Required
  </span>
);

export const ReleaseBundleCard: React.FC<ReleaseBundleCardProps> = ({
  bundle,
  promotedFromLabel,
  isExpanded,
  onToggle,
  busy,
  onSetStatus,
  onApplyStatus,
  onPromote,
  onUndo,
  onRunbook,
  onEditRecord,
  onPlanRecord,
}) => {
  const [promoteTarget, setPromoteTarget] = useState<string>(nextEnvironment(bundle.environment) ?? '');
  const when = new Date(bundle.releasedAt);
  const panelId = `bundle-panel-${bundle.key}`;
  const mismatched = mismatchedRecords(bundle);
  const isBundle = !!bundle.release;
  const targets = ENVIRONMENTS.filter((e) => !sameEnvironment(e, bundle.environment));
  const plannedRecords = bundle.recordStatuses.PLANNED ?? 0;

  return (
    <div
      id={`release-bundle-${bundle.key}`}
      className={`rounded-xl border bg-surface-raised transition-[border-color,box-shadow] duration-300 ${
        isExpanded ? 'border-emerald-400/40 shadow-lg shadow-black/50 ring-1 ring-emerald-400/20' : 'border-white/15 hover:border-white/30'
      } ${bundle.hasConfigChange ? 'border-l-4 border-l-orange-400/80' : ''}`}
    >
      {/* ── COLLAPSED ROW ── */}
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <ChevronDown className={`mt-1 h-4 w-4 flex-shrink-0 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-emerald-300' : 'text-zinc-300'}`} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold text-white">{bundle.title}</span>
              <span className={`rounded-full border px-2 py-px text-[10px] font-bold uppercase tracking-wider ${envStyles(bundle.environment)}`}>{bundle.environment}</span>
              {bundle.hasConfigChange && <ConfigChangeBadge />}
              {bundle.status === 'PLANNED' && (
                <span className="rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-sky-300" title="Logged ahead of deployment; not counted as deployed">
                  Planned
                </span>
              )}
              {promotedFromLabel && (
                <span className="inline-flex items-center gap-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[11px] text-zinc-300">
                  <ArrowUpRight className="h-3 w-3" /> from {promotedFromLabel}
                </span>
              )}
              {!isBundle && <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-zinc-400" title="Logged before release bundles existed">single record</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
              <span className="font-semibold text-zinc-100">
                {bundle.records.length} build{bundle.records.length === 1 ? '' : 's'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Server className="h-3.5 w-3.5 text-zinc-400" />
                {bundle.servers.join(', ') || '—'}
              </span>
              <span className="inline-flex items-center gap-1" title={when.toISOString()}>
                <CalendarClock className="h-3.5 w-3.5 text-zinc-400" />
                {when.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              {mismatched.length > 0 && (
                <span className="text-amber-300/90" title="Some services have a different status from the release">
                  {Object.entries(bundle.recordStatuses).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · ')}
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Status toggle: the bundle's own status (a legacy row: its record's). */}
        <div className="flex items-center gap-2 pl-7 lg:pl-0">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
          <div role="radiogroup" aria-label={`Status of ${bundle.title}`} className="inline-flex rounded-lg border border-white/15 bg-black/20 p-0.5">
            {TOGGLE.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={bundle.status === t.value}
                disabled={busy || bundle.status === t.value}
                onClick={() => onSetStatus(bundle, t.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-default ${
                  bundle.status === t.value ? t.on : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── EXPANDED ── */}
      {isExpanded && (
        <div id={panelId} className="border-t border-white/15 bg-surface-base px-4 py-4 sm:px-5 sm:py-5">
          {/* Actions */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {bundle.hasConfigChange && <ConfigChangeBadge />}
            <span className="flex-1" />
            <button type="button" className={btn} onClick={() => onRunbook(bundle)}>
              <BookOpen className="h-3.5 w-3.5" /> Runbook &amp; Ops brief
            </button>
            {isBundle && targets.length > 0 && (
              <div className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.03] p-0.5">
                <select
                  aria-label="Promotion target"
                  value={promoteTarget}
                  onChange={(e) => setPromoteTarget(e.target.value)}
                  className="rounded-md bg-transparent px-1.5 py-1 text-xs text-zinc-100 focus:outline-none"
                >
                  <option value="" disabled>Target…</option>
                  {targets.map((e) => (
                    <option key={e} value={e} className="bg-zinc-900">{e}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !promoteTarget}
                  onClick={() => onPromote(bundle, promoteTarget)}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                  title="Create (or refresh) a PLANNED copy of this release in the target environment"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" /> Promote to {promoteTarget || 'target'}
                </button>
              </div>
            )}
            {bundle.release?.canUndo && (
              <button type="button" className={btn} disabled={busy} onClick={() => onUndo(bundle)} title="Remove this planned promotion (or restore its previous state)">
                <Undo2 className="h-3.5 w-3.5" /> Undo promotion
              </button>
            )}
          </div>

          {isBundle && mismatched.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="flex-1">
                {mismatched.length} of {bundle.records.length} services have a different status from this release ({bundle.status}).
                {plannedRecords > 0 && ' PLANNED services do not count as deployed until set to Pending/Success or closed by a receipt.'}
              </span>
              <button type="button" className={btn} disabled={busy} onClick={() => onApplyStatus(bundle)}>
                Set all services to {bundle.status}
              </button>
            </div>
          )}

          {/* Services */}
          <div className="overflow-x-auto rounded-lg border border-white/15">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-zinc-300">
                <tr>
                  <th className="px-3 py-2 font-semibold">Server</th>
                  <th className="px-3 py-2 font-semibold">Service</th>
                  <th className="px-3 py-2 font-semibold">Image tag / version</th>
                  <th className="px-3 py-2 font-semibold">Owner</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {bundle.records.map((r) => {
                  const st = String(r.status).toUpperCase();
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-zinc-300">{r.server}</td>
                      <td className="px-3 py-2 font-mono text-zinc-100">{r.service}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-100">{r.version}</span>
                        {(r.isEnvUpdate || r.isConfigUpdate) && <Sliders className="ml-1.5 inline h-3.5 w-3.5 text-orange-300" aria-label="config change" />}
                        {r.hasCommands && <Terminal className="ml-1 inline h-3.5 w-3.5 text-sky-300" aria-label="commands" />}
                      </td>
                      <td className="px-3 py-2 text-zinc-200">{r.developerName || '—'}</td>
                      <td className={`px-3 py-2 text-xs font-bold ${STATUS_TEXT[st] ?? 'text-zinc-300'}`}>{st}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1.5">
                          {onPlanRecord && (
                            <button type="button" className={btn} onClick={() => onPlanRecord(r)} title="Plan promoting this build in the Patch Planner">
                              <Route className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button type="button" className={btn} onClick={() => onEditRecord(r)} title="Edit this service record">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {bundle.records.map((r) => (
            <ReceiptSummary key={`receipt-${r.id}`} recordId={r.id} open={isExpanded} />
          ))}

          {/* Config and notes */}
          <div className="mt-4 space-y-2.5">
            {hasText(bundle.configDetails) && <Block title="Configuration changes" body={bundle.configDetails} tone="text-orange-200/90" />}
            {distinctDetails(bundle.records, 'envDetails').map(([text, services]) => (
              <Block key={`env-${services}`} title={`Environment variables · ${services}`} body={text} tone="text-amber-200/90" />
            ))}
            {distinctDetails(bundle.records, 'commandDetails').map(([text, services]) => (
              <Block key={`cmd-${services}`} title={`Commands · ${services}`} body={text} tone="text-emerald-300" />
            ))}
            {hasText(bundle.note) && <Block title="Release notes" body={bundle.note} tone="text-zinc-200" />}
          </div>

          <div className="mt-4 flex justify-end border-t border-white/15 pt-3 font-mono text-[11px] text-zinc-400">
            {bundle.release ? `release #${bundle.release.id.slice(-8)} · logged by ${bundle.release.createdBy}` : `record #${bundle.records[0].id.slice(-8)} · logged by ${bundle.records[0].added_by}`}
          </div>
        </div>
      )}
    </div>
  );
};

// The batch form copies one env / command block onto every service, so show
// each distinct block once, with the services it applies to.
function distinctDetails(records: ReleaseRecord[], key: 'envDetails' | 'commandDetails'): Array<[string, string]> {
  const by = new Map<string, string[]>();
  for (const r of records) {
    const text = r[key];
    if (hasText(text)) by.set(text.trim(), [...(by.get(text.trim()) ?? []), r.service]);
  }
  return [...by.entries()].map(([text, services]) => [text, services.length === records.length && records.length > 1 ? 'all services' : services.join(', ')]);
}

const Block: React.FC<{ title: string; body: string; tone: string }> = ({ title, body, tone }) => (
  <div className="overflow-hidden rounded-lg border border-white/15">
    <div className="border-b border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">{title}</div>
    <pre className={`scrollbar-subtle overflow-x-auto whitespace-pre-wrap bg-black/60 p-3 font-mono text-[11px] leading-relaxed ${tone}`}>{body.trim()}</pre>
  </div>
);
