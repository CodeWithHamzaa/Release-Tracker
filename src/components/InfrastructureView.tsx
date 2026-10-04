import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Network,
  CheckCircle2,
  FolderLock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { StaleFlags, VersionRecord } from '@/lib/currentVersions';
import { apiFetch, apiErrorMessage } from '../api';
import type { CatalogService, ComposeSyncState } from '../useCatalog';
import type { ServerNode } from '../useServers';
import { serviceCurrentVersion } from '../useCurrentVersions';
import { ServersPanel } from './ServersPanel';
import { PortMapPanel } from './PortMapPanel';
import { CommonSyncPanel } from './CommonSyncPanel';
import { ToolkitRolloutPanel } from './ToolkitRolloutPanel';

interface InfrastructureViewProps {
  services: CatalogService[];
  editable: boolean; // false when the catalog comes from the config fallback
  warning: string | null;
  isLoading: boolean;
  onReload: () => Promise<void> | void;
  servers: ServerNode[];
  serversWarning: string | null;
  onReloadServers: () => Promise<void> | void;
  syncState: ComposeSyncState[];
  staleFlags: StaleFlags[];
  records: VersionRecord[];
  onResync: () => Promise<string[]>;
}

const ENVIRONMENTS = ['SIT', 'UAT', 'Prod'] as const;

const inputClass =
  'w-full px-3 py-2 bg-surface-overlay border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';
const labelClass = 'block text-xs font-bold uppercase tracking-wider text-zinc-200 mb-1.5';
const cardClass = 'rounded-2xl border border-white/15 bg-white/[0.02]';
const buttonClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50';
const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50';

const portLabel = (p: { hostPort: number; containerPort: number; protocol: string }) =>
  `${p.hostPort}→${p.containerPort}${p.protocol === 'tcp' ? '' : '/' + p.protocol}`;

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

// ── Vault sync ──────────────────────────────────────────────────────────────
// Services, images and ports are not typed in here any more: each upload of
// docker-compose.yml (or its .env) on the Configs page syncs them on the
// server. This badge shows how far each environment + role has synced.

const ENV_ORDER = ['SIT', 'UAT', 'Prod'];
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

const VaultSyncBadge: React.FC<{
  syncState: ComposeSyncState[];
  staleFlags: StaleFlags[];
  editable: boolean;
  onResync: () => Promise<string[]>;
}> = ({ syncState, staleFlags, editable, onResync }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const resync = async () => {
    setBusy(true);
    setResult(null);
    try {
      const failed = await onResync();
      setResult(failed.length ? { kind: 'error', text: failed.join(' · ') } : { kind: 'ok', text: 'Catalog re-synced from the vault.' });
    } catch (e: any) {
      setResult({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const flagFor = (s: ComposeSyncState) => staleFlags.find((f) => f.environment === s.environment && f.role === s.role);

  return (
    <section className={`${cardClass} p-5 sm:p-6 space-y-3`} aria-label="Vault sync">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          <FolderLock className="h-3.5 w-3.5" />
          Services and Ports are automatically synced from the latest Config Vault version.
        </span>
        <span className="flex-1" />
        {editable && (
          <button type="button" onClick={resync} disabled={busy} className={buttonClass}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            Resync from vault
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-400">
        Upload docker-compose.yml and .env on the Configs page. Versions then follow the audit log: a release record
        (SUCCESS or PENDING) newer than the compose upload sets the current version.
      </p>
      {syncState.length === 0 ? (
        <p className="text-xs text-zinc-400">No compose files in the vault yet. Upload them on the Configs page.</p>
      ) : (
        <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
          {[...syncState]
            .sort((a, b) => ENV_ORDER.indexOf(a.environment) - ENV_ORDER.indexOf(b.environment) || a.role.localeCompare(b.role))
            .map((s) => {
              const stale = s.syncedVersion !== s.latestVersion;
              const flag = flagFor(s);
              return (
                <li key={s.fileId} className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
                  <div className={s.syncError || stale ? 'text-amber-300' : 'text-zinc-200'}>
                    <span className="font-semibold">{s.environment} / {s.role}</span>{' '}
                    <span className="font-mono text-zinc-400">{s.path} v{s.latestVersion}</span>
                    {s.syncError
                      ? ` · not synced: ${s.syncError}`
                      : stale
                        ? ` · synced v${s.syncedVersion ?? '–'}, press Resync`
                        : ' · synced'}
                  </div>
                  {flag && flag.buildsSince > 0 && (
                    <div className="text-zinc-400">{flag.buildsSince} build(s) logged since; versions shown from the audit log.</div>
                  )}
                  {flag?.configStale && (
                    <div className="text-amber-300">Config change logged {day(flag.configStale)}: docker-compose.yml may be stale, re-upload it.</div>
                  )}
                  {flag?.envStale && (
                    <div className="text-amber-300">Env change logged {day(flag.envStale)}: env files may be stale, re-upload them.</div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
      {result && <Message kind={result.kind}>{result.text}</Message>}
    </section>
  );
};

// ── Infrastructure page ─────────────────────────────────────────────────────

// Where each service runs (server registry), how services are grouped, which
// ports they publish and which version each environment runs. All of it comes
// from the Config Vault and the audit log; nothing here is a second copy.
export const InfrastructureView: React.FC<InfrastructureViewProps> = ({
  services,
  editable,
  warning,
  isLoading,
  onReload,
  servers,
  serversWarning,
  onReloadServers,
  syncState,
  staleFlags,
  records,
  onResync,
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

  // Synced services belong to the vault: edit docker-compose.yml, not this list.
  const synced = (s: CatalogService) => (s.deployments?.length ?? 0) > 0;
  const sortedDeployments = (s: CatalogService) =>
    [...(s.deployments ?? [])].sort((a, b) => ENV_ORDER.indexOf(a.environment) - ENV_ORDER.indexOf(b.environment));

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
    if (!window.confirm(`Remove ${s.name}${ports} from the service list? Past release records keep their text.`)) return;
    await run(() => apiFetch(`/api/catalog/services/${s.id}`, { method: 'DELETE' }), 'Could not delete the service');
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-emerald-400" />
          <h1 className="text-lg font-semibold text-white">Infrastructure</h1>
          <span className="text-xs text-zinc-400">
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

      <VaultSyncBadge syncState={syncState} staleFlags={staleFlags} editable={editable} onResync={onResync} />

      {editable && (
        <>
          <form onSubmit={handleAdd} className={`${cardClass} p-5 sm:p-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end`}>
            <p className="text-xs text-zinc-400 sm:col-span-3">
              Only for services that are in no compose file (they still need a name in the Add Record form). Services in a
              vault compose file are added and updated by the sync.
            </p>
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
        </>
      )}

      <ServersPanel servers={servers} warning={serversWarning} onReload={onReloadServers} />

      <CommonSyncPanel servers={servers} onApplied={onReloadServers} />

      <ToolkitRolloutPanel servers={servers} />

      <PortMapPanel services={services} />

      <div className="grid gap-4 md:grid-cols-2">
        {byGroup.map(([group, list]) => (
          <section key={group} className={`${cardClass} p-5`}>
            <h2 className="mb-3 text-sm font-semibold text-white">
              {group} <span className="font-normal text-zinc-400">({list.length})</span>
            </h2>
            <ul className="divide-y divide-white/10">
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
                      <div className="font-mono text-sm text-zinc-200">
                        {s.name}
                        {synced(s) && <span className="ml-2 font-sans text-[10px] text-emerald-400">vault</span>}
                      </div>
                      {synced(s) ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {sortedDeployments(s).map((d) => {
                            const cur = serviceCurrentVersion(s, d, records);
                            const from =
                              cur.source === 'record'
                                ? `log ${day(cur.at)} ${cur.status}`
                                : `vault v${cur.vaultVersion ?? '?'}`;
                            const title = [
                              d.image ? `Compose image: ${d.image}` : null,
                              cur.superseded
                                ? `Superseded ${cur.superseded.source === 'vault' ? 'compose tag' : 'record'}: ${cur.superseded.version ?? '—'}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join('\n');
                            return (
                              <span
                                key={d.environment}
                                title={title || undefined}
                                // Amber only when a newer compose upload overrode a logged
                                // build: a record ahead of the vault file is normal.
                                className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
                                  cur.superseded?.source === 'record'
                                    ? 'border-amber-700/70 bg-amber-950/30 text-amber-200'
                                    : 'border-white/15 bg-white/[0.03] text-zinc-200'
                                }`}
                              >
                                {d.environment} {cur.version ?? '—'} <span className="font-sans text-zinc-400">· {from}</span>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        s.image && <div className="truncate font-mono text-[11px] text-zinc-400">{s.image}</div>
                      )}
                      {s.ports.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.ports.map((p) => (
                            <span
                              key={p.id}
                              className="rounded-md border border-white/15 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                            >
                              {p.environment}/{p.host} {portLabel(p)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {editable && !synced(s) && (
                      <div className="flex flex-shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing({ id: s.id, server: s.server, name: s.name })}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
                          aria-label={`Edit ${s.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(s)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-rose-950/50 hover:text-rose-300"
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
