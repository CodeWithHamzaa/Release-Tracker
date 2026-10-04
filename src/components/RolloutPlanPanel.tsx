import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Route } from 'lucide-react';
import { compareSnapshots } from '@/lib/toolkitCompare';
import { buildPromotion } from '@/lib/promotionGenerator';
import { evaluateRollout } from '@/lib/riskEngine';
import { buildRoleRiskInput } from '@/lib/riskInputs';
import { buildRolloutPlan, rolloutPlanMarkdown, defaultPatchId, EXECUTION_ORDER, RolloutRoleInput } from '@/lib/rolloutPlan';
import type { HealthReportMeta } from '@/lib/healthModel';
import type { ReleaseRecord } from '@/lib/types';
import { copyText, downloadText } from '../download';
import type { ServerNode } from '../useServers';
import type { ComposeIndex } from '../useConfigs';
import type { StaleFlags } from '@/lib/currentVersions';
import { RiskBadge } from './RiskPanel';

const card = 'rounded-2xl border border-white/15 bg-white/[0.02] p-5 sm:p-6';
const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/30 hover:text-white';
const select =
  'mt-1 w-28 rounded-lg border border-zinc-700/80 bg-surface-overlay px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30';
const ENVS = ['SIT', 'UAT', 'Prod'];

const CopyBtn: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copy' }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={btn}
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

// All four servers of one promotion in one place: risk per role and the
// cross-server execution order for a single (bank) session. Database has no
// snapshot, so it shows up through its release records.
export const RolloutPlanPanel: React.FC<{
  reports: HealthReportMeta[];
  servers: ServerNode[];
  records: ReleaseRecord[];
  composeIndex: ComposeIndex;
  staleFlags?: StaleFlags[];
}> = ({ reports, servers, records, composeIndex, staleFlags }) => {
  const [source, setSource] = useState('SIT');
  const [target, setTarget] = useState('UAT');

  const { rows, overall, plan } = useMemo(() => {
    const inputs = EXECUTION_ORDER.map((role) =>
      buildRoleRiskInput({ role, sourceEnv: source, targetEnv: target, reports, servers, compose: composeIndex, records, stale: staleFlags })
    );
    const risk = evaluateRollout(inputs);
    const roles: RolloutRoleInput[] = inputs.map((input) => {
      const patchId = defaultPatchId(input.role, source, target);
      const promo = input.compare
        ? buildPromotion({
            compare: input.compare,
            role: input.role,
            patchId,
            sourceServer: null,
            targetServer: servers.find((s) => s.role === input.role && s.environment.toUpperCase() === target.toUpperCase()) ?? null,
          })
        : null;
      const target_ = servers.find((s) => s.role === input.role && s.environment.toUpperCase() === target.toUpperCase());
      return {
        role: input.role,
        patchId,
        images: promo ? promo.images.filter((i) => !i.manual).length : 0,
        manualImages: promo ? promo.images.filter((i) => i.manual).length : 0,
        envAdds: promo ? promo.envAdds.filter((e) => e.status === 'append').length : 0,
        manualItems: promo ? promo.manual.length + promo.envAdds.filter((e) => e.status !== 'append').length : input.pendingRecords.length,
        risk: risk.roles[input.role],
        composePath: target_?.composePath ?? null,
        runAs: target_?.runAs ?? null,
      };
    });
    return { rows: roles, overall: risk.overall, plan: buildRolloutPlan({ sourceEnv: source, targetEnv: target, roles, overall: risk.overall }) };
  }, [reports, servers, records, composeIndex, staleFlags, source, target]);

  const markdown = useMemo(() => rolloutPlanMarkdown(plan), [plan]);

  return (
    <section className={`${card} space-y-4`} aria-label="Promotion plan">
      <div className="flex items-center gap-2">
        <Route className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Promotion plan: all servers</h2>
        <span className="text-xs text-zinc-400">risk per role and one execution order, from the latest reports</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-300">
          From
          <select aria-label="Plan source" value={source} onChange={(e) => setSource(e.target.value)} className={select}>
            {ENVS.map((e) => <option key={e} value={e}>{e.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-300">
          To
          <select aria-label="Plan target" value={target} onChange={(e) => setTarget(e.target.value)} className={select}>
            {ENVS.map((e) => <option key={e} value={e}>{e.toUpperCase()}</option>)}
          </select>
        </label>
        <RiskBadge report={overall} />
        <span className="flex-1" />
        <CopyBtn text={markdown} label="Copy plan" />
        <button type="button" className={btn} onClick={() => downloadText(`promotion-plan_${source}-${target}.md`, markdown, 'text/markdown')}>
          <Download className="h-3.5 w-3.5" /> .md
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/15">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-white/[0.03] text-zinc-300">
            <tr>
              {['Order', 'Server', 'Images', 'Env keys', 'By hand', 'Risk'].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((r, i) => (
              <tr key={r.role}>
                <td className="px-3 py-2 font-mono text-zinc-300">{i + 1}</td>
                <td className="px-3 py-2 font-semibold text-zinc-100">{r.role}</td>
                <td className="px-3 py-2 font-mono text-zinc-200">{r.images}</td>
                <td className="px-3 py-2 font-mono text-zinc-200">{r.envAdds}</td>
                <td className="px-3 py-2 font-mono text-zinc-200">{r.manualImages + r.manualItems}</td>
                <td className="px-3 py-2">
                  <RiskBadge report={r.risk} />
                  <span className="ml-2 text-zinc-400">{r.risk.findings.length} finding(s)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.warnings.map((w) => (
        <p key={w} className="rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-300">{w}</p>
      ))}

      {plan.sessions.map((s) => (
        <div key={s.title} className="space-y-2">
          <h3 className="text-sm font-semibold text-white">{s.title}</h3>
          {s.intro.map((i) => <p key={i} className="text-xs text-zinc-300">{i}</p>)}
          <ol className="space-y-2">
            {s.steps.map((step) => (
              <li key={step.title} className="rounded-xl border border-white/15 bg-surface-raised p-3 text-xs">
                <div className="font-semibold text-zinc-100">{step.title}</div>
                {step.commands.length > 0 && (
                  <div className="mt-1 flex items-start gap-2">
                    <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/50 p-2 font-mono text-[11px] text-emerald-200">{step.commands.join('\n')}</pre>
                    <CopyBtn text={step.commands.join('\n')} />
                  </div>
                )}
                {step.notes.map((n) => <p key={n} className="mt-1 text-zinc-300">{n}</p>)}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {plan.skipped.length > 0 && <p className="text-xs text-zinc-400">Skipped (nothing to change): {plan.skipped.join(', ')}</p>}
    </section>
  );
};
