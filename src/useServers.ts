import { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiErrorMessage } from './api';

export interface ServerNode {
  id: string;
  environment: string;
  role: string;
  ip: string | null;
  domain: string | null;
  composePath: string | null;
  runAs: string | null;
  access: string | null;
  envFiles: string[];
  toolkitVersion: string | null;
  notes: string | null;
}

// Server registry (environment x role) from /api/servers, once signed in.
export function useServers(enabled: boolean) {
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch('/api/servers');
      if (!res.ok) {
        setWarning(await apiErrorMessage(res, 'Could not load the server registry'));
        return;
      }
      const data = await res.json();
      setServers(data.servers || []);
      setWarning(
        data.dataSource === 'database'
          ? data.servers?.length
            ? null
            : 'Server registry is empty: run prisma/manual/002_server_registry.sql in Supabase.'
          : 'No database: the server registry is unavailable.'
      );
    } catch {
      setWarning('Could not reach the API to load the server registry.');
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const find = useCallback(
    (environment: string, role: string) =>
      servers.find((s) => s.environment.toUpperCase() === environment.toUpperCase() && s.role === role) || null,
    [servers]
  );

  return { servers, warning, reload, find };
}
