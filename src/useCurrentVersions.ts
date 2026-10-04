import { useMemo } from 'react';
import {
  applyCurrentVersions,
  currentVersion,
  recordsFor,
  staleVaultFlags,
  CurrentVersion,
  StaleFlags,
  VersionRecord,
} from '@/lib/currentVersions';
import type { ComposeIndex, ConfigFileMeta } from './useConfigs';
import type { CatalogDeployment, CatalogService } from './useCatalog';

// The vault compose index with each service's tag replaced by its current
// version (a newer deployed release record wins over the compose upload).
// Health checks and the pre-flight risk analyzer read this instead of the raw
// index, so they follow the daily builds logged in the audit log.
export function useEffectiveComposeIndex(index: ComposeIndex, records: VersionRecord[]): ComposeIndex {
  return useMemo(() => {
    const out: ComposeIndex = {};
    for (const [role, byEnv] of Object.entries(index)) {
      for (const [environment, entry] of Object.entries(byEnv)) {
        const { summaries } = applyCurrentVersions(entry.summaries, { at: entry.at, version: entry.version }, environment, role, records);
        (out[role] ||= {})[environment] = { ...entry, summaries };
      }
    }
    return out;
  }, [index, records]);
}

// Per environment + role: build records since the compose upload (info), and
// config/env changes logged after the vault files (re-upload warnings).
export function useStaleFlags(files: ConfigFileMeta[], records: VersionRecord[]): StaleFlags[] {
  return useMemo(
    () =>
      staleVaultFlags(
        files.map((f) => ({
          environment: f.environment,
          role: f.role,
          path: f.path,
          latestAt: f.latest?.createdAt ?? null,
          latestVersion: f.latest?.version ?? null,
        })),
        records
      ),
    [files, records]
  );
}

// Current version of one catalog service in one environment.
export function serviceCurrentVersion(service: CatalogService, d: CatalogDeployment, records: VersionRecord[]): CurrentVersion {
  const mine = recordsFor(records, d.environment, d.role, [service.name, d.composeKey, d.containerName]);
  const at = d.sourceVersion?.createdAt ?? d.syncedAt;
  return currentVersion({ tag: d.tag, at, version: d.sourceVersion?.version ?? null }, mine);
}
