import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Terminal } from 'lucide-react';
import type { PromotionPlan } from '@/lib/promotionGenerator';
import { copyText, downloadText } from '../download';

const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed';

const ScriptBlock: React.FC<{ title: string; subtitle: string; script: string | null; fileName: string; missing: string }> = ({
  title,
  subtitle,
  script,
  fileName,
  missing,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d0f]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-[11px] text-zinc-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={btn}
            disabled={!script}
            onClick={async () => {
              if (script && (await copyText(script))) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
          <button type="button" className={btn} disabled={!script} onClick={() => script && downloadText(fileName, script, 'text/x-shellscript')}>
            <Download className="h-3.5 w-3.5" /> .sh
          </button>
        </div>
      </div>
      {script ? (
        <pre className="max-h-[45vh] overflow-auto p-4 font-mono text-[11px] leading-5 text-emerald-100/90">{script}</pre>
      ) : (
        <p className="p-4 text-xs text-amber-300">{missing}</p>
      )}
    </section>
  );
};

// Two copy-paste scripts for promoting a release between environments:
// Part 1 exports images on the source, Part 2 applies env keys and images
// (via ./alara_server.sh patch) on the target.
export const PromotionRunbook: React.FC<{ sourceEnv: string; targetEnv: string; plan: PromotionPlan }> = ({ sourceEnv, targetEnv, plan }) => {
  const appends = plan.envAdds.filter((e) => e.status === 'append');
  const patchable = plan.images.filter((i) => !i.manual);
  const manualCount = plan.manual.length + plan.images.filter((i) => i.manual).length + plan.envAdds.filter((e) => e.status !== 'append').length;
  const base = `${plan.patchId}_${sourceEnv}-${targetEnv}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 px-3 py-2">
          <div className="text-zinc-500">Images via alara patch</div>
          <div className="font-mono text-base font-semibold text-white">{patchable.length}</div>
        </div>
        <div className="rounded-lg border border-white/10 px-3 py-2">
          <div className="text-zinc-500">Env keys appended</div>
          <div className="font-mono text-base font-semibold text-white">{appends.length}</div>
        </div>
        <div className="rounded-lg border border-white/10 px-3 py-2">
          <div className="text-zinc-500">Left for manual review</div>
          <div className={`font-mono text-base font-semibold ${manualCount ? 'text-amber-300' : 'text-white'}`}>{manualCount}</div>
        </div>
      </div>

      {plan.errors.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-300">
          {plan.errors.map((e) => (
            <p key={e} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {e}
            </p>
          ))}
        </div>
      )}

      <p className="text-[11px] text-zinc-500">
        Order: run Part 1 on {sourceEnv}, copy <span className="font-mono">alara/patches/export/{plan.patchId}/</span> to{' '}
        <span className="font-mono">alara/patches/incoming/{plan.patchId}/</span> on {targetEnv} (WinSCP), then run Part 2 there. Both scripts
        refuse to run on any other server. Secrets, changed values and new services are listed for you to handle by hand.
      </p>

      <ScriptBlock
        title={`Part 1: Source export (${sourceEnv})`}
        subtitle={patchable.length || plan.images.length ? `docker save ${plan.images.length} image(s) + SHA256SUMS` : 'No image changes: nothing to export'}
        script={plan.sourceScript}
        fileName={`${base}_part1_source_export.sh`}
        missing="Not generated: see the message above."
      />
      <ScriptBlock
        title={`Part 2: Target import (${targetEnv})`}
        subtitle={`${appends.length} env key(s), ${patchable.length} image(s) via patch${patchable.length ? '' : appends.length ? ', then restart' : ''}`}
        script={plan.targetScript}
        fileName={`${base}_part2_target_import.sh`}
        missing="Not generated: see the message above."
      />
    </div>
  );
};
