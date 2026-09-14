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
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300">
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
