import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, FileTerminal, X } from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';
import { buildRunbook, runbookMarkdown, runbookScript, PATCH_ID_PATTERN, indexEnv, indexRole, RunbookInput } from '@/lib/runbook';
import type { ServerNode } from '../useServers';
import { copyText, downloadText } from '../download';

interface RunbookModalProps {
  record: ReleaseRecord | null; // the record the runbook was opened from
  records: ReleaseRecord[];
  server: ServerNode | null;
  onClose: () => void;
}

const inputClass =
  'w-full px-3 py-2 bg-[#1f1f23] border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';
const buttonClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed';

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
      aria-label={label ? undefined : 'Copy'}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
};

const stamp = (v: string | Date) => new Date(v).getTime();

export const RunbookModal: React.FC<RunbookModalProps> = ({ record, records, server, onClose }) => {
  // Latest record per service for this environment + role: the candidates.
  const candidates = useMemo(() => {
    if (!record) return [];
    const latest = new Map<string, ReleaseRecord>();
    for (const r of records) {
      if (r.environment !== record.environment || r.server !== record.server) continue;
      const prev = latest.get(r.service);
      if (!prev || stamp(r.createdAt) > stamp(prev.createdAt)) latest.set(r.service, r);
    }
    latest.set(record.service, record);
    return [...latest.values()].sort((a, b) => a.service.localeCompare(b.service));
  }, [record, records]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [patchId, setPatchId] = useState('');

  useEffect(() => {
    if (!record) return;
    // Preselect the batch the record was logged with (same timestamp).
    setSelected(new Set(candidates.filter((c) => stamp(c.createdAt) === stamp(record.createdAt)).map((c) => c.service)));
    const fromNote = record.note?.match(/\bPATCH[-_][A-Za-z0-9._-]+/i)?.[0];
    setPatchId(fromNote || `PATCH-${new Date().toISOString().slice(0, 10)}`);
  }, [record, candidates]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!record) return null;

  const input: RunbookInput = {
    environment: record.environment,
    role: record.server,
    patchId: patchId.trim(),
    services: candidates.filter((c) => selected.has(c.service)).map((c) => ({ service: c.service, version: c.version })),
    server,
  };
  const rb = buildRunbook(input);
  const idOk = PATCH_ID_PATTERN.test(input.patchId);
  const canScript = idOk && !!server?.ip && input.services.length > 0;
  const fileBase = `runbook_${input.patchId || 'PATCH'}_${indexEnv(record.environment)}_${indexRole(record.server).replace(/[^\w-]/g, '')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="runbook-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#111111] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 bg-[#161618] px-6 py-4">
          <div className="flex items-center gap-2">
            <FileTerminal className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 id="runbook-title" className="text-base font-bold text-white">Patch runbook</h2>
              <p className="text-xs text-zinc-400">
                {indexEnv(record.environment)} / {record.server}
                {server?.ip ? ` · ${server.ip}` : ' · IP unknown'}
                {server?.runAs ? ` · as ${server.runAs}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
            <div>
              <label htmlFor="runbook-patch-id" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-300">
                PATCH_ID
              </label>
              <input
                id="runbook-patch-id"
                value={patchId}
                onChange={(e) => setPatchId(e.target.value)}
                className={`${inputClass} font-mono ${idOk ? '' : 'border-amber-600'}`}
              />
              <p className="mt-1 text-[11px] text-zinc-500">Folder name under alara/patches/incoming/</p>
            </div>
            <fieldset>
              <legend className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-300">
                Images in this patch
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((c) => {
                  const on = selected.has(c.service);
                  return (
                    <label
                      key={c.service}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-xs ${
                        on ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200' : 'border-white/10 text-zinc-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-emerald-500"
                        checked={on}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.service)) next.delete(c.service);
                            else next.add(c.service);
                            return next;
                          })
                        }
                      />
                      {c.service} {c.version}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          {rb.warnings.length > 0 && (
            <div role="status" className="space-y-1 rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-300">
              {rb.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          <ol className="space-y-4">
            {rb.steps.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-sm font-semibold text-white">
                  {i + 1}. {step.title}
                </h3>
                {step.commands.map((cmd) => (
                  <div key={cmd} className="mt-2 flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/5 bg-black/40 px-3 py-2 font-mono text-xs text-emerald-200">
                      {cmd}
                    </code>
                    <CopyButton text={cmd.replace(/\s+#.*$/, '')} />
                  </div>
                ))}
                <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                  {step.notes.map((n) => (
                    <li key={n} className="break-words">• {n}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 bg-[#161618] px-6 py-4">
          <CopyButton text={runbookMarkdown(input)} label="Copy checklist" />
          <button type="button" className={buttonClass} onClick={() => downloadText(`${fileBase}.md`, runbookMarkdown(input), 'text/markdown')}>
            <Download className="h-3.5 w-3.5" /> .md
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!canScript}
            title={canScript ? 'Guarded script: refuses to run on any other server' : 'Needs a valid PATCH_ID, a server IP and at least one image'}
            onClick={() => downloadText(`${fileBase}.sh`, runbookScript(input), 'text/x-shellscript')}
          >
            <Download className="h-3.5 w-3.5" /> .sh
          </button>
          <span className="flex-1" />
          <CopyButton text={rb.syncLine} label="Copy §1.2 line" />
        </div>
      </div>
    </div>
  );
};
