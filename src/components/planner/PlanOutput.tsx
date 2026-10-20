// The two outputs of one patch plan: Deployment Steps (interactive checklist)
// and the full Runbook (Markdown). Both come from the same plan returned by
// the API, so they cannot disagree. Ticks live in this page only: they are a
// working aid, not a record, and are never sent anywhere.

import React, { useMemo, useState } from 'react';
import { ClipboardList, Download, FileText, ListChecks } from 'lucide-react';
import type { PatchPlan, PlanStep } from '@/lib/patchPlan';
import { stepNumbers } from '@/lib/patchRender';
import { downloadText } from '../../download';
import { btn, CopyButton, Message, Pill } from '../ui';

const PHASE: Record<string, string> = {
  access: 'Access', precheck: 'Pre-check', backup: 'Backup', load: 'Load image', config: 'Config', compose: 'Compose', deploy: 'Deploy', verify: 'Verify', record: 'Evidence', rollback: 'Rollback',
};

const StepCard: React.FC<{ step: PlanStep; num: string; done: boolean; onDone: (v: boolean) => void }> = ({ step, num, done, onDone }) => (
  <li className={`rounded-xl border p-4 ${done ? 'border-emerald-800/60 bg-emerald-950/10' : step.phase === 'rollback' ? 'border-rose-900/50 bg-rose-950/10' : 'border-white/15 bg-white/[0.02]'}`}>
    <div className="flex items-start gap-3">
      <input type="checkbox" checked={done} onChange={(e) => onDone(e.target.checked)} aria-label={`Step ${num} done`} className="mt-1 h-4 w-4 accent-emerald-500" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">{num}.</span>
          <span className="text-sm font-semibold text-white">{step.title}</span>
          <Pill tone={step.phase === 'rollback' ? 'bad' : 'muted'}>{PHASE[step.phase] ?? step.phase}</Pill>
          {step.manual && <Pill tone="warn">manual</Pill>}
        </div>
        <div className="text-xs text-zinc-400">{step.server}</div>
        {(step.file || step.setting) && (
          <dl className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
            {step.file && (<><dt className="text-zinc-400">File</dt><dd className="break-all font-mono text-zinc-100">{step.file}</dd></>)}
            {step.setting && (<><dt className="text-zinc-400">Setting</dt><dd className="break-all font-mono text-zinc-100">{step.setting}</dd></>)}
          </dl>
        )}
        {step.commands.length > 0 && (
          <div className="relative">
            <pre className="scrollbar-subtle overflow-x-auto rounded-lg border border-white/10 bg-surface-sunken p-3 pr-20 font-mono text-xs leading-relaxed text-zinc-100">{step.commands.join('\n')}</pre>
            <div className="absolute right-2 top-2"><CopyButton text={step.commands.join('\n')} /></div>
          </div>
        )}
        <p className="text-xs text-zinc-200"><span className="font-semibold text-emerald-300">Expected:</span> <span className="whitespace-pre-wrap">{step.expected}</span></p>
        <p className="text-xs text-zinc-300"><span className="font-semibold text-rose-300">If it fails:</span> {step.onFailure}</p>
        {step.unknowns.length > 0 && <p className="text-xs text-amber-300"><span className="font-semibold">Fill in first:</span> {step.unknowns.join('; ')}</p>}
      </div>
    </div>
  </li>
);

export const PlanOutput: React.FC<{ plan: PatchPlan; markdown: { steps: string; runbook: string } }> = ({ plan, markdown }) => {
  const [mode, setMode] = useState<'steps' | 'runbook'>('steps');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const nums = useMemo(() => stepNumbers(plan), [plan]);
  const exec = plan.steps.filter((s) => s.phase !== 'rollback');
  const rollback = plan.steps.filter((s) => s.phase === 'rollback');
  const doneCount = exec.filter((s) => done[s.id]).length;
  const text = mode === 'steps' ? markdown.steps : markdown.runbook;
  const file = `${plan.patchId}_${mode === 'steps' ? 'deployment-steps' : 'runbook'}.md`;

  return (
    <section className="space-y-4" aria-label="Plan output">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Output mode" className="inline-flex rounded-xl border border-white/15 p-1">
          {([['steps', 'Deployment steps', ListChecks], ['runbook', 'Full runbook', FileText]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === value ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-300 hover:text-white'}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={text} label="Copy Markdown" />
          <button type="button" className={btn} onClick={() => downloadText(file, text, 'text/markdown')}>
            <Download className="h-3.5 w-3.5" /> Download .md
          </button>
        </div>
      </div>

      {plan.errors.length > 0 && (
        <Message kind="error">
          <p className="font-semibold">Do not use this plan yet:</p>
          <ul className="list-disc pl-4">{plan.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Message>
      )}
      {plan.unknowns.length > 0 && (
        <Message kind="warn">
          <p className="font-semibold">{plan.unknowns.length} unknown(s): supply these before running. Commands show them as &lt;PLACEHOLDERS&gt;.</p>
          <ul className="list-disc pl-4">{plan.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
        </Message>
      )}

      {mode === 'steps' ? (
        <>
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <ClipboardList className="h-4 w-4" />
            {doneCount}/{exec.length} ticked — ticks stay in this browser tab only and prove nothing. Upload a status report afterwards for evidence.
          </p>
          <ol className="space-y-3">
            {exec.map((s) => <StepCard key={s.id} step={s} num={nums.get(s.id)!} done={!!done[s.id]} onDone={(v) => setDone({ ...done, [s.id]: v })} />)}
          </ol>
          {rollback.length > 0 && (
            <>
              <h3 className="pt-2 text-sm font-semibold text-rose-300">If verification fails: rollback</h3>
              <ol className="space-y-3">
                {rollback.map((s) => <StepCard key={s.id} step={s} num={nums.get(s.id)!} done={!!done[s.id]} onDone={(v) => setDone({ ...done, [s.id]: v })} />)}
              </ol>
            </>
          )}
        </>
      ) : (
        <pre className="scrollbar-subtle max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/15 bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-zinc-100">{markdown.runbook}</pre>
      )}
    </section>
  );
};
