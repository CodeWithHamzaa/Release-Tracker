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

export interface CatalogService {
  id: string;
  server: string;
  name: string;
  image: string | null;
  ports: CatalogPort[];
}

const FALLBACK: Record<string, string[]> = servicesConfig;

// Loads the service catalog from /api/catalog once `enabled` (signed in).
// If the database has no catalog (local dev) or the request fails, the Add
// Record form falls back to config/services.json -- with `warning` set so the
// fallback is visible, never silent.
export function useCatalog(enabled: boolean) {
  const [services, setServices] = useState<CatalogService[]>([]);
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
        setSource('database');
        setWarning(null);
      } else {
        setServices([]);
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

  return { services, serverMap, source, warning, isLoading, reload };
}
