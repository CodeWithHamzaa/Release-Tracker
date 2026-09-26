import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  FileCode2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { parseCompose, findPortConflicts, ComposeParseResult, PortBinding } from '@/lib/compose';
import { apiFetch, apiErrorMessage } from '../api';
import type { CatalogService } from '../useCatalog';
import type { ServerNode } from '../useServers';
import { ServersPanel } from './ServersPanel';

interface CatalogViewProps {
  services: CatalogService[];
  editable: boolean; // false when the catalog comes from the config fallback
  warning: string | null;
  isLoading: boolean;
  onReload: () => Promise<void> | void;
  servers: ServerNode[];
  serversWarning: string | null;
  onReloadServers: () => Promise<void> | void;
}

const ENVIRONMENTS = ['SIT', 'UAT', 'Prod'] as const;

const inputClass =
  'w-full px-3 py-2 bg-[#1f1f23] border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';
const labelClass = 'block text-xs font-bold uppercase tracking-wider text-zinc-300 mb-1.5';
const cardClass = 'rounded-2xl border border-white/10 bg-white/[0.02]';
const buttonClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50';
const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50';

const portLabel = (p: { hostPort: number; containerPort: number; protocol: string }) =>
  `${p.hostPort}→${p.containerPort}${p.protocol === 'tcp' ? '' : '/' + p.protocol}`;

function parseVars(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

function Message({ kind, children }: { kind: 'error' | 'ok' | 'warn'; children: React.ReactNode }) {
  const styles = {
    error: 'border-rose-800/70 bg-rose-950/40 text-rose-300',
    ok: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300',
    warn: 'border-amber-800/70 bg-amber-950/30 text-amber-300',
  }[kind];
  const Icon = kind === 'ok' ? CheckCircle2 : kind === 'warn' ? AlertTriangle : AlertCircle;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── Import docker-compose ───────────────────────────────────────────────────

interface PreviewRow {
  name: string;
  image: string | null;
  group: string;
  include: boolean;
  inCatalog: boolean;
}

const ComposeImport: React.FC<{
  services: CatalogService[];
  groups: string[];
  servers: ServerNode[];
  onSaved: () => Promise<void> | void;
}> = ({ services, groups, servers, onSaved }) => {
  const [environment, setEnvironment] = useState<string>('SIT');
  const [host, setHost] = useState('');
  const [yamlText, setYamlText] = useState('');
  const [varsText, setVarsText] = useState('');
  const [showVars, setShowVars] = useState(false);
  const [parsed, setParsed] = useState<ComposeParseResult | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Suggest registry servers for the chosen environment ("ChatBot 10.42.42.250"),
  // then any host label already used by an earlier import.
  const knownHosts = useMemo(() => {
    const fromRegistry = servers
      .filter((s) => s.environment === environment && s.ip)
      .map((s) => `${s.role === 'ChatBot / NLU' ? 'ChatBot' : s.role} ${s.ip}`);
    const fromImports = services.flatMap((s) => s.ports.filter((p) => p.environment === environment).map((p) => p.host));
    return [...new Set([...fromRegistry, ...fromImports])];
  }, [services, servers, environment]);

  const handleParse = () => {
    setError(null);
    setSaved(null);
    const result = parseCompose(yamlText, parseVars(varsText));
    setParsed(result);
    setRows(
      result.services.map((s) => {
        const match = services.find((c) => c.name === s.name);
        return { name: s.name, image: s.image, group: match?.server || '', include: true, inCatalog: !!match };
      })
    );
  };

  // Port clashes for the rows being imported: within the file, and against
  // ports already saved on this environment + host by services not in the file.
  const conflicts = useMemo(() => {
    if (!parsed || !host.trim()) return [];
    const h = host.trim();
    const included = rows.filter((r) => r.include).map((r) => r.name);
    const bindings: PortBinding[] = [];
    for (const s of services) {
      if (included.includes(s.name)) continue;
      for (const p of s.ports) {
        if (p.environment === environment && p.host === h) {
          bindings.push({ service: s.name, environment, host: h, hostPort: p.hostPort, protocol: p.protocol });
        }
      }
    }
    for (const s of parsed.services) {
      if (!included.includes(s.name)) continue;
      for (const p of s.ports) {
        bindings.push({ service: s.name, environment, host: h, hostPort: p.hostPort, protocol: p.protocol });
      }
    }
    return findPortConflicts(bindings);
  }, [parsed, rows, services, environment, host]);

  const conflictFor = (service: string, hostPort: number, protocol: string) =>
    conflicts.find((c) => c.hostPort === hostPort && c.protocol === protocol && c.services.includes(service));

  const includedRows = rows.filter((r) => r.include);
  const missingGroup = includedRows.some((r) => !r.group.trim());
  const canSave =
    !!parsed && includedRows.length > 0 && !!host.trim() && !missingGroup && conflicts.length === 0 && !isSaving;

  const handleSave = async () => {
    if (!parsed) return;
    setIsSaving(true);
    setError(null);
    setSaved(null);
    try {
      const payload = {
        environment,
        host: host.trim(),
        services: includedRows.map((r) => {
          const s = parsed.services.find((x) => x.name === r.name)!;
          return { server: r.group.trim(), name: r.name, image: s.image, ports: s.ports };
        }),
      };
      const res = await apiFetch('/api/catalog/import', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Import failed'));
        return;
      }
      const data = await res.json();
      setSaved(
        `Saved ${data.services} service(s) and ${data.ports} port(s) for ${environment} / ${host.trim()}` +
          (data.created?.length ? `. New in catalog: ${data.created.join(', ')}` : '.')
      );
      setParsed(null);
      setRows([]);
      setYamlText('');
      await onSaved();
    } catch {
      setError('Could not reach the API. Nothing was saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className={`${cardClass} p-5 sm:p-6 space-y-4`}>
      <div className="flex items-center gap-2">
        <FileCode2 className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Import docker-compose.yml</h2>
      </div>
      <p className="text-xs text-zinc-500">
        Paste a compose file from one host. Parsing happens in your browser; only service names, images and
        published ports are saved. Other variables and secrets in the file are never sent.
      </p>

      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <div>
          <label htmlFor="import-env" className={labelClass}>Environment</label>
          <select id="import-env" value={environment} onChange={(e) => setEnvironment(e.target.value)} className={inputClass}>
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>{env}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="import-host" className={labelClass}>Host label</label>
          <input
            id="import-host"
            list="known-hosts"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="e.g. sit-app-01 or 10.0.1.15"
            className={inputClass}
          />
          <datalist id="known-hosts">
            {knownHosts.map((h) => <option key={h} value={h} />)}
          </datalist>
        </div>
      </div>

      <div>
        <label htmlFor="import-yaml" className={labelClass}>docker-compose.yml</label>
        <textarea
          id="import-yaml"
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={'services:\n  nginx:\n    image: nginx:1.25\n    ports:\n      - "80:80"'}
          className={`${inputClass} font-mono text-xs`}
        />
      </div>

      <div>
        <button type="button" onClick={() => setShowVars((v) => !v)} className="text-xs text-zinc-400 hover:text-emerald-400">
          {showVars ? '− Hide' : '+ Add'} variables for ${'{'}VAR{'}'} ports (optional, KEY=VALUE lines)
        </button>
        {showVars && (
          <textarea
            aria-label="Variables"
            value={varsText}
            onChange={(e) => setVarsText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={'NGINX_PORT=8080'}
            className={`${inputClass} mt-2 font-mono text-xs`}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleParse} disabled={!yamlText.trim()} className={primaryButtonClass}>
          Parse
        </button>
        {parsed && (
          <span className="text-xs text-zinc-500">
            {parsed.services.length} service(s) found
            {!host.trim() && ' · enter a host label to check conflicts and save'}
          </span>
        )}
      </div>

      {parsed && parsed.warnings.length > 0 && (
        <Message kind="warn">
          <ul className="list-disc space-y-0.5 pl-4">
            {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Message>
      )}

      {conflicts.length > 0 && (
        <Message kind="error">
          <p className="font-semibold">Port conflicts on {environment} / {host.trim()}</p>
          <ul className="mt-1 space-y-0.5">
            {conflicts.map((c) => (
              <li key={`${c.hostPort}/${c.protocol}`}>
                {c.hostPort}/{c.protocol}: {c.services.join(', ')}
              </li>
            ))}
          </ul>
        </Message>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Save</th>
                <th className="px-3 py-2 font-semibold">Service</th>
                <th className="px-3 py-2 font-semibold">Group</th>
                <th className="px-3 py-2 font-semibold">Image</th>
                <th className="px-3 py-2 font-semibold">Host ports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row, i) => {
                const svc = parsed!.services.find((s) => s.name === row.name)!;
                const update = (patch: Partial<PreviewRow>) =>
                  setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                return (
                  <tr key={row.name} className={row.include ? '' : 'opacity-50'}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Save ${row.name}`}
                        checked={row.include}
                        onChange={(e) => update({ include: e.target.checked })}
                        className="accent-emerald-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-white">{row.name}</div>
                      <span className={`text-[10px] ${row.inCatalog ? 'text-zinc-500' : 'text-sky-400'}`}>
                        {row.inCatalog ? 'in catalog' : 'new'}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-[150px]">
                      <input
                        list="catalog-groups"
                        aria-label={`Group for ${row.name}`}
                        value={row.group}
                        onChange={(e) => update({ group: e.target.value })}
                        placeholder="Pick or type a group"
                        className={`${inputClass} py-1 text-xs ${row.include && !row.group.trim() ? 'border-amber-600' : ''}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-400 break-all">{row.image || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {svc.ports.map((p) => {
                          const clash = row.include && conflictFor(row.name, p.hostPort, p.protocol);
                          return (
                            <span
                              key={`${p.hostPort}/${p.protocol}`}
                              title={clash ? `Also used by ${clash.services.filter((n) => n !== row.name).join(', ')}` : undefined}
                              className={`rounded-md border px-1.5 py-0.5 font-mono ${
                                clash
                                  ? 'border-rose-700 bg-rose-950/60 text-rose-300'
                                  : 'border-white/10 bg-white/[0.03] text-zinc-300'
                              }`}
                            >
                              {portLabel(p)}
                            </span>
                          );
                        })}
                        {svc.ports.length === 0 && <span className="text-zinc-600">none published</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="catalog-groups">
            {groups.map((g) => <option key={g} value={g} />)}
          </datalist>
        </div>
      )}

      {missingGroup && <p className="text-xs text-amber-400">Every selected service needs a group.</p>}
      {error && <Message kind="error">{error}</Message>}
      {saved && <Message kind="ok">{saved}</Message>}

      {rows.length > 0 && (
        <button type="button" onClick={handleSave} disabled={!canSave} className={primaryButtonClass}>
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save {includedRows.length} service(s) to {environment} / {host.trim() || '…'}
        </button>
      )}
    </section>
  );
};

// ── Catalog page ────────────────────────────────────────────────────────────

export const CatalogView: React.FC<CatalogViewProps> = ({
  services,
  editable,
  warning,
  isLoading,
  onReload,
  servers,
  serversWarning,
  onReloadServers,
}) => {
  const [newGroup, setNewGroup] = useState('');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; server: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => [...new Set(services.map((s) => s.server))].sort(), [services]);
  const byGroup = useMemo(() => {
    const map = new Map<string, CatalogService[]>();
    for (const s of services) map.set(s.server, [...(map.get(s.server) || []), s]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [services]);

  const run = async (request: () => Promise<Response>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) {
        setError(await apiErrorMessage(res, failure));
        return false;
      }
      await onReload();
      return true;
    } catch {
      setError('Could not reach the API. Nothing was saved.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => apiFetch('/api/catalog/services', { method: 'POST', body: JSON.stringify({ server: newGroup, name: newName }) }),
      'Could not add the service'
    );
    if (ok) setNewName('');
  };

  const handleRename = async () => {
    if (!editing) return;
    const ok = await run(
      () =>
        apiFetch(`/api/catalog/services/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ server: editing.server, name: editing.name }),
        }),
      'Could not update the service'
    );
    if (ok) setEditing(null);
  };

  const handleDelete = async (s: CatalogService) => {
    const ports = s.ports.length ? ` and its ${s.ports.length} saved port(s)` : '';
    if (!window.confirm(`Remove ${s.name}${ports} from the catalog? Past release records keep their text.`)) return;
    await run(() => apiFetch(`/api/catalog/services/${s.id}`, { method: 'DELETE' }), 'Could not delete the service');
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-emerald-400" />
          <h1 className="text-lg font-semibold text-white">Service Catalog</h1>
          <span className="text-xs text-zinc-500">
            {services.length} services · {groups.length} groups
          </span>
        </div>
        <button type="button" onClick={() => onReload()} disabled={isLoading} className={buttonClass}>
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {warning && <Message kind="warn">{warning}</Message>}
      {error && <Message kind="error">{error}</Message>}

      {editable && (
        <>
          <form onSubmit={handleAdd} className={`${cardClass} p-5 sm:p-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end`}>
            <div>
              <label htmlFor="new-group" className={labelClass}>Group</label>
              <input
                id="new-group"
                list="catalog-groups-add"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="e.g. Bot-Builder"
                className={inputClass}
                required
              />
              <datalist id="catalog-groups-add">
                {groups.map((g) => <option key={g} value={g} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="new-service" className={labelClass}>Service name</label>
              <input
                id="new-service"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. new-chatbot-service"
                className={`${inputClass} font-mono`}
                required
              />
            </div>
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              <Plus className="h-4 w-4" />
              Add service
            </button>
          </form>

          <ComposeImport services={services} groups={groups} servers={servers} onSaved={onReload} />
        </>
      )}

      <ServersPanel servers={servers} warning={serversWarning} onReload={onReloadServers} />

      <div className="grid gap-4 md:grid-cols-2">
        {byGroup.map(([group, list]) => (
          <section key={group} className={`${cardClass} p-5`}>
            <h2 className="mb-3 text-sm font-semibold text-white">
              {group} <span className="font-normal text-zinc-500">({list.length})</span>
            </h2>
            <ul className="divide-y divide-white/5">
              {list.map((s) =>
                editing?.id === s.id ? (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                    <input
                      aria-label="Group"
                      list="catalog-groups-add"
                      value={editing.server}
                      onChange={(e) => setEditing({ ...editing, server: e.target.value })}
                      className={`${inputClass} w-36 py-1 text-xs`}
                    />
                    <input
                      aria-label="Service name"
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      className={`${inputClass} w-44 py-1 font-mono text-xs`}
                    />
                    <button type="button" onClick={handleRename} disabled={busy} className={buttonClass}>Save</button>
                    <button type="button" onClick={() => setEditing(null)} className={buttonClass} aria-label="Cancel">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ) : (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-zinc-200">{s.name}</div>
                      {s.image && <div className="truncate font-mono text-[11px] text-zinc-500">{s.image}</div>}
                      {s.ports.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.ports.map((p) => (
                            <span
                              key={p.id}
                              className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                            >
                              {p.environment}/{p.host} {portLabel(p)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {editable && (
                      <div className="flex flex-shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing({ id: s.id, server: s.server, name: s.name })}
                          className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"
                          aria-label={`Edit ${s.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(s)}
                          className="rounded-md p-1.5 text-zinc-500 hover:bg-rose-950/50 hover:text-rose-300"
                          aria-label={`Delete ${s.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                )
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
