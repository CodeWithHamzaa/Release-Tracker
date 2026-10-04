import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, apiErrorMessage } from './api';
import { summarizeCompose, ComposeServiceSummary } from '@/lib/configDrift';
import { primaryComposePath } from '@/lib/composeSync';

export interface ConfigVersionMeta {
  id: string;
  version: number;
  sha256: string;
  sizeBytes: number;
  source: 'upload' | 'edit' | string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ConfigFileMeta {
  id: string;
  environment: string;
  role: string;
  path: string;
  latest: ConfigVersionMeta | null;
  versionCount: number;
}

// What the server did to the catalog after a vault save or delete
// (syncRoleFromVault in lib/app.ts). null for files that feed no sync.
export type SyncOutcome =
  | {
      status: 'synced';
      environment: string;
      role: string;
      path: string;
      version: number;
      services: number;
      created: string[];
      ports: number;
      warnings: string[];
    }
  | { status: 'failed'; environment: string; role: string; path: string | null; error: string }
  | { status: 'skipped'; environment: string; role: string; reason: string };

export function syncSummary(sync: SyncOutcome | null | undefined): string | null {
  if (!sync) return null;
  if (sync.status === 'synced') {
    const created = sync.created.length ? `, new: ${sync.created.join(', ')}` : '';
    const warn = sync.warnings.length ? ` (${sync.warnings.length} warning${sync.warnings.length === 1 ? '' : 's'})` : '';
    return `catalog synced from ${sync.path} v${sync.version}: ${sync.services} service(s), ${sync.ports} port(s)${created}${warn}`;
  }
  if (sync.status === 'failed') return `catalog not synced: ${sync.error}`;
  return `catalog not synced: ${sync.reason}`;
}

export interface SaveResult {
  unchanged: boolean;
  file: { id: string; environment: string; role: string; path: string };
  version: ConfigVersionMeta;
  previousContent: string | null;
  sync: SyncOutcome | null;
}

// Config vault data: the file list (metadata only) plus on-demand version
// contents, cached by version id (a version never changes once saved).
export function useConfigs(enabled: boolean) {
  const [files, setFiles] = useState<ConfigFileMeta[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const contentCache = useRef(new Map<string, string>());

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/configs');
      if (!res.ok) {
        setWarning(await apiErrorMessage(res, 'Could not load config files'));
        return;
      }
      const data = await res.json();
      setFiles(data.files || []);
      setWarning(data.dataSource === 'database' ? null : 'No database: the config vault is unavailable.');
    } catch {
      setWarning('Could not reach the API to load config files.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const getContent = useCallback(async (versionId: string): Promise<string> => {
    const cached = contentCache.current.get(versionId);
    if (cached !== undefined) return cached;
    const res = await apiFetch(`/api/configs/versions/${versionId}`);
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not load the file'));
    const data = await res.json();
    contentCache.current.set(versionId, data.version.content);
    return data.version.content;
  }, []);

  const getVersions = useCallback(async (fileId: string): Promise<ConfigVersionMeta[]> => {
    const res = await apiFetch(`/api/configs/${fileId}/versions`);
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not load the history'));
    return (await res.json()).versions;
  }, []);

  const save = useCallback(
    async (input: { environment: string; role: string; path: string; content: string; source: 'upload' | 'edit'; note?: string }) => {
      const res = await apiFetch('/api/configs', { method: 'POST', body: JSON.stringify(input) });
      if (!res.ok) throw new Error(await apiErrorMessage(res, `Could not save ${input.path}`));
      const data: SaveResult = await res.json();
      contentCache.current.set(data.version.id, input.content);
      return data;
    },
    []
  );

  const remove = useCallback(async (fileId: string): Promise<SyncOutcome | null> => {
    const res = await apiFetch(`/api/configs/${fileId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not delete the file'));
    return (await res.json()).sync ?? null;
  }, []);

  // Stable identity until the data changes, so panels can depend on it.
  return useMemo(
    () => ({ files, warning, isLoading, reload, getContent, getVersions, save, remove }),
    [files, warning, isLoading, reload, getContent, getVersions, save, remove]
  );
}

export type ConfigsApi = ReturnType<typeof useConfigs>;

// Latest stored compose file per role + environment, parsed into per-service
// summaries (image, tag, ports...). Feeds the Health page's
// running-vs-vault version checks. Recomputed when the file list changes.
// `at` and `version` say when that compose version was uploaded, which is the
// baseline the audit log is compared against (src/useCurrentVersions.ts).
export interface ComposeIndexEntry {
  fileId: string;
  summaries: ComposeServiceSummary[];
  at: string;
  version: number;
}
export type ComposeIndex = Record<string, Record<string, ComposeIndexEntry>>;

export function useComposeIndex(configs: ConfigsApi): ComposeIndex {
  const [index, setIndex] = useState<ComposeIndex>({});
  const { files, getContent } = configs;

  useEffect(() => {
    let cancelled = false;
    // One compose file per role + env, chosen by the same rule as the
    // server's catalog sync (docker-compose.yml first).
    const withVersion = files.filter((f) => f.latest);
    const pick = new Map<string, ConfigFileMeta>();
    for (const f of withVersion) {
      const key = `${f.role}\u0000${f.environment}`;
      if (pick.has(key)) continue;
      const path = primaryComposePath(withVersion.filter((g) => g.role === f.role && g.environment === f.environment).map((g) => g.path));
      const chosen = withVersion.find((g) => g.role === f.role && g.environment === f.environment && g.path === path);
      if (chosen) pick.set(key, chosen);
    }
    Promise.all(
      [...pick.values()].map(async (f) => ({ f, content: await getContent(f.latest!.id).catch(() => null) }))
    ).then((loaded) => {
      if (cancelled) return;
      const next: ComposeIndex = {};
      for (const { f, content } of loaded) {
        if (content === null) continue;
        (next[f.role] ||= {})[f.environment] = {
          fileId: f.id,
          summaries: summarizeCompose(content),
          at: f.latest!.createdAt,
          version: f.latest!.version,
        };
      }
      setIndex(next);
    });
    return () => {
      cancelled = true;
    };
  }, [files, getContent]);

  return index;
}
