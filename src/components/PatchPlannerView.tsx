// Patch Planner: pick source, target and scope, see exactly what changes,
// then read the plan as concise Deployment Steps or a full Runbook. One page,
// no approval screens: revising the scope just rebuilds the plan.
//
// The plan comes from the API (POST /api/patch-plans/preview); risk findings
// reuse the existing risk engine over the data already loaded on this page,
// as information only.

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers3, Loader2, Route, X } from 'lucide-react';
import { useComparison, previewPlan, PreviewResponse } from '../usePlanner';
import { ComparisonTable, Selection } from './planner/ComparisonTable';
import { ConfigDiffTable } from './planner/ConfigDiffTable';
import { PlanOutput } from './planner/PlanOutput';
import { RiskPanel } from './RiskPanel';
import { btn, card, EnvironmentPairPicker, inputClass, labelClass, Message, PageHeader, Pill, primaryBtn, StatusBadge, INCLUSION } from './ui';
import { evaluateRoleRisk, RiskReport } from '@/lib/riskEngine';
import { buildRoleRiskInput, ComposeLookup } from '@/lib/riskInputs';
import type { HealthReportMeta } from '@/lib/healthModel';
import type { StaleFlags } from '@/lib/currentVersions';
import type { ReleaseRecord } from '@/lib/types';
import type { ServerNode } from '../useServers';
import type { ScopeMode } from '@/lib/patchScope';

// Findings about the toolkit's own `patch` command and snapshot pairs do not
// apply to plain docker steps; everything else is shown.
const NOT_FOR_PLAIN_DOCKER = new Set(['toolkit-unknown', 'toolkit-old', 'patch-script-missing', 'no-snapshots']);

export interface PlannerPreset {
  source: string;
  target: string;
  selection?: Selection;
}

export const PatchPlannerView: React.FC<{
  preset: PlannerPreset;
  onPair: (source: string, target: string) => void;
  reports: HealthReportMeta[];
  servers: ServerNode[];
  records: ReleaseRecord[];
  composeIndex: ComposeLookup;
  staleFlags: StaleFlags[];
}> = ({ preset, onPair, reports, servers, records, composeIndex, staleFlags }) => {
  const { source, target } = preset;
  const { data, error, loading } = useComparison(source, target);
  const [mode, setMode] = useState<ScopeMode>(preset.selection ? 'builds' : 'builds');
  const [selection, setSelection] = useState<Selection>(preset.selection ?? {});
  const [changeKeys, setChangeKeys] = useState<string[]>([]);
  const [includeConfig, setIncludeConfig] = useState(true);
  const [patchId, setPatchId] = useState('');
  const [tarDir, setTarDir] = useState('');
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  // A new pair invalidates the scope and the plan.
  useEffect(() => {
    setSelection(preset.selection ?? {});
    setChangeKeys([]);
    setResult(null);
    setPlanError(null);
  }, [source, target, preset.selection]);

  const autoKeys = useMemo(() => {
    if (mode !== 'full-sync' || !data) return undefined;
    return new Set(data.comparison.roles.flatMap((r) => r.services).filter((s) => s.status === 'update' || s.status === 'missing').map((s) => s.key));
  }, [mode, data]);

  const picked = Object.keys(selection).length + (autoKeys?.size ?? 0) + changeKeys.length;

  const build = async () => {
    setBuilding(true);
    setPlanError(null);
    const out = await previewPlan({
      source,
      target,
      scope: { mode, selections: (Object.entries(selection) as [string, { version: string | null }][]).map(([key, v]) => ({ key, version: v.version })), changeKeys, includeConfig },
      ...(patchId.trim() ? { patchId: patchId.trim() } : {}),
      ...(tarDir.trim() ? { tarDir: tarDir.trim() } : {}),
    });
    setBuilding(false);
    if (out.ok === false) {
      setPlanError(out.message);
      setResult(null);
    } else setResult(out.data);
  };

  // Risk for the roles the plan touches (information only, never a gate).
  const risks = useMemo(() => {
    if (!result) return [] as { role: string; report: RiskReport }[];
    const roles: string[] = [...new Set<string>((result as PreviewResponse).plan.servers.map((s) => s.role))];
    return roles.map((role) => {
      const report = evaluateRoleRisk(buildRoleRiskInput({ role, sourceEnv: source, targetEnv: target, reports, servers, compose: composeIndex, records, stale: staleFlags }));
      const findings = report.findings.filter((f) => !NOT_FOR_PLAIN_DOCKER.has(f.id.split(':').pop()!));
      return { role, report: { ...report, findings } };
    }).filter((r) => r.report.findings.length);
  }, [result, source, target, reports, servers, composeIndex, records, staleFlags]);

  const toggle = (key: string, on: boolean) => {
    const next = { ...selection };
    if (on) next[key] = { version: null };
    else delete next[key];
    setSelection(next);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={Route}
        title="Patch Planner"
        subtitle="Choose what to promote; get target-server steps or a full runbook. The image tars are assumed to be on the target already; nothing here exports, transfers or runs anything."
      />

      {/* 1. Scope */}
      <section className={`${card} space-y-5`} aria-label="Scope">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <EnvironmentPairPicker source={source} target={target} onChange={onPair} />
          <fieldset className="flex flex-wrap gap-2">
            <legend className={labelClass}>Scope</legend>
            {([['builds', 'Specific builds', 'Only the services you tick, at the build you pick.'], ['full-sync', 'Full environment sync', 'Every service that differs, plus missing ones. Conflicts stay out until you pick them.']] as const).map(([value, label, help]) => (
              <label key={value} title={help} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${mode === value ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100' : 'border-white/15 text-zinc-300 hover:border-white/30'}`}>
                <input type="radio" name="scope-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setResult(null); }} className="sr-only" />
                {label}
              </label>
            ))}
          </fieldset>
        </div>

        {data?.warning && <Message kind="warn">{data.warning}</Message>}
        {error && <Message kind="error">{error}</Message>}
        {source === target && <Message kind="warn">Pick two different environments.</Message>}
        {loading && !data && <p className="flex items-center gap-2 text-sm text-zinc-300"><Loader2 className="h-4 w-4 animate-spin" /> Comparing {source.toUpperCase()} and {target.toUpperCase()}…</p>}

        {data && (
          <>
            {data.context.changes.length > 0 && (
              <div>
                <span className={labelClass}>Promote by feature / fix (optional)</span>
                <div className="flex flex-wrap gap-1.5">
                  {data.context.changes.map((c) => {
                    const on = changeKeys.includes(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        aria-pressed={on}
                        title={c.title ?? 'Only seen in release-record notes'}
                        onClick={() => setChangeKeys(on ? changeKeys.filter((k) => k !== c.key) : [...changeKeys, c.key])}
                        className={`rounded-lg border px-2 py-1 font-mono text-xs ${on ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-100' : 'border-white/15 text-zinc-300 hover:border-white/30'}`}
                      >
                        {c.key}{c.title ? <span className="ml-1 font-sans text-zinc-400">{c.title}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {!data.changeMapping && <p className="text-xs text-zinc-400">Change mapping is off: run prisma/manual/007_change_mapping.sql to map features and fixes to builds by hand. Keys named in release notes are still read.</p>}

            <ComparisonTable comparison={data.comparison} context={data.context} selection={selection} autoKeys={autoKeys} onToggle={toggle} onVersion={(key, version) => setSelection({ ...selection, [key]: { version } })} />

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-xs">
                <span className={labelClass}>Patch ID (optional)</span>
                <input value={patchId} onChange={(e) => setPatchId(e.target.value)} placeholder={`PATCH-${source.toUpperCase()}-${target.toUpperCase()}-<date>`} className={`${inputClass} font-mono`} />
              </label>
              <label className="text-xs">
                <span className={labelClass}>Tar folder on target (optional)</span>
                <input value={tarDir} onChange={(e) => setTarDir(e.target.value)} placeholder="<compose folder>/alara/patches/incoming/<PATCH_ID>" className={`${inputClass} font-mono`} />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-200">
                <input type="checkbox" checked={includeConfig} onChange={(e) => setIncludeConfig(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
                Include configuration changes
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={primaryBtn} onClick={build} disabled={building || source === target || (!picked && mode === 'builds')}>
                {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers3 className="h-4 w-4" />} {result ? 'Rebuild plan' : 'Build plan'}
              </button>
              {mode === 'builds' && Object.keys(selection).length > 0 && (
                <button type="button" className={btn} onClick={() => { setSelection({}); setResult(null); }}><X className="h-3.5 w-3.5" /> Clear selection</button>
              )}
              <span className="text-xs text-zinc-400">
                {mode === 'full-sync' ? `${autoKeys?.size ?? 0} service(s) differ` : `${Object.keys(selection).length} service(s) ticked`}
                {changeKeys.length ? ` · ${changeKeys.length} change(s)` : ''}
              </span>
            </div>
          </>
        )}
        {planError && <Message kind="error">{planError}</Message>}
      </section>

      {/* 2. Review */}
      {result && (
        <section className={`${card} space-y-4`} aria-label="Review">
          <h2 className="text-base font-semibold text-white">What this patch changes on {target.toUpperCase()}</h2>
          {result.scope.errors.length > 0 && <Message kind="error"><ul className="list-disc pl-4">{result.scope.errors.map((e) => <li key={e}>{e}</li>)}</ul></Message>}
          {result.scope.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-zinc-400">
                  <tr><th className="px-3 py-2">Server</th><th className="px-3 py-2">Service</th><th className="px-3 py-2">Now</th><th className="px-3 py-2">Deploy</th><th className="px-3 py-2">Why</th><th className="px-3 py-2">Notes</th></tr>
                </thead>
                <tbody>
                  {result.scope.items.map((i) => (
                    <tr key={i.key} className="border-t border-white/10 align-top">
                      <td className="px-3 py-2 text-xs text-zinc-300">{i.role}</td>
                      <td className="px-3 py-2 font-mono text-white">{i.service} <StatusBadge status={i.status} /></td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-300">{i.from?.image ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-emerald-200">{i.to.image ?? 'unknown'}{i.to.imageId && <div className="text-sky-300" title={i.to.imageId}>{i.to.imageId.slice(0, 19)}…</div>}</td>
                      <td className="px-3 py-2 text-xs text-zinc-300">
                        {i.why.join(', ')}
                        <div className="mt-1 flex flex-wrap gap-1">{i.changes.map((c) => <Pill key={c.key} tone={INCLUSION[c.inclusion]?.tone ?? 'muted'} title={c.detail}>{c.key}</Pill>)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {i.blocking.map((b) => <p key={b} className="text-rose-300">{b}</p>)}
                        {i.warnings.map((w) => <p key={w} className="text-amber-300">{w}</p>)}
                        {i.skippedBuilds.length > 0 && <p className="text-zinc-400">Not loaded (intermediate): {i.skippedBuilds.join(', ')}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-zinc-300">No image changes in this scope.</p>
          )}
          {result.scope.skipped.length > 0 && (
            <details className="text-xs text-zinc-300">
              <summary className="cursor-pointer text-zinc-200">{result.scope.skipped.length} left out</summary>
              <ul className="mt-1 list-disc pl-5">{result.scope.skipped.map((s) => <li key={s.key}><span className="font-mono">{s.key.replace('::', ' / ')}</span>: {s.reason}</li>)}</ul>
            </details>
          )}
          {result.scope.warnings.map((w) => <p key={w} className="flex items-start gap-1.5 text-xs text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{w}</p>)}
          {result.scope.configRoles.length > 0 && data && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-white">Configuration differences ({result.scope.configRoles.join(', ')})</summary>
              <div className="mt-3"><ConfigDiffTable comparison={data.comparison} roles={result.scope.configRoles} /></div>
            </details>
          )}
          {risks.map((r) => (
            <details key={r.role}>
              <summary className="cursor-pointer text-sm font-semibold text-white">Risk notes: {r.role} ({r.report.findings.length})</summary>
              <div className="mt-3"><RiskPanel report={r.report} /></div>
            </details>
          ))}
        </section>
      )}

      {/* 3. Output */}
      {result && (
        <section className={card} aria-label="Plan">
          <PlanOutput plan={result.plan} markdown={result.markdown} />
        </section>
      )}
    </div>
  );
};
