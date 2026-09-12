import { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { AddRecordForm } from './components/AddRecordForm';
import { ReleaseRecord } from '@/lib/types';
import { getSupabaseClient } from '@/lib/supabase';

// Initial enterprise release dataset with developerName and status
const INITIAL_RECORDS: ReleaseRecord[] = [
  {
    id: 'rel-101',
    environment: 'Prod',
    server: 'Bot-Builder',
    service: 'bot-builder-api',
    developerName: 'Sufyan Tariq',
    status: 'Success',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'REDIS_CLUSTER_URL=rediss://prod-cache.internal:6379\nBOT_MAX_CONCURRENCY=250',
    isConfigUpdate: true,
    configDetails: 'Updated timeout thresholds in config/routing.json from 15s down to 8s.',
    hasCommands: true,
    commandDetails: 'kubectl rollout restart deployment/bot-builder-api -n production',
    note: 'Emergency hotfix addressing connection leak during peak hours. Verified in production.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 'rel-102',
    environment: 'UAT',
    server: 'Chat-Service',
    service: 'websocket-server',
    developerName: 'Muhammad Bilal',
    status: 'Pending',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: true,
    configDetails: 'Configured heartbeat ping interval 25s for mobile clients in gateway.yaml.',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for regression test pass with mobile client release candidate v3.2.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: 'rel-103',
    environment: 'SIT',
    server: 'Auth-Gateway',
    service: 'oauth-provider',
    developerName: 'Ali Raza',
    status: 'Failed',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'SAML_ENTITY_ID=https://auth.internal.corp/saml\nSAML_CALLBACK_VALIDATION=strict',
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d --force-recreate oauth-provider',
    note: 'SSO endpoint handshake failed integration test. Awaiting bug fix from backend team.',
    source: 'Teams DM',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
];

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [records, setRecords] = useState<ReleaseRecord[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enterprise_release_records_v2');
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
  const [isRealtimeConnected, setIsRealtimeConnected] = useState<boolean>(false);

  // Sync to local storage for persistence across reloads
  useEffect(() => {
    try {
      localStorage.setItem('enterprise_release_records_v2', JSON.stringify(records));
    } catch {
      // ignore
    }
  }, [records]);

  // Real-time Supabase connection check and listener (INSERT & UPDATE)
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
      if (res.ok) {
        const data = await res.json();
        if (data.records && Array.isArray(data.records) && data.records.length > 0) {
          setRecords(data.records);
        }
      }
    } catch {
      // Using existing state
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleNewRecord = (newRecord: ReleaseRecord) => {
    setRecords((prev) => {
      const filtered = prev.filter((r) => r.id !== newRecord.id);
      return [newRecord, ...filtered];
    });
    setCurrentPath('/');
  };

  const handleRecordUpdated = (updatedRecord: ReleaseRecord) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === updatedRecord.id ? updatedRecord : r))
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      <Navbar
        currentPath={currentPath}
        onNavigate={(path) => setCurrentPath(path)}
        isRealtimeConnected={isRealtimeConnected}
      />

      <main className="flex-1">
        {currentPath === '/add' ? (
          <AddRecordForm
            onSuccess={handleNewRecord}
            onCancel={() => setCurrentPath('/')}
          />
        ) : (
          <DashboardView
            records={records}
            onAddRecord={() => setCurrentPath('/add')}
            onRefresh={fetchRecords}
            isLoading={isLoading}
            onNewRecordReceived={handleNewRecord}
            onRecordUpdated={handleRecordUpdated}
          />
        )}
      </main>

      {/* Enterprise Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-700">Enterprise Release Tracker</span>
            <span>•</span>
            <span>Single Write-Path API Spec</span>
            <span>•</span>
            <span>Prisma + Supabase PostgreSQL</span>
          </div>
          <div className="flex items-center space-x-4 text-slate-400">
            <span>Author Roles: A.Hameed, Hanzala</span>
            <span>•</span>
            <span>Live Status Stream</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
