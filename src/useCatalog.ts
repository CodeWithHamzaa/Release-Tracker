import { useCallback, useEffect, useMemo, useState } from 'react';
import servicesConfig from '@/config/services.json';
import { apiFetch, apiErrorMessage } from './api';

export interface CatalogPort {
  id: string;
  serviceId: string;
  environment: string;
  host: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
  hostIp: string | null;
}

// What one environment runs for a service, synced from the vault compose file.
export interface CatalogDeployment {
  environment: string;
  role: string;
  composeKey: string;
  containerName: string | null;
  image: string | null;
  tag: string | null;
  syncedAt: string;
  sourceVersion: { version: number; createdAt: string } | null;
}

export interface CatalogService {
  id: string;
  server: string;
  name: string;
  image: string | null;
  ports: CatalogPort[];
  deployments?: CatalogDeployment[]; // absent in the config/services.json fallback
}

// Sync state of each environment + role's primary compose file.
export interface ComposeSyncState {
  fileId: string;
  environment: string;
  role: string;
  path: string;
  latestVersion: number | null;
  latestAt: string | null;
  syncedVersion: number | null;
  syncedAt: string | null;
  syncError: string | null;
}

const FALLBACK: Record<string, string[]> = servicesConfig;

// Loads the service catalog from /api/catalog once `enabled` (signed in).
// If the database has no catalog (local dev) or the request fails, the Add
// Record form falls back to config/services.json -- with `warning` set so the
// fallback is visible, never silent.
export function useCatalog(enabled: boolean) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [syncState, setSyncState] = useState<ComposeSyncState[]>([]);
  const [source, setSource] = useState<'database' | 'fallback'>('fallback');
  const [warning, setWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/catalog');
      if (!res.ok) {
        setWarning(await apiErrorMessage(res, 'Could not load the service catalog'));
        return;
      }
      const data = await res.json();
      if (data.dataSource === 'database') {
        setServices(data.services);
        setSyncState(data.syncState ?? []);
        setSource('database');
        setWarning(null);
      } else {
        setServices([]);
        setSyncState([]);
        setSource('fallback');
        setWarning('No database: the catalog is read-only from config/services.json.');
      }
    } catch {
      setWarning('Could not reach the API to load the service catalog.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  // Server (group) -> service names, the shape the Add Record form uses.
  const serverMap = useMemo<Record<string, string[]>>(() => {
    if (source !== 'database' || services.length === 0) return FALLBACK;
    const map: Record<string, string[]> = {};
    for (const s of services) (map[s.server] ||= []).push(s.name);
    return map;
  }, [services, source]);

  // Re-apply the vault to the catalog (backfill, or retry a failed sync).
  // Returns one line per environment + role that did not sync.
  const resync = useCallback(async (): Promise<string[]> => {
    const res = await apiFetch('/api/configs/sync', { method: 'POST', body: JSON.stringify({}) });
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not resync from the vault'));
    const data = await res.json();
    await reload();
    return (data.results ?? [])
      .filter((r: any) => r.status === 'failed')
      .map((r: any) => `${r.environment} / ${r.role}: ${r.error}`);
  }, [reload]);

  return { services, syncState, serverMap, source, warning, isLoading, reload, resync };
}
