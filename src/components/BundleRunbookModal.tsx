// Runbook for one release bundle (lib/bundleRunbook.ts): Standard or Detailed
// mode, plus the Bank IT / Ops brief. Text only; copy or download it.

import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, FileText, ShieldCheck, X } from 'lucide-react';
import { renderOpsBrief, renderRunbook, RunbookMode, RunbookService } from '@/lib/bundleRunbook';
import type { ReleaseBundle } from '@/lib/releaseFeed';
import { ENVIRONMENTS, sameEnvironment } from '@/lib/environments';
import { imageRepo } from '@/lib/configDrift';
import type { ServerNode } from '../useServers';
import type { CatalogService } from '../useCatalog';
import { downloadText } from '../download';
import { btn, CopyButton, selectClass } from './ui';

interface Props {
  bundle: ReleaseBundle | null;
  sourceEnvironment: string | null; // the release this one was promoted from
  servers: ServerNode[];
  catalog: CatalogService[];
  onClose: () => void;
}

type Output = 'runbook' | 'ops';

export const BundleRunbookModal: React.FC<Props> = ({ bundle, sourceEnvironment, servers, catalog, onClose }) => {
  const [mode, setMode] = useState<RunbookMode>('standard');
  const [output, setOutput] = useState<Output>('runbook');
  const [target, setTarget] = useState<string>(bundle?.environment ?? 'SIT');

  useEffect(() => {
    if (bundle) setTarget(bundle.environment);
  }, [bundle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const text = useMemo(() => {
    if (!bundle) return '';
    // Image name and compose key from the target's vault compose (via the
    // catalog), falling back to any environment for the image name.
    const services: RunbookService[] = bundle.records.map((r) => {
      const svc = catalog.find((c) => c.server === r.server && c.name === r.service);
      const here = svc?.deployments?.find((d) => sameEnvironment(d.environment, target));
      const anywhere = svc?.deployments?.find((d) => d.image);
      return {
        server: r.server,
        service: r.service,
        version: r.version,
        developerName: r.developerName,
        composeKey: here?.composeKey ?? null,
        image: imageRepo(here?.image ?? anywhere?.image ?? svc?.image ?? null),
        envDetails: r.envDetails,
        configDetails: r.configDetails,
        commandDetails: r.commandDetails,
      };
    });
    const input = {
      releaseId: bundle.release?.id ?? bundle.records[0].id,
      title: bundle.title,
      sourceEnvironment: sameEnvironment(target, bundle.environment) ? sourceEnvironment : bundle.environment,
      targetEnvironment: target,
      hasConfigChange: bundle.hasConfigChange,
      configDetails: bundle.configDetails,
      services,
      servers: servers.filter((s) => sameEnvironment(s.environment, target)),
      mode,
      generatedAt: new Date(),
    };
    return output === 'ops' ? renderOpsBrief(input) : renderRunbook(input);
  }, [bundle, catalog, servers, target, mode, output, sourceEnvironment]);

  if (!bundle) return null;
  const file = `${bundle.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'release'}_${target}_${output === 'ops' ? 'ops-brief' : `runbook-${mode}`}.md`;
  const tab = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${active ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-300 hover:text-white'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Release runbook">
      <div className="w-full max-w-5xl rounded-2xl border border-white/15 bg-surface-raised shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">Runbook: {bundle.title}</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              {bundle.records.length} build{bundle.records.length === 1 ? '' : 's'} · written for the target servers only · nothing is run from here
            </p>
          </div>
          <button type="button" onClick={onClose} className={btn} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-3">
          <div role="tablist" aria-label="Document" className="inline-flex rounded-xl border border-white/15 p-1">
            <button type="button" role="tab" aria-selected={output === 'runbook'} className={tab(output === 'runbook')} onClick={() => setOutput('runbook')}>
              <BookOpen className="h-4 w-4" /> Runbook
            </button>
            <button type="button" role="tab" aria-selected={output === 'ops'} className={tab(output === 'ops')} onClick={() => setOutput('ops')}>
              <FileText className="h-4 w-4" /> Bank IT / Ops brief
            </button>
          </div>

          {output === 'runbook' && (
            <div role="radiogroup" aria-label="Runbook scope" className="inline-flex rounded-xl border border-white/15 p-1">
              <button type="button" role="radio" aria-checked={mode === 'standard'} className={tab(mode === 'standard')} onClick={() => setMode('standard')} title="Only the commands the deployment needs">
                Standard
              </button>
              <button type="button" role="radio" aria-checked={mode === 'detailed'} className={tab(mode === 'detailed')} onClick={() => setMode('detailed')} title="Adds disk, hash, compose and health checks">
                <ShieldCheck className="h-4 w-4" /> Detailed
              </button>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-300">
            Target
            <select className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
              {ENVIRONMENTS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>

          <span className="flex-1" />
          <CopyButton text={text} label="Copy Markdown" />
          <button type="button" className={btn} onClick={() => downloadText(file, text, 'text/markdown')}>
            <Download className="h-3.5 w-3.5" /> Download .md
          </button>
        </div>

        <p className="px-5 pt-3 text-xs text-zinc-400">
          {output === 'ops'
            ? 'A one-page brief for the bank IT / Ops team: servers, order, downtime, rollback. No code changes, versions or config values.'
            : mode === 'standard'
            ? 'Standard: back up, load images, set tags, apply config, restart, verify, roll back.'
            : 'Detailed: standard plus pre-flight checks (host, disk space, tar hashes, compose validity, current image IDs) and health, restart and log checks afterwards.'}
          {' '}Unknown facts are left as &lt;PLACEHOLDERS&gt; and listed at the end. Fill in the server registry (Infrastructure) to complete them.
        </p>
        <pre className="scrollbar-subtle m-5 max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/60 p-4 font-mono text-xs leading-relaxed text-zinc-200">
          {text}
        </pre>
      </div>
    </div>
  );
};
