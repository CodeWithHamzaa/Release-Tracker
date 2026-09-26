import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { AddRecordForm } from './components/AddRecordForm';
import { CatalogView } from './components/CatalogView';
import { LoginView } from './components/LoginView';
import { ReleaseRecord } from '@/lib/types';
import { getSupabaseClient } from '@/lib/supabase';
import { apiFetch, apiErrorMessage } from './api';
import { useCatalog, CatalogService } from './useCatalog';

const RECORDS_CACHE_KEY = 'enterprise_release_records_v3';

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

  // Login. With no Supabase configured (local dev only) auth is off entirely,
  // matching the API, which skips auth in that case too.
  const authEnabled = getSupabaseClient() !== null;
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(!authEnabled);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const signedIn = !authEnabled || session !== null;
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) setAuthNotice(null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const catalog = useCatalog(signedIn);

  const [records, setRecords] = useState<ReleaseRecord[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(RECORDS_CACHE_KEY);
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
      localStorage.setItem(RECORDS_CACHE_KEY, JSON.stringify(records));
    } catch {
      // ignore
    }
  }, [records]);

  // Real-time Supabase connection check and listener (INSERT, UPDATE & DELETE)
  // Subscribes only once signed in: with row-level security on ReleaseRecord,
  // realtime delivers changes only to authenticated users.
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) {
      setIsRealtimeConnected(false);
      return;
    }

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
  }, [userId]);

  // Fetch latest records from the API
  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/records');
      if (res.status === 401) {
        // apiFetch already signed out locally; the login screen takes over.
        setAuthNotice('Your session expired. Sign in again.');
        return;
      }
      if (!res.ok) {
        setLoadError(await apiErrorMessage(res, 'Failed to load records'));
        return;
      }
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.records)) {
        setRecords(data.records);
        setLoadError(null);
      } else {
        setLoadError('The release API returned an unexpected response.');
      }
    } catch {
      setLoadError('Could not reach the release API.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load live data once signed in (and again after switching accounts).
  useEffect(() => {
    if (signedIn) fetchRecords();
  }, [signedIn, userId, fetchRecords]);

  const handleSignOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    // Drop the cached records so the next person at this browser sees nothing.
    try {
      localStorage.removeItem(RECORDS_CACHE_KEY);
    } catch {
      // ignore
    }
    setRecords([]);
    setCurrentPath('/');
    await supabase?.auth.signOut();
  }, []);

  // The catalog page lists config/services.json when there is no database.
  const catalogServices = useMemo<CatalogService[]>(() => {
    if (catalog.source === 'database') return catalog.services;
    return Object.entries<string[]>(catalog.serverMap).flatMap(([server, names]) =>
      names.map((name) => ({ id: `${server}::${name}`, server, name, image: null, ports: [] }))
    );
  }, [catalog.source, catalog.services, catalog.serverMap]);

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

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }
  if (!signedIn) {
    return <LoginView notice={authNotice} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col font-sans selection:bg-emerald-950 selection:text-emerald-300">
      <Navbar
        currentPath={currentPath}
        onNavigate={(path) => setCurrentPath(path)}
        isRealtimeConnected={isRealtimeConnected}
        userEmail={session?.user?.email ?? null}
        onSignOut={authEnabled ? handleSignOut : undefined}
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
            catalog={catalog.serverMap}
            onSuccess={handleNewRecord}
            onCancel={() => setCurrentPath('/')}
          />
        ) : currentPath === '/catalog' ? (
          <CatalogView
            services={catalogServices}
            editable={catalog.source === 'database'}
            warning={catalog.warning}
            isLoading={catalog.isLoading}
            onReload={catalog.reload}
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
