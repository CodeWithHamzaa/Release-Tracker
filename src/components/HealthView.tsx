import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileText,
  FileTerminal,
  History,
  Loader2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';
import { ageLevel, ageText, serverHealth, versionChecks, HealthReportMeta, ServerHealth } from '@/lib/healthModel';
import { compareSnapshots, checklistText, parseIgnoreKeys, CompareResult } from '@/lib/toolkitCompare';
import type { ParsedSnapshot } from '@/lib/toolkitParse';
import { buildPromotion, targetTokensFrom } from '@/lib/promotionGenerator';
import { PATCH_ID_PATTERN } from '@/lib/runbook';
import { apiFetch, apiErrorMessage } from '../api';
import { PromotionRunbook } from './PromotionRunbook';
import { copyText } from '../download';
import type { HealthApi, UploadOutcome } from '../useHealth';
import type { ServerNode } from '../useServers';
import type { ComposeIndex } from '../useConfigs';

const ENVS = ['SIT', 'UAT', 'Prod'] as const;
const ROLES = ['Bot-Builder', 'ChatBot / NLU', 'Database', 'Chat-Service'] as const;
const SNAPSHOT_ROLES = ['Bot-Builder', 'ChatBot / NLU', 'Chat-Service'] as const; // DATABASE is out of the snapshot tool's scope

const card = 'rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6';
const inputClass =
  'w-full px-3 py-2 bg-[#1f1f23] border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';
const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed';
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50';
const envLabel = (e: string) => e.toUpperCase();

const AGE_STYLE = {
  fresh: 'border-emerald-900 text-emerald-300',
  stale: 'border-amber-700 bg-amber-950/40 text-amber-300',
  old: 'border-rose-800 bg-rose-950/40 text-rose-300',
} as const;

const Pill: React.FC<{ tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; children: React.ReactNode; title?: string }> = ({ tone, children, title }) => {
  const style = {
    ok: 'border-emerald-900 bg-emerald-950/30 text-emerald-300',
    warn: 'border-amber-700 bg-amber-950/40 text-amber-300',
    bad: 'border-rose-800 bg-rose-950/40 text-rose-300',
    info: 'border-sky-800 bg-sky-950/40 text-sky-300',
    muted: 'border-white/10 text-zinc-400',
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style}`}>
      {children}
    </span>
  );
};

const statusTone = (c: { state: string; health: string | null }) =>
  c.state === 'restarting' || c.health === 'unhealthy'
    ? 'text-rose-300'
    : c.state === 'exited'
    ? 'text-amber-300'
    : c.health === 'starting'
    ? 'text-sky-300'
    : 'text-emerald-300';

// ── Board cell ───────────────────────────────────────────────────────────────

const CellSummary: React.FC<{ h: ServerHealth }> = ({ h }) => {
  const { counts } = h;
  const allGood = counts.total > 0 && counts.up === counts.total && !counts.unhealthy;
  const encStates = h.envFiles.map((f) => f.state);
  return (
    <div className="space-y-1">
      {h.containersFrom && (
        <div className={`font-mono text-sm font-semibold ${allGood ? 'text-emerald-300' : counts.restarting || counts.unhealthy ? 'text-rose-300' : 'text-amber-300'}`}>
          {counts.up}/{counts.total} up
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {counts.unhealthy > 0 && <Pill tone="bad">{counts.unhealthy} unhealthy</Pill>}
        {counts.restarting > 0 && <Pill tone="bad">{counts.restarting} restarting</Pill>}
        {counts.exited > 0 && <Pill tone="warn">{counts.exited} exited</Pill>}
        {counts.starting > 0 && <Pill tone="info">{counts.starting} starting</Pill>}
        {encStates.length > 0 &&
          (encStates.every((s) => s === 'encrypted') ? (
            <Pill tone="ok">env encrypted</Pill>
          ) : encStates.includes('missing') ? (
            <Pill tone="bad">env file missing</Pill>
          ) : (
            <Pill tone="warn">env not encrypted</Pill>
          ))}
        {h.masterKey === 'missing' && <Pill tone="bad">no master key</Pill>}
        {h.configMismatch && <Pill tone="bad">{h.configMismatch}</Pill>}
        {h.toolkitVersion && <Pill tone="muted">toolkit v{h.toolkitVersion}</Pill>}
        {h.doctorPassed === false && <Pill tone="bad">doctor: {h.doctorProblems.length} issue(s)</Pill>}
      </div>
      {h.newestAt && (
        <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] ${AGE_STYLE[ageLevel(h.newestAt)]}`} title={new Date(h.newestAt).toLocaleString()}>
          data {ageText(h.newestAt)}
        </span>
      )}
    </div>
  );
};

// ── Server detail ────────────────────────────────────────────────────────────

const ServerDetail: React.FC<{
  environment: string;
  role: string;
  h: ServerHealth;
  records: ReleaseRecord[];
  composeIndex: ComposeIndex;
  health: HealthApi;
  onClose: () => void;
}> = ({ environment, role, h, records, composeIndex, health, onClose }) => {
  const [raw, setRaw] = useState<{ title: string; text: string } | null>(null);
  const [hist, setHist] = useState<{ kind: string; items: Omit<HealthReportMeta, 'parsed'>[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checks = useMemo(
    () =>
      versionChecks(
        h.containers,
        records.filter((r) => r.environment.toUpperCase() === environment.toUpperCase() && r.server === role),
        composeIndex[role]?.[environment]?.summaries ?? null
      ),
    [h.containers, records, environment, role, composeIndex]
  );

  const showRaw = async (id: string, title: string) => {
    setError(null);
    try {
      const r = await health.getReport(id);
      setRaw({ title, text: r.raw });
    } catch (e: any) {
      setError(e.message);
    }
  };
  const showHistory = async (kind: string) => {
    setError(null);
    try {
      setHist({ kind, items: await health.history(environment, role, kind) });
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <section className={`${card} space-y-5`} aria-label={`${envLabel(environment)} ${role} health`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">
          {envLabel(environment)} / {role}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(['status', 'snapshot', 'doctor'] as const).map((kind) => {
          const r = h.reports[kind];
          return (
            <div key={kind} className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5">
              <span className="font-semibold text-zinc-300">{kind}</span>
              {r ? (
                <>
                  <span className={`rounded border px-1 text-[10px] ${AGE_STYLE[ageLevel(r.reportedAt)]}`}>{ageText(r.reportedAt)}</span>
                  <button type="button" className="text-zinc-400 hover:text-white" onClick={() => showRaw(r.id, `${kind} · ${new Date(r.reportedAt).toLocaleString()}`)}>
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="text-zinc-400 hover:text-white" onClick={() => showHistory(kind)} aria-label={`${kind} history`}>
                    <History className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-zinc-600">none</span>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}

      {hist && (
        <div className="rounded-xl border border-white/10 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-zinc-300">{hist.kind} history</span>
            <button type="button" onClick={() => setHist(null)} aria-label="Close history" className="text-zinc-500 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="space-y-1">
            {hist.items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 text-zinc-400">
                <span className="font-mono">{new Date(it.reportedAt).toLocaleString()}</span>
                <span>· {it.uploadedBy}</span>
                <button type="button" className="text-emerald-400 hover:underline" onClick={() => showRaw(it.id, `${hist.kind} · ${new Date(it.reportedAt).toLocaleString()}`)}>
                  view
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {raw && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            <span>{raw.title}</span>
            <button type="button" onClick={() => setRaw(null)} aria-label="Close raw" className="hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="max-h-[50vh] overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-5 text-zinc-300">
            {raw.text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')}
          </pre>
        </div>
      )}

      {h.containers.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Containers <span className="font-normal normal-case text-zinc-600">(from {h.containersFrom})</span>
          </h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-white/[0.03] text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Container</th>
                  <th className="px-3 py-2 font-semibold">Image</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Ports</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {h.containers.map((c) => (
                  <tr key={c.name}>
                    <td className="px-3 py-1.5 text-zinc-200">{c.name}</td>
                    <td className="break-all px-3 py-1.5 text-zinc-400">{c.image}</td>
                    <td className={`px-3 py-1.5 ${statusTone(c)}`}>{c.status}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{c.ports || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {checks.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Version check</h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-white/[0.03] text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Service</th>
                  <th className="px-3 py-2 font-semibold">Running</th>
                  <th className="px-3 py-2 font-semibold">Recorded (last SUCCESS)</th>
                  <th className="px-3 py-2 font-semibold">Config vault</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {checks.map((c) => (
                  <tr key={c.container}>
                    <td className="px-3 py-1.5 text-zinc-200">
                      {c.service}
                      {c.service !== c.container && <span className="text-zinc-600"> ({c.container})</span>}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-200">{c.running ?? '—'}</td>
                    <td className={`px-3 py-1.5 ${c.recordMismatch ? 'text-amber-300' : 'text-zinc-400'}`}>
                      {c.recorded ?? <span className="text-zinc-600">no record</span>}
                      {c.recordMismatch && ' ≠ running'}
                    </td>
                    <td className={`px-3 py-1.5 ${c.vaultMismatch ? 'text-amber-300' : 'text-zinc-400'}`}>
                      {c.vault ?? <span className="text-zinc-600">—</span>}
                      {c.vaultMismatch && ' ≠ running'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(h.envFiles.length > 0 || h.keyState || h.doctorProblems.length > 0) && (
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          {h.envFiles.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-semibold uppercase tracking-wider text-zinc-400">Env files</h3>
              {h.envFiles.map((f) => (
                <div key={f.file} className="font-mono text-zinc-300">
                  {f.file}:{' '}
                  <span className={f.state === 'encrypted' ? 'text-emerald-300' : f.state === 'missing' ? 'text-rose-300' : 'text-amber-300'}>
                    {f.state === 'encrypted' ? `encrypted (${f.encryptedValues} values)` : f.state === 'missing' ? 'MISSING' : 'NOT encrypted'}
                  </span>
                </div>
              ))}
              {h.masterKey && <div className="text-zinc-400">Master key: {h.masterKey}</div>}
              {h.keyState && <div className="text-zinc-400">Key: {h.keyState}</div>}
            </div>
          )}
          {h.doctorProblems.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-semibold uppercase tracking-wider text-zinc-400">Doctor findings</h3>
              {h.doctorProblems.map((p) => (
                <div key={p} className="font-mono text-rose-300">{p}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

// ── Release checklist (port of alara_release_compare.sh v2.1) ────────────────

// ── Promotion scripts modal (lib/promotionGenerator) ────────────────────────

const ROLE_SHORT: Record<string, string> = { 'Bot-Builder': 'BB', 'ChatBot / NLU': 'CHATBOT', Database: 'DB', 'Chat-Service': 'CHATSVC' };

const PromotionModal: React.FC<{
  result: CompareResult;
  role: string;
  sourceEnv: string;
  targetEnv: string;
  servers: ServerNode[];
  onClose: () => void;
}> = ({ result, role, sourceEnv, targetEnv, servers, onClose }) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const [patchId, setPatchId] = useState(`PROMO-${ROLE_SHORT[role] ?? 'ROLE'}-${envLabel(sourceEnv)}-${envLabel(targetEnv)}-${today}`);
  const find = (env: string) => servers.find((s) => s.environment === env && s.role === role) ?? null;
  const plan = useMemo(
    () =>
      buildPromotion({
        compare: result,
        role,
        patchId: patchId.trim(),
        sourceServer: find(sourceEnv),
        targetServer: find(targetEnv),
        targetTokens: targetTokensFrom(servers, targetEnv),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, role, patchId, sourceEnv, targetEnv, servers]
  );
  const idOk = PATCH_ID_PATTERN.test(patchId.trim());

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promotion-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#111111] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 bg-[#161618] px-6 py-4">
          <div className="flex items-center gap-2">
            <FileTerminal className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 id="promotion-title" className="text-base font-bold text-white">Promotion scripts</h2>
              <p className="text-xs text-zinc-400">
                {role} · {envLabel(sourceEnv)} → {envLabel(targetEnv)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <label className="block max-w-sm text-xs text-zinc-400">
            PATCH_ID (folder name for the image tars)
            <input
              aria-label="Promotion PATCH_ID"
              value={patchId}
              onChange={(e) => setPatchId(e.target.value)}
              className={`${inputClass} mt-1 font-mono ${idOk ? '' : 'border-amber-600'}`}
            />
          </label>
          <PromotionRunbook sourceEnv={envLabel(sourceEnv)} targetEnv={envLabel(targetEnv)} plan={plan} />
        </div>
      </div>
    </div>
  );
};

const ChecklistPanel: React.FC<{ reports: HealthReportMeta[]; servers: ServerNode[] }> = ({ reports, servers }) => {
  const snapshots = reports.filter((r) => r.kind === 'snapshot');
  const [role, setRole] = useState<string>('ChatBot / NLU');
  const [source, setSource] = useState('SIT');
  const [target, setTarget] = useState('UAT');
  const [ignore, setIgnore] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPromotion, setShowPromotion] = useState(false);

  const snap = (env: string) => snapshots.find((r) => r.role === role && r.environment === env);
  const src = snap(source);
  const tgt = snap(target);
  let result: CompareResult | null = null;
  let error: string | null = null;
  if (src && tgt) {
    try {
      result = compareSnapshots(src.parsed as ParsedSnapshot, tgt.parsed as ParsedSnapshot, parseIgnoreKeys(ignore));
    } catch (e: any) {
      error = e.message;
    }
  }

  const list = (title: string, items: string[], tone: string) =>
    items.length > 0 && (
      <div>
        <h4 className={`mb-1 text-xs font-bold ${tone}`}>{title}</h4>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-300">
          {items.map((t, i) => (
            <li key={i} className="whitespace-pre-wrap break-words font-mono">{t}</li>
          ))}
        </ol>
      </div>
    );

  return (
    <section className={`${card} space-y-4`}>
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Release checklist</h2>
        <span className="text-xs text-zinc-500">same rules as ./alara_server.sh compare, from the latest snapshots</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-400">
          Role
          <select aria-label="Checklist role" value={role} onChange={(e) => setRole(e.target.value)} className={`${inputClass} mt-1 w-48`}>
            {SNAPSHOT_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          From
          <select aria-label="Checklist source" value={source} onChange={(e) => setSource(e.target.value)} className={`${inputClass} mt-1 w-28`}>
            {ENVS.map((e) => <option key={e} value={e}>{envLabel(e)}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          To
          <select aria-label="Checklist target" value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputClass} mt-1 w-28`}>
            {ENVS.map((e) => <option key={e} value={e}>{envLabel(e)}</option>)}
          </select>
        </label>
        <label className="min-w-[200px] flex-1 text-xs text-zinc-400">
          Ignore keys (optional, one per line)
          <textarea aria-label="Ignore keys" value={ignore} onChange={(e) => setIgnore(e.target.value)} rows={1} className={`${inputClass} mt-1 font-mono text-xs`} />
        </label>
      </div>
      <p className="text-xs text-zinc-500">
        {src ? `From: ${envLabel(source)} snapshot ${ageText(src.reportedAt)}` : `No ${envLabel(source)} snapshot for ${role}`} ·{' '}
        {tgt ? `To: ${envLabel(target)} snapshot ${ageText(tgt.reportedAt)}` : `No ${envLabel(target)} snapshot for ${role}`}
      </p>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {result && (
        <div className="space-y-3">
          {result.warnings.map((w) => <p key={w} className="text-xs text-amber-300">{w}</p>)}
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-zinc-200">
              <span className="font-bold text-rose-300">{result.critical.length}</span> critical ·{' '}
              <span className="font-bold text-amber-300">{result.expected.length}</span> expected ·{' '}
              <span className="font-bold text-sky-300">{result.notes.length}</span> info
            </p>
            <button
              type="button"
              className={btn}
              onClick={async () => {
                if (await copyText(checklistText(result!))) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy checklist'}
            </button>
            <button type="button" id="btn-generate-promotion" className={primaryBtn} onClick={() => setShowPromotion(true)}>
              <FileTerminal className="h-4 w-4" /> Generate Promotion Scripts
            </button>
          </div>
          {result.critical.length === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> No critical action items. {envLabel(target)} matches {envLabel(source)} for this role where it matters.
            </p>
          )}
          {list('CRITICAL - action required before release', result.critical, 'text-rose-300')}
          {list('EXPECTED - routinely per-environment, verify only', result.expected, 'text-amber-300')}
          {list('INFO - non-blocking', result.notes, 'text-sky-300')}
        </div>
      )}
      {showPromotion && result && (
        <PromotionModal
          result={result}
          role={role}
          sourceEnv={source}
          targetEnv={target}
          servers={servers}
          onClose={() => setShowPromotion(false)}
        />
      )}
    </section>
  );
};

// ── Toolkit versions → registry ──────────────────────────────────────────────

const ToolkitPanel: React.FC<{ reports: HealthReportMeta[]; servers: ServerNode[]; onReloadServers: () => Promise<void> | void }> = ({
  reports,
  servers,
  onReloadServers,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doctors = reports.filter((r) => r.kind === 'doctor');
  if (doctors.length === 0) return null;

  const save = async (server: ServerNode, version: string) => {
    setBusy(server.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/servers/${server.id}`, { method: 'PATCH', body: JSON.stringify({ toolkitVersion: version }) });
      if (!res.ok) setError(await apiErrorMessage(res, 'Could not update the registry'));
      else await onReloadServers();
    } catch {
      setError('Could not reach the API.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Toolkit versions</h2>
        <span className="text-xs text-zinc-500">alara_server.sh version from the latest doctor output</span>
      </div>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-white/[0.03] text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Role</th>
              {ENVS.map((e) => <th key={e} className="px-3 py-2 font-semibold">{envLabel(e)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {ROLES.map((role) => (
              <tr key={role}>
                <td className="px-3 py-2 font-semibold text-zinc-200">{role}</td>
                {ENVS.map((env) => {
                  const d = doctors.find((r) => r.role === role && r.environment === env);
                  const version = d && 'serverVersion' in d.parsed && d.parsed.serverVersion ? `v${d.parsed.serverVersion}` : null;
                  const server = servers.find((s) => s.role === role && s.environment === env);
                  const inRegistry = server?.toolkitVersion ?? null;
                  return (
                    <td key={env} className="px-3 py-2">
                      {version ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-zinc-200">{version}</span>
                          <span className="text-[10px] text-zinc-600">{ageText(d!.reportedAt)}</span>
                          {server && inRegistry !== version && (
                            <button type="button" className={btn} disabled={busy === server.id} onClick={() => save(server, version)}>
                              {busy === server.id && <Loader2 className="h-3 w-3 animate-spin" />}
                              Save to registry{inRegistry ? ` (was ${inRegistry})` : ''}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-600">—{inRegistry ? ` (registry: ${inRegistry})` : ''}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────

export const HealthView: React.FC<{
  health: HealthApi;
  records: ReleaseRecord[];
  servers: ServerNode[];
  composeIndex: ComposeIndex;
  onReloadServers: () => Promise<void> | void;
}> = ({ health, records, servers, composeIndex, onReloadServers }) => {
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<{ environment: string; role: string } | null>(null);

  const healthOf = (env: string, role: string) => {
    const list = health.reports.filter((r) => r.environment === env && r.role === role);
    return list.length ? serverHealth(list) : null;
  };

  const run = async (items: { text: string; label: string }[]) => {
    if (!items.length) return;
    setBusy(true);
    const out: UploadOutcome[] = [];
    for (const it of items) out.push(await health.upload(it.text, it.label));
    setOutcomes(out);
    setBusy(false);
    await health.reload();
  };
  const uploadFiles = async (files: FileList | File[]) =>
    run(
      await Promise.all(
        Array.from(files).map(async (f) => ({ label: f.name, text: f.size > 1_000_000 ? '' : await f.text() }))
      )
    );

  const selectedHealth = selected ? healthOf(selected.environment, selected.role) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="h-5 w-5 text-emerald-400" />
        <h1 className="text-lg font-semibold text-white">Server Health</h1>
        <span className="text-xs text-zinc-500">from ALARA toolkit output you bring out of the air gap · nothing connects to the servers</span>
      </div>
      <p className="text-[11px] text-zinc-500">
        Parsers built from alara_server.sh v2.6, alara_release_snapshot.sh v2.0 and alara_release_compare.sh v2.1 (unverified against a
        real server's output until one is uploaded).
      </p>

      {health.warning && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {health.warning}
        </p>
      )}

      {/* Upload */}
      <section className={`${card} space-y-4`}>
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Add reports</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              uploadFiles(e.dataTransfer.files);
            }}
            className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-center text-xs ${
              dragging ? 'border-emerald-500 bg-emerald-950/30 text-emerald-200' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            Drop .snapshot files (from alara/snapshots/) or saved status/doctor output, or click to choose
            <span className="text-zinc-600">Environment and role are read from the file itself.</span>
            <input
              type="file"
              multiple
              aria-label="Choose report files"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <div className="space-y-2">
            <textarea
              aria-label="Paste status or doctor output"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder="Paste the output of ./alara_server.sh status or ./alara_server.sh doctor"
              className={`${inputClass} font-mono text-xs`}
            />
            <button
              type="button"
              className={primaryBtn}
              disabled={!pasted.trim() || busy}
              onClick={async () => {
                await run([{ text: pasted, label: 'pasted text' }]);
                setPasted('');
              }}
            >
              Add pasted output
            </button>
          </div>
        </div>
        {outcomes.length > 0 && (
          <ul className="space-y-1 text-xs">
            {outcomes.map((o, i) => (
              <li key={i} className={o.ok ? 'text-emerald-300' : 'text-rose-300'}>
                <span className="font-mono">{o.label}</span>: {o.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Board */}
      <section className={`${card} space-y-3`}>
        <h2 className="text-sm font-semibold text-white">Servers</h2>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-white/[0.03] text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Role</th>
                {ENVS.map((e) => <th key={e} className="px-3 py-2 font-semibold">{envLabel(e)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ROLES.map((role) => (
                <tr key={role}>
                  <td className="px-3 py-3 align-top font-semibold text-zinc-200">{role}</td>
                  {ENVS.map((env) => {
                    const h = healthOf(env, role);
                    const isSel = selected?.environment === env && selected?.role === role;
                    return (
                      <td key={env} className="px-3 py-3 align-top">
                        {h ? (
                          <button
                            type="button"
                            aria-label={`${envLabel(env)} ${role} details`}
                            onClick={() => setSelected(isSel ? null : { environment: env, role })}
                            className={`w-full rounded-lg border p-2 text-left transition-colors ${isSel ? 'border-emerald-600 bg-emerald-950/20' : 'border-transparent hover:border-white/10'}`}
                          >
                            <CellSummary h={h} />
                          </button>
                        ) : (
                          <span className="text-zinc-600">no reports</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && selectedHealth && (
        <ServerDetail
          environment={selected.environment}
          role={selected.role}
          h={selectedHealth}
          records={records}
          composeIndex={composeIndex}
          health={health}
          onClose={() => setSelected(null)}
        />
      )}

      <ChecklistPanel reports={health.reports} servers={servers} />
      <ToolkitPanel reports={health.reports} servers={servers} onReloadServers={onReloadServers} />
    </div>
  );
};
