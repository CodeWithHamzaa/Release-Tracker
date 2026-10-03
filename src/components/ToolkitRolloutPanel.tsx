import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Download, PackageCheck } from 'lucide-react';
import { buildToolkitRollout, toolkitRolloutMarkdown } from '@/lib/toolkitRollout';
import { copyText, downloadText } from '../download';
import type { ServerNode } from '../useServers';

const card = 'rounded-2xl border border-white/15 bg-white/[0.02] p-5 sm:p-6';
const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/30 hover:text-white';
const input =
  'rounded-lg border border-zinc-700/80 bg-surface-overlay px-2.5 py-1.5 text-xs text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';
const ENVS = ['SIT', 'UAT', 'Prod'] as const;

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

// Steps for rolling the toolkit itself (alara_deploy.sh) out to one environment.
export const ToolkitRolloutPanel: React.FC<{ servers: ServerNode[] }> = ({ servers }) => {
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<(typeof ENVS)[number]>('UAT');
  const [bundle, setBundle] = useState('alara-deploy-v2.6-uat.tar.gz');
  const [keyPass, setKeyPass] = useState(false);

  const rollout = useMemo(
    () => buildToolkitRollout({ environment: env, bundle: bundle.trim() || 'alara-deploy.tar.gz', keyFile: keyPass ? '~/alara_shared.key' : null, servers }),
    [env, bundle, keyPass, servers]
  );
  const markdown = useMemo(() => toolkitRolloutMarkdown(rollout), [rollout]);

  return (
    <section className={card} aria-label="Toolkit rollout">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Toolkit rollout runbook</span>
          <span className="text-xs text-zinc-400">alara_deploy.sh, per server, in order</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div role="tablist" aria-label="Rollout environment" className="flex gap-1">
              {ENVS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="tab"
                  aria-selected={env === e}
                  onClick={() => {
                    setEnv(e);
                    setBundle(`alara-deploy-v2.6-${e.toLowerCase()}.tar.gz`);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                    env === e ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100' : 'border-white/15 bg-white/[0.03] text-zinc-300 hover:border-white/30 hover:text-white'
                  }`}
                >
                  {e === 'Prod' ? 'PROD' : e}
                </button>
              ))}
            </div>
            <label className="text-xs text-zinc-300">
              Bundle file
              <input aria-label="Bundle file" value={bundle} onChange={(e) => setBundle(e.target.value)} className={`${input} ml-2 w-64 font-mono`} />
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={keyPass} onChange={(e) => setKeyPass(e.target.checked)} className="accent-emerald-500" />
              Shared-key pass (--key-file)
            </label>
            <span className="flex-1" />
            <CopyBtn text={markdown} label="Copy all" />
            <button type="button" className={btn} onClick={() => downloadText(`alara-toolkit-rollout-${env.toLowerCase()}.md`, markdown, 'text/markdown')}>
              <Download className="h-3.5 w-3.5" /> .md
            </button>
          </div>

          {rollout.warnings.map((w) => (
            <p key={w} className="rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-300">
              {w}
            </p>
          ))}

          {rollout.phases.map((phase) => (
            <div key={phase.title} className="space-y-3">
              <h3 className="text-sm font-semibold text-white">{phase.title}</h3>
              {phase.intro.map((i) => (
                <p key={i} className="text-xs text-zinc-300">{i}</p>
              ))}
              {phase.servers.map((srv, idx) => (
                <div key={srv.role} className="rounded-xl border border-white/15 bg-surface-raised p-4">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
                    {idx + 1}. {srv.role}
                  </h4>
                  <ol className="space-y-3 text-xs">
                    {srv.steps.map((step) => (
                      <li key={step.title}>
                        <div className="font-semibold text-zinc-100">{step.title}</div>
                        {step.commands.length > 0 && (
                          <div className="mt-1 flex items-start gap-2">
                            <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/50 p-2 font-mono text-[11px] text-emerald-200">{step.commands.join('\n')}</pre>
                            <CopyBtn text={step.commands.join('\n')} />
                          </div>
                        )}
                        {step.notes.map((n) => (
                          <p key={n} className="mt-1 text-zinc-300">{n}</p>
                        ))}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
