import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderLock,
  GitCompare,
  History,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { isEncrypted, isEnvFileName, isSecretKey } from '@/lib/envFile';
import {
  composeDrift,
  envDrift,
  imageChanges,
  imageRepo,
  lineDiff,
  summarizeCompose,
  DriftLabel,
  EnvTokens,
} from '@/lib/configDrift';
import { ReleaseRecord } from '@/lib/types';
import { DEFAULT_DEVELOPER } from '@/lib/developers';
import { apiFetch, apiErrorMessage } from '../api';
import { downloadText } from '../download';
import { syncSummary } from '../useConfigs';
import type { ConfigFileMeta, ConfigVersionMeta, ConfigsApi } from '../useConfigs';
import type { StaleFlags } from '@/lib/currentVersions';
import type { ServerNode } from '../useServers';
import type { CatalogService } from '../useCatalog';

export const CONFIG_ENVS = ['SIT', 'UAT', 'Prod'] as const;
export const CONFIG_ROLES = ['Bot-Builder', 'ChatBot / NLU', 'Database', 'Chat-Service'] as const;

const card = 'rounded-2xl border border-white/15 bg-white/[0.02] p-5 sm:p-6';
const inputClass =
  'w-full px-3 py-2 bg-surface-overlay border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';
const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed';
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50';
const envLabel = (e: string) => e.toUpperCase();
const isComposeName = (p: string) => /compose.*\.ya?ml$/i.test(p);

const LABEL_STYLE: Record<DriftLabel, string> = {
  same: 'border-white/15 text-zinc-300',
  expected: 'border-sky-800 bg-sky-950/40 text-sky-300',
  encrypted: 'border-violet-800 bg-violet-950/40 text-violet-300',
  differs: 'border-amber-700 bg-amber-950/40 text-amber-300',
  missing: 'border-rose-800 bg-rose-950/40 text-rose-300',
};
const LABEL_HELP: Record<DriftLabel, string> = {
  same: 'Identical in every environment that has the file',
  expected: 'Differs only by each environment’s own server IPs / domain (from the server registry)',
  encrypted: 'ENC[...] everywhere: present in all, values not comparable',
  differs: 'Real difference: check it',
  missing: 'Absent in at least one environment',
};

const Badge: React.FC<{ label: DriftLabel }> = ({ label }) => (
  <span title={LABEL_HELP[label]} className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${LABEL_STYLE[label]}`}>
    {label}
  </span>
);

// Blur plaintext secret values for display (KEY=VALUE, KEY: VALUE, - KEY=VALUE).
// Files are stored as-is; this only affects what is on screen.
const SECRET_LINE = /^(\s*(?:-\s*)?(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)(.+)$/;
export function maskLine(line: string): { text: string; masked: boolean } {
  const m = SECRET_LINE.exec(line);
  if (!m || !isSecretKey(m[2])) return { text: line, masked: false };
  const value = m[4].trim().replace(/^["']|["']$/g, '');
  if (!value || isEncrypted(value) || value.startsWith('${')) return { text: line, masked: false };
  return { text: `${m[1]}${m[2]}${m[3]}••••••••`, masked: true };
}

const CodeView: React.FC<{ content: string; reveal: boolean }> = ({ content, reveal }) => {
  const lines = content.replace(/\n$/, '').split('\n');
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-xl border border-white/15 bg-black/40 py-3 font-mono text-xs leading-5 text-zinc-200">
      {lines.map((line, i) => {
        const shown = reveal ? { text: line, masked: false } : maskLine(line);
        return (
          <div key={i} className="flex">
            <span className="w-12 flex-shrink-0 select-none pr-3 text-right text-zinc-400">{i + 1}</span>
            <span className={`whitespace-pre pr-4 ${shown.masked ? 'text-violet-300' : ''}`}>{shown.text || ' '}</span>
          </div>
        );
      })}
    </pre>
  );
};

const DiffView: React.FC<{ before: string; after: string; reveal: boolean; labels: [string, string] }> = ({ before, after, reveal, labels }) => {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const changed = lines.filter((l) => l.type !== 'same').length;
  return (
    <div>
      <p className="mb-2 text-xs text-zinc-400">
        <span className="text-rose-300">− {labels[0]}</span> · <span className="text-emerald-300">+ {labels[1]}</span> · {changed} changed line(s)
      </p>
      <pre className="max-h-[60vh] overflow-auto rounded-xl border border-white/15 bg-black/40 py-3 font-mono text-xs leading-5">
        {lines.map((l, i) => {
          const text = reveal ? l.text : maskLine(l.text).text;
          const style =
            l.type === 'add' ? 'bg-emerald-950/50 text-emerald-200' : l.type === 'del' ? 'bg-rose-950/50 text-rose-200' : 'text-zinc-400';
          return (
            <div key={i} className={`whitespace-pre px-3 ${style}`}>
              {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
              {text || ' '}
            </div>
          );
        })}
      </pre>
    </div>
  );
};

// ── Log image changes as release records (only on click) ─────────────────────

interface ImageChangeSet {
  origin: 'upload' | 'edit';
  environment: string;
  role: string;
  path: string;
  version: number;
  changes: { service: string; from: string | null; to: string; image: string | null; containerName: string | null }[];
}

const ImageChangesOffer: React.FC<{
  set: ImageChangeSet;
  catalogServices: CatalogService[];
  onLogged: (records: ReleaseRecord[]) => void;
  onDismiss: () => void;
}> = ({ set, catalogServices, onLogged, onDismiss }) => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Record under the catalog name when one matches (compose keys and
  // container names can differ, e.g. alara-ui2 vs alara-ui).
  const names = catalogServices.filter((s) => s.server === set.role).map((s) => s.name);
  const nameFor = (c: ImageChangeSet['changes'][number]) =>
    [c.service, c.containerName, imageRepo(c.image)].find((n) => n && names.includes(n)) || c.service;

  const log = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/records', {
        method: 'POST',
        body: JSON.stringify({
          environment: set.environment,
          added_by: 'A.Hameed',
          developerName: DEFAULT_DEVELOPER,
          source: 'Direct',
          status: 'SUCCESS',
          isBuildUpdate: true,
          note: `Config vault: ${set.path} v${set.version}`,
          services: set.changes.map((c) => ({ server: set.role, service: nameFor(c), version: c.to })),
        }),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Could not log the records'));
        return;
      }
      const data = await res.json();
      onLogged(data.records || []);
      setDone(`Logged ${data.count} release record(s). Edit them on the dashboard if the developer or status differs.`);
    } catch {
      setError('Could not reach the API. Nothing was logged.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-sky-900/70 bg-sky-950/20 p-4 text-xs text-sky-200">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {set.changes.length} image change(s) in {envLabel(set.environment)} / {set.role} {set.path} v{set.version}
        </p>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-sky-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="space-y-0.5 font-mono">
        {set.changes.map((c) => (
          <li key={c.service}>
            {nameFor(c)}: {c.from ?? 'new'} → {c.to}
          </li>
        ))}
      </ul>
      {done ? (
        <p className="flex items-center gap-1.5 text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" /> {done}
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" onClick={log} disabled={busy} className={btn}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Log as release records (SUCCESS)
          </button>
          <span className="text-sky-400/80">Optional: nothing is logged unless you click.</span>
        </div>
      )}
      {error && <p className="text-rose-300">{error}</p>}
    </div>
  );
};

// ── File panel: view, history, diff, edit ────────────────────────────────────

const FilePanel: React.FC<{
  file: ConfigFileMeta;
  configs: ConfigsApi;
  onClose: () => void;
  onImageChanges: (set: ImageChangeSet) => void;
  onCatalogChanged: () => void;
}> = ({ file, configs, onClose, onImageChanges, onCatalogChanged }) => {
  const [versions, setVersions] = useState<ConfigVersionMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(file.latest?.id ?? null);
  const [content, setContent] = useState<string | null>(null);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'diff' | 'edit'>('view');
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { getVersions, getContent } = configs;
  const loadVersions = useCallback(async () => {
    try {
      const v = await getVersions(file.id);
      setVersions(v);
      return v;
    } catch (e: any) {
      setError(e.message);
      return [];
    }
  }, [getVersions, file.id]);

  // A different file: start fresh.
  useEffect(() => {
    setMode('view');
    setMessage(null);
    setError(null);
  }, [file.id]);

  // New latest version (after a save or upload): refresh history, show it.
  useEffect(() => {
    setSelectedId(file.latest?.id ?? null);
    loadVersions();
  }, [file.id, file.latest?.id, loadVersions]);

  const selected = versions.find((v) => v.id === selectedId) || null;
  const previous = selected ? versions.find((v) => v.version === selected.version - 1) || null : null;
  const isLatest = !!selected && versions[0]?.id === selected.id;

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setPrevContent(null);
    if (!selectedId) return;
    getContent(selectedId)
      .then((c) => {
        if (cancelled) return;
        setContent(c);
        setDraft(c);
      })
      .catch((e) => !cancelled && setError(e.message));
    if (previous) getContent(previous.id).then((c) => !cancelled && setPrevContent(c)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, previous?.id, getContent]);

  const saveEdit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await configs.save({
        environment: file.environment,
        role: file.role,
        path: file.path,
        content: draft,
        source: 'edit',
        note: note.trim() || undefined,
      });
      if (result.unchanged) {
        setMessage('No changes: identical to the latest version, nothing saved.');
        return;
      }
      const synced = syncSummary(result.sync);
      setMessage(
        `Saved as v${result.version.version}. Copy it to the server yourself (Download → WinSCP); the tracker never pushes files.` +
          (synced ? ` ${synced[0].toUpperCase()}${synced.slice(1)}.` : '')
      );
      if (result.sync) onCatalogChanged();
      setNote('');
      setMode('view');
      if (isComposeName(file.path) && result.previousContent !== null) {
        const changes = imageChanges(result.previousContent, draft);
        if (changes.length) {
          const summaries = summarizeCompose(draft);
          onImageChanges({
            origin: 'edit',
            environment: file.environment,
            role: file.role,
            path: file.path,
            version: result.version.version,
            changes: changes.map((c) => {
              const s = summaries.find((x) => x.name === c.service);
              return { ...c, image: s?.image ?? null, containerName: s?.containerName ?? null };
            }),
          });
        }
      }
      await configs.reload();
      const v = await loadVersions();
      setSelectedId(v[0]?.id ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteFile = async () => {
    if (!window.confirm(`Delete ${file.path} for ${envLabel(file.environment)} / ${file.role} and all ${file.versionCount} version(s)? This cannot be undone.`)) return;
    try {
      const sync = await configs.remove(file.id);
      await configs.reload();
      if (sync) onCatalogChanged();
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <section className={`${card} space-y-4`} aria-label={`${file.path} viewer`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-emerald-400" />
          <h2 className="font-mono text-sm font-semibold text-white">{file.path}</h2>
          <span className="text-xs text-zinc-400">
            {envLabel(file.environment)} / {file.role}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close file" className="rounded-md p-1 text-zinc-300 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <History className="h-3.5 w-3.5" />
          <select
            aria-label="Version"
            value={selectedId ?? ''}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setMode('view');
            }}
            className="rounded-lg border border-zinc-700/80 bg-surface-overlay px-2 py-1 text-xs text-white"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {new Date(v.createdAt).toLocaleString()} · {v.source} · {v.createdBy}
                {v.note ? ` · ${v.note}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={btn} onClick={() => setMode('view')} disabled={mode === 'view'}>
          View
        </button>
        <button type="button" className={btn} onClick={() => setMode('diff')} disabled={!previous || mode === 'diff'}>
          <GitCompare className="h-3.5 w-3.5" /> Diff vs v{previous?.version ?? '–'}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            setDraft(content ?? '');
            setMode('edit');
          }}
          disabled={content === null || mode === 'edit'}
          title={isLatest ? 'Edit and save as a new version' : 'Start a new version from this older one'}
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
        <button
          type="button"
          className={btn}
          disabled={content === null}
          onClick={() => content !== null && downloadText(file.path, content)}
          title="Exact content, for WinSCP back to the server"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </button>
        <button type="button" className={btn} onClick={() => setReveal((r) => !r)}>
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {reveal ? 'Hide secrets' : 'Reveal secrets'}
        </button>
        <span className="flex-1" />
        <button type="button" className={`${btn} hover:border-rose-800 hover:text-rose-300`} onClick={deleteFile}>
          <Trash2 className="h-3.5 w-3.5" /> Delete file
        </button>
      </div>

      {selected && !isLatest && mode !== 'edit' && (
        <p className="text-xs text-amber-300">Showing v{selected.version}; the latest is v{versions[0]?.version}.</p>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}

      {content === null && !error && (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}

      {content !== null && mode === 'view' && <CodeView content={content} reveal={reveal} />}
      {content !== null && mode === 'diff' && prevContent !== null && previous && (
        <DiffView before={prevContent} after={content} reveal={reveal} labels={[`v${previous.version}`, `v${selected!.version}`]} />
      )}
      {mode === 'edit' && (
        <div className="space-y-3">
          <p className="text-xs text-amber-300/90">
            Editing shows real values. Saving creates v{(versions[0]?.version ?? 0) + 1} in the tracker only; the server is not changed.
          </p>
          <textarea
            aria-label="File content"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            rows={22}
            className={`${inputClass} font-mono text-xs leading-5`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Change note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed? (optional)"
              className={`${inputClass} max-w-md`}
            />
            <button type="button" onClick={saveEdit} disabled={busy} className={primaryBtn}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save as new version
            </button>
            <button type="button" onClick={() => setMode('view')} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

// ── Compare across environments ──────────────────────────────────────────────

const ComparePanel: React.FC<{ configs: ConfigsApi; servers: ServerNode[] }> = ({ configs, servers }) => {
  const { files, getContent } = configs;
  const [role, setRole] = useState<string>(CONFIG_ROLES[0]);
  const paths = useMemo(
    () => [...new Set(configs.files.filter((f) => f.role === role).map((f) => f.path))].sort(),
    [configs.files, role]
  );
  const [path, setPath] = useState('');
  const [contents, setContents] = useState<Record<string, string | null>>({});
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [rawPair, setRawPair] = useState<[string, string]>(['SIT', 'UAT']);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paths.includes(path)) setPath(paths.find(isComposeName) || paths[0] || '');
  }, [paths, path]);

  useEffect(() => {
    let cancelled = false;
    setContents({});
    setError(null);
    if (!path) return;
    Promise.all(
      CONFIG_ENVS.map(async (env) => {
        const f = files.find((x) => x.role === role && x.path === path && x.environment === env);
        return [env, f?.latest ? await getContent(f.latest.id) : null] as const;
      })
    )
      .then((pairs) => !cancelled && setContents(Object.fromEntries(pairs)))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [role, path, files, getContent]);

  // Environment-specific values from the server registry: every role's IP in
  // that environment, plus its domain.
  const tokens: EnvTokens = useMemo(() => {
    const t: EnvTokens = {};
    for (const s of servers) {
      const list = (t[s.environment] ||= []);
      const short = s.role === 'ChatBot / NLU' ? 'ChatBot' : s.role;
      if (s.ip) list.push({ token: s.ip, placeholder: `<${short} IP>` });
      if (s.domain && !list.some((x) => x.token === s.domain)) list.push({ token: s.domain, placeholder: '<domain>' });
    }
    return t;
  }, [servers]);

  const loaded = Object.keys(contents).length === CONFIG_ENVS.length;
  const present = CONFIG_ENVS.filter((e) => contents[e] !== null && contents[e] !== undefined);
  const envRows = useMemo(() => (loaded && isEnvFileName(path) ? envDrift(contents, tokens) : []), [loaded, path, contents, tokens]);
  const composeRows = useMemo(() => (loaded && isComposeName(path) ? composeDrift(contents) : []), [loaded, path, contents]);
  const counts = (labels: DriftLabel[]) =>
    labels.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l]: (acc[l] || 0) + 1 }), {});

  const shown = (v: { value: string; encrypted: boolean } | null, key: string) => {
    if (!v) return <span className="text-rose-400/80">— missing</span>;
    if (v.encrypted) return <span className="text-violet-300">ENC[…]</span>;
    const text = !reveal && isSecretKey(key) ? '••••••••' : v.value;
    return <span className="break-all">{text || <span className="text-zinc-400">(empty)</span>}</span>;
  };

  return (
    <section className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <GitCompare className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Compare across environments</h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-300">
          Role
          <select aria-label="Compare role" value={role} onChange={(e) => setRole(e.target.value)} className={`${inputClass} mt-1 w-48`}>
            {CONFIG_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-300">
          File
          <select aria-label="Compare file" value={path} onChange={(e) => setPath(e.target.value)} className={`${inputClass} mt-1 w-56 font-mono`}>
            {paths.length === 0 && <option value="">(no files for this role)</option>}
            {paths.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-300">
          <input type="checkbox" className="accent-emerald-500" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} />
          Only differences
        </label>
        <button type="button" className={`${btn} mb-1`} onClick={() => setReveal((r) => !r)}>
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {reveal ? 'Hide secrets' : 'Reveal secrets'}
        </button>
      </div>

      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {path && !loaded && !error && (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}
      {loaded && present.length < 2 && (
        <p className="text-xs text-zinc-400">
          Upload {path} for at least two environments to compare. Present in: {present.map(envLabel).join(', ') || 'none'}.
        </p>
      )}

      {loaded && present.length >= 2 && isEnvFileName(path) && (
        <>
          <p className="flex flex-wrap gap-2 text-xs text-zinc-300">
            {Object.entries(counts(envRows.map((r) => r.label))).map(([l, n]) => (
              <span key={l} className="flex items-center gap-1">
                <Badge label={l as DriftLabel} /> {n}
              </span>
            ))}
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/15">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-white/[0.03] text-zinc-300">
                <tr>
                  <th className="px-3 py-2 font-semibold">Key</th>
                  {CONFIG_ENVS.map((e) => (
                    <th key={e} className="px-3 py-2 font-semibold">{envLabel(e)}</th>
                  ))}
                  <th className="px-3 py-2 font-semibold">Drift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 font-mono">
                {envRows
                  .filter((r) => !onlyDiffs || (r.label !== 'same' && r.label !== 'expected' && r.label !== 'encrypted'))
                  .map((r) => (
                    <tr key={r.key}>
                      <td className="px-3 py-1.5 text-zinc-200">{r.key}</td>
                      {CONFIG_ENVS.map((e) => (
                        <td key={e} className="max-w-[260px] px-3 py-1.5 text-zinc-200">
                          {contents[e] === null ? <span className="text-zinc-400">no file</span> : shown(r.values[e], r.key)}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <Badge label={r.label} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {loaded && present.length >= 2 && isComposeName(path) && (
        <div className="overflow-x-auto rounded-xl border border-white/15">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-white/[0.03] text-zinc-300">
              <tr>
                <th className="px-3 py-2 font-semibold">Service</th>
                {CONFIG_ENVS.map((e) => (
                  <th key={e} className="px-3 py-2 font-semibold">{envLabel(e)} version</th>
                ))}
                <th className="px-3 py-2 font-semibold">Image</th>
                <th className="px-3 py-2 font-semibold">Ports</th>
                <th className="px-3 py-2 font-semibold">env_file</th>
                <th className="px-3 py-2 font-semibold">Volumes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {composeRows
                .filter((r) => !onlyDiffs || Object.values(r.labels).some((l) => l !== 'same'))
                .map((r) => (
                  <tr key={r.service}>
                    <td className="px-3 py-1.5 font-mono text-zinc-200">{r.service}</td>
                    {CONFIG_ENVS.map((e) => {
                      const s = r.perEnv[e];
                      return (
                        <td key={e} className="px-3 py-1.5 font-mono text-zinc-200" title={s ? `${s.image}\nports: ${s.ports || '—'}` : undefined}>
                          {contents[e] === null ? <span className="text-zinc-400">no file</span> : s ? s.tag ?? '—' : <span className="text-rose-400/80">missing</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5"><Badge label={r.labels.image} /></td>
                    <td className="px-3 py-1.5"><Badge label={r.labels.ports} /></td>
                    <td className="px-3 py-1.5"><Badge label={r.labels.envFiles} /></td>
                    <td className="px-3 py-1.5"><Badge label={r.labels.volumes} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {loaded && present.length >= 2 && (
        <details className="text-xs text-zinc-300">
          <summary className="cursor-pointer select-none">Raw line diff</summary>
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              {[0, 1].map((i) => (
                <select
                  key={i}
                  aria-label={i === 0 ? 'Diff from' : 'Diff to'}
                  value={rawPair[i]}
                  onChange={(e) => setRawPair((p) => (i === 0 ? [e.target.value, p[1]] : [p[0], e.target.value]))}
                  className="rounded-lg border border-zinc-700/80 bg-surface-overlay px-2 py-1 text-xs text-white"
                >
                  {present.map((e) => (
                    <option key={e} value={e}>{envLabel(e)}</option>
                  ))}
                </select>
              ))}
            </div>
            {contents[rawPair[0]] != null && contents[rawPair[1]] != null && (
              <DiffView
                before={contents[rawPair[0]]!}
                after={contents[rawPair[1]]!}
                reveal={reveal}
                labels={[envLabel(rawPair[0]), envLabel(rawPair[1])]}
              />
            )}
          </div>
        </details>
      )}
    </section>
  );
};

interface UploadResult {
  name: string;
  ok: boolean;
  text: string;
  warn?: boolean; // saved, but the catalog sync failed or warned
  detail?: string[];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export const ConfigsView: React.FC<{
  configs: ConfigsApi;
  servers: ServerNode[];
  catalogServices: CatalogService[];
  onRecordsLogged: (records: ReleaseRecord[]) => void;
  onCatalogChanged: () => void; // a vault save/delete re-synced the catalog
  staleFlags: StaleFlags[];
}> = ({ configs, servers, catalogServices, onRecordsLogged, onCatalogChanged, staleFlags }) => {
  const [environment, setEnvironment] = useState<string>('SIT');
  const [role, setRole] = useState<string>(CONFIG_ROLES[0]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [offers, setOffers] = useState<ImageChangeSet[]>([]);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fileAt = (env: string, r: string) => configs.files.filter((f) => f.environment === env && f.role === r);
  const expectedFor = (env: string, r: string) => {
    const s = servers.find((x) => x.environment === env && x.role === r);
    return ['docker-compose.yml', ...(s?.envFiles ?? [])];
  };
  const openFile = configs.files.find((f) => f.id === openFileId) || null;

  const offerKey = (o: ImageChangeSet) => `${o.origin}-${o.environment}-${o.role}-${o.path}-${o.version}`;
  const renderOffers = (origin: ImageChangeSet['origin']) =>
    offers
      .filter((o) => o.origin === origin)
      .map((o) => (
        <ImageChangesOffer
          key={offerKey(o)}
          set={o}
          catalogServices={catalogServices}
          onLogged={onRecordsLogged}
          onDismiss={() => setOffers((prev) => prev.filter((x) => offerKey(x) !== offerKey(o)))}
        />
      ));

  const upload = async (list: FileList | File[]) => {
    const picked = Array.from(list);
    if (!picked.length) return;
    setUploading(true);
    setResults([]);
    const out: UploadResult[] = [];
    let catalogTouched = false;
    for (const f of picked) {
      try {
        if (f.size > 1_000_000) throw new Error('larger than 1 MB');
        const content = await f.text();
        const r = await configs.save({ environment, role, path: f.name, content, source: 'upload' });
        const synced = syncSummary(r.sync);
        if (r.sync) catalogTouched = true;
        out.push({
          name: f.name,
          ok: true,
          text: (r.unchanged ? `unchanged (still v${r.version.version})` : `saved as v${r.version.version}`) + (synced ? ` · ${synced}` : ''),
          warn: r.sync?.status === 'failed' || (r.sync?.status === 'synced' && r.sync.warnings.length > 0),
          detail: r.sync?.status === 'synced' ? r.sync.warnings : [],
        });
        // A first upload is a baseline, not a change: only offer to log
        // records when there was a previous version to compare against.
        if (!r.unchanged && r.previousContent !== null && isComposeName(f.name)) {
          const changes = imageChanges(r.previousContent, content);
          if (changes.length) {
            const summaries = summarizeCompose(content);
            setOffers((prev) => [
              ...prev,
              {
                origin: 'upload',
                environment,
                role,
                path: f.name,
                version: r.version.version,
                changes: changes.map((c) => {
                  const s = summaries.find((x) => x.name === c.service);
                  return { ...c, image: s?.image ?? null, containerName: s?.containerName ?? null };
                }),
              },
            ]);
          }
        }
      } catch (e: any) {
        out.push({ name: f.name, ok: false, text: e.message });
      }
    }
    setResults(out);
    setUploading(false);
    await configs.reload();
    if (catalogTouched) onCatalogChanged();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <FolderLock className="h-5 w-5 text-emerald-400" />
        <h1 className="text-lg font-semibold text-white">Config Vault</h1>
        <span className="text-xs text-zinc-400">
          {configs.files.length} files · every save is kept as a version · the tracker never changes a server
        </span>
      </div>

      {configs.warning && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {configs.warning}
        </p>
      )}

      {/* Upload */}
      <section className={`${card} space-y-4`}>
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Upload files</h2>
        </div>
        <p className="text-xs text-amber-300/90">
          Files are stored exactly as uploaded, plaintext secrets included, behind your login. Secrets are only blurred on screen.
        </p>
        <div className="grid gap-3 sm:grid-cols-[140px_220px_1fr]">
          <label className="text-xs text-zinc-300">
            Environment
            <select aria-label="Upload environment" value={environment} onChange={(e) => setEnvironment(e.target.value)} className={`${inputClass} mt-1`}>
              {CONFIG_ENVS.map((e) => (
                <option key={e} value={e}>{envLabel(e)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            Role
            <select aria-label="Upload role" value={role} onChange={(e) => setRole(e.target.value)} className={`${inputClass} mt-1`}>
              {CONFIG_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }}
            className={`mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-xs ${
              dragging ? 'border-emerald-500 bg-emerald-950/30 text-emerald-200' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Drop docker-compose.yml / .env files here, or click to choose
            <input
              type="file"
              multiple
              aria-label="Choose config files"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) upload(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="text-[11px] text-zinc-400">
          Tip: dot-files like .env_fbl may be hidden in the Windows picker; drag them from WinSCP or Explorer instead. The file name is kept as-is.
        </p>
        {results.length > 0 && (
          <ul className="space-y-1 text-xs">
            {results.map((r) => (
              <li key={r.name} className={!r.ok ? 'text-rose-300' : r.warn ? 'text-amber-300' : 'text-emerald-300'}>
                <span className="font-mono">{r.name}</span>: {r.text}
                {r.detail && r.detail.length > 0 && (
                  <ul className="ml-4 list-disc text-amber-300/90">
                    {r.detail.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {renderOffers('upload')}

      {/* Files grid */}
      <section className={`${card} space-y-3`}>
        <h2 className="text-sm font-semibold text-white">Files by server</h2>
        <div className="overflow-x-auto rounded-xl border border-white/15">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-white/[0.03] text-zinc-300">
              <tr>
                <th className="px-3 py-2 font-semibold">Role</th>
                {CONFIG_ENVS.map((e) => (
                  <th key={e} className="px-3 py-2 font-semibold">{envLabel(e)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {CONFIG_ROLES.map((r) => (
                <tr key={r}>
                  <td className="px-3 py-2 align-top font-semibold text-zinc-200">{r}</td>
                  {CONFIG_ENVS.map((env) => {
                    const here = fileAt(env, r);
                    const missing = expectedFor(env, r).filter((p) => !here.some((f) => f.path === p));
                    const flag = staleFlags.find((x) => x.environment === env && x.role === r);
                    return (
                      <td key={env} className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {here.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => {
                                setOpenFileId(f.id);
                                setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                              }}
                              title={f.latest ? `v${f.latest.version} · ${new Date(f.latest.createdAt).toLocaleString()} · ${f.latest.createdBy}` : undefined}
                              className={`rounded-md border px-1.5 py-0.5 font-mono ${
                                openFileId === f.id
                                  ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200'
                                  : 'border-white/15 bg-white/[0.03] text-zinc-200 hover:border-white/30'
                              }`}
                            >
                              {f.path} <span className="text-zinc-400">v{f.latest?.version}</span>
                            </button>
                          ))}
                          {missing.map((p) => (
                            <span key={p} title="Expected for this role (server registry) but not uploaded" className="rounded-md border border-dashed border-zinc-700 px-1.5 py-0.5 font-mono text-zinc-400">
                              {p}
                            </span>
                          ))}
                        </div>
                        {flag?.configStale && (
                          <p className="mt-1 text-[11px] text-amber-300">Config change logged {flag.configStale.slice(0, 10)}: re-upload docker-compose.yml.</p>
                        )}
                        {flag?.envStale && (
                          <p className="mt-1 text-[11px] text-amber-300">Env change logged {flag.envStale.slice(0, 10)}: re-upload the env files.</p>
                        )}
                        {flag && flag.buildsSince > 0 && (
                          <p className="mt-1 text-[11px] text-zinc-400">{flag.buildsSince} build(s) logged since the compose upload.</p>
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

      <div ref={panelRef}>
        {openFile && (
          <FilePanel
            file={openFile}
            configs={configs}
            onClose={() => setOpenFileId(null)}
            onImageChanges={(set) => setOffers((prev) => [...prev, set])}
            onCatalogChanged={onCatalogChanged}
          />
        )}
        <div className="mt-4 space-y-3">{renderOffers('edit')}</div>
      </div>

      <ComparePanel configs={configs} servers={servers} />
    </div>
  );
};
