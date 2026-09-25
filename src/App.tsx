import { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { AddRecordForm } from './components/AddRecordForm';
import { ReleaseRecord } from '@/lib/types';
import { getSupabaseClient } from '@/lib/supabase';

// Initial enterprise release dataset reflecting Docker Compose architecture
const INITIAL_RECORDS: ReleaseRecord[] = [
  {
    id: 'rel-101',
    environment: 'Prod',
    server: 'Bot-Builder',
    service: 'ldap-connector',
    version: 'v1.2.4',
    developerName: 'Sufyan Tariq',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'LDAP_POOL_SIZE=50\nLDAP_TIMEOUT_MS=3000',
    isConfigUpdate: true,
    configDetails: 'Configured active directory failover replica endpoints.',
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.prod.yml up -d ldap-connector',
    note: 'Enterprise LDAP authentication connector optimized for production scale.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 'rel-102',
    environment: 'UAT',
    server: 'Bot-Builder',
    service: 'ldap-connector',
    version: 'v1.2.4',
    developerName: 'Sufyan Tariq',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.uat.yml up -d ldap-connector',
    note: 'UAT sign-off completed by QA lead.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
  },
  {
    id: 'rel-103',
    environment: 'SIT',
    server: 'Bot-Builder',
    service: 'rbac-service',
    version: 'v1.3.0-rc1',
    developerName: 'Sufyan Tariq',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d rbac-service',
    note: 'Batch release: RBAC role matrix permissions updated.',
    source: 'Teams DM',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: 'rel-104',
    environment: 'UAT',
    server: 'Chat-Service',
    service: 'chat-service',
    version: 'v2.1.0',
    developerName: 'Muhammad Bilal',
    status: 'PENDING',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: true,
    configDetails: 'Configured heartbeat ping interval 25s for mobile clients.',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for regression test pass with mobile client release candidate.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: 'rel-105',
    environment: 'SIT',
    server: 'Chat-Service',
    service: 'chat-service-worker',
    version: 'v2.1.0',
    developerName: 'Muhammad Bilal',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d chat-service-worker',
    note: 'Passed queue worker consumer load testing in SIT.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: 'rel-106',
    environment: 'SIT',
    server: 'Database',
    service: 'redis-db',
    version: '7.2-alpine',
    developerName: 'Ali Raza',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'MAXMEMORY_POLICY=volatile-lru\nREDIS_PORT=6379',
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d redis-db',
    note: 'Cache tier container update for high throughput testing.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
  {
    id: 'rel-107',
    environment: 'UAT',
    server: 'ChatBot / NLU',
    service: 'retriever_api_service',
    version: 'v1.4.0',
    developerName: 'Muhammad Bilal',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: true,
    configDetails: 'Vector search chunk limit increased to 10 docs.',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for acceptance testing with new embeddings model.',
    source: 'Teams DM',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
];

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [records, setRecords] = useState<ReleaseRecord[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enterprise_release_records_v3');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        } catch {
          // fallback
        }
      }
    }
    return INITIAL_RECORDS;
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  // Set when /api/records fails, so the placeholder/cached records above are
  // never mistaken for live data.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState<boolean>(false);

  // Sync to local storage for persistence across reloads
  useEffect(() => {
    try {
      localStorage.setItem('enterprise_release_records_v3', JSON.stringify(records));
    } catch {
      // ignore
    }
  }, [records]);

  // Real-time Supabase connection check and listener (INSERT, UPDATE & DELETE)
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setIsRealtimeConnected(false);
      return;
    }

    setIsRealtimeConnected(true);
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ReleaseRecord' },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = payload.new as ReleaseRecord;
            setRecords((prev) => {
              if (prev.some((r) => r.id === incoming.id)) return prev;
              return [incoming, ...prev];
            });
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = payload.new as ReleaseRecord;
            setRecords((prev) =>
              prev.map((r) => (r.id === updated.id ? updated : r))
            );
          } else if (payload.eventType === 'DELETE' && payload.old) {
            // Default REPLICA IDENTITY only ships the primary key on DELETE,
            // so payload.old is a Partial<ReleaseRecord> -- id is all we need.
            const deletedId = (payload.old as Partial<ReleaseRecord>).id;
            if (deletedId) {
              setRecords((prev) => prev.filter((r) => r.id !== deletedId));
            }
          }
        }
      )
      .subscribe((status) => {
        setIsRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch latest records from API or fallback
  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/records');
      const data = await res.json().catch(() => null);
      if (res.ok && data && Array.isArray(data.records)) {
        setRecords(data.records);
        setLoadError(null);
      } else {
        const reason = data?.reason ? ` (${data.reason})` : '';
        setLoadError(`${data?.message || `Failed to load records (HTTP ${res.status})`}${reason}`);
      }
    } catch {
      setLoadError('Could not reach the release API.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load live data from the API on initial mount instead of showing mock data
  useEffect(() => {
    fetchRecords();
  }, []);

  const handleNewRecord = useCallback((incoming: ReleaseRecord | ReleaseRecord[]) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    const incomingIds = new Set(list.map((r) => r.id));
    setRecords((prev) => [...list, ...prev.filter((r) => !incomingIds.has(r.id))]);
    setCurrentPath('/');
  }, []);

  const handleRecordUpdated = useCallback((updatedRecord: ReleaseRecord) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === updatedRecord.id ? updatedRecord : r))
    );
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col font-sans selection:bg-emerald-950 selection:text-emerald-300">
      <Navbar
        currentPath={currentPath}
        onNavigate={(path) => setCurrentPath(path)}
        isRealtimeConnected={isRealtimeConnected}
      />

      <main className="flex-1">
        {loadError && (
          <div
            role="alert"
            className="mx-auto max-w-7xl mt-4 px-4 py-3 rounded-md border border-rose-900 bg-rose-950/40 text-rose-300 text-sm"
          >
            <span className="font-semibold">Live data unavailable:</span> {loadError} Records shown
            below are cached or placeholder data, not the database.
          </div>
        )}
        {currentPath === '/add' ? (
          <AddRecordForm
            onSuccess={handleNewRecord}
            onCancel={() => setCurrentPath('/')}
          />
        ) : (
          <DashboardView
            records={records}
            isLoading={isLoading}
            onRecordUpdated={handleRecordUpdated}
          />
        )}
      </main>
    </div>
  );
}
