'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/src/components/Navbar';
import { DashboardView } from '@/src/components/DashboardView';
import { ReleaseRecord } from '@/lib/types';
import { getSupabaseClient } from '@/lib/supabase';

const INITIAL_DATA: ReleaseRecord[] = [
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
    configDetails: 'Updated timeout thresholds in config/routing.json from 15s to 8s.',
    hasCommands: true,
    commandDetails: 'kubectl rollout restart deployment/bot-builder-api -n production',
    note: 'Hotfix release addressing memory leak in WebSocket connection pooling during peak hours.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
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
    configDetails: 'Enabled heartbeat ping interval 25s for mobile clients.',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for regression testing with mobile client v3.2 before Friday cutover.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
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
    envDetails: 'NEW_SAML_ENTITY_ID=https://auth.internal.corp/saml',
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d --force-recreate oauth-provider',
    note: 'Testing new SAML SSO integration endpoint with QA group accounts.',
    source: 'Teams DM',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [records, setRecords] = useState<ReleaseRecord[]>(INITIAL_DATA);
  const [isLoading, setIsLoading] = useState(false);
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);

  // Load records from API
  const fetchRecords = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/records');
      if (res.ok) {
        const json = await res.json();
        if (json.records && Array.isArray(json.records)) {
          setRecords(json.records);
        }
      }
    } catch (err) {
      console.error('Error fetching records:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();

    // Supabase Real-time listener: channel('schema-db-changes')
    const supabase = getSupabaseClient();
    if (!supabase) return;

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
        setIsRealtimeActive(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleRecordUpdated = (updatedRecord: ReleaseRecord) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === updatedRecord.id ? updatedRecord : r))
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <Navbar
        currentPath="/"
        onNavigate={(path) => router.push(path)}
        isRealtimeConnected={isRealtimeActive}
      />
      <DashboardView
        records={records}
        onAddRecord={() => router.push('/add')}
        onRefresh={fetchRecords}
        isLoading={isLoading}
        onNewRecordReceived={(record) => {
          setRecords((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
        }}
        onRecordUpdated={handleRecordUpdated}
      />
    </div>
  );
}
