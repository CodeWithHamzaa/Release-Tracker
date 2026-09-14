import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  Layers,
  Terminal,
  Copy,
  Check,
  Code2,
  X,
  Server,
  User,
  SlidersHorizontal,
  Table,
  CheckCircle2,
  AlertTriangle,
  Tag,
  ArrowRight,
} from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';
import { ReleaseCard } from './ReleaseCard';
import { StatsBar } from './StatsBar';
import { EditRecordModal } from './EditRecordModal';
import { getSupabaseClient } from '@/lib/supabase';

interface DashboardViewProps {
  records: ReleaseRecord[];
  onAddRecord: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
  onNewRecordReceived?: (record: ReleaseRecord) => void;
  onRecordUpdated?: (record: ReleaseRecord) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  records,
  onAddRecord,
  onRefresh,
  isLoading = false,
  onNewRecordReceived,
  onRecordUpdated,
}) => {
  // Navigation View: 'feed' or 'matrix'
  const [activeTab, setActiveTab] = useState<'feed' | 'matrix'>('feed');

  // Search & Filter State - SIT is default environment as requested
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEnv, setSelectedEnv] = useState<'All' | 'Prod' | 'UAT' | 'SIT'>('SIT');
  const [selectedStatus, setSelectedStatus] = useState<'All' | 'SUCCESS' | 'PENDING' | 'FAILED'>('All');
  const [selectedUser, setSelectedUser] = useState<'All' | 'A.Hameed' | 'Hanzala'>('All');
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [showApiHelper, setShowApiHelper] = useState(false);

  // Edit Modal State
  const [editingRecord, setEditingRecord] = useState<ReleaseRecord | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Accordion Expand/Collapse State for Deployment Audit Log
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Real-time Supabase subscription
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
      const channel = supabase
        .channel('schema-db-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'ReleaseRecord' },
          (payload) => {
            if (payload.eventType === 'INSERT' && payload.new && onNewRecordReceived) {
              onNewRecordReceived(payload.new as ReleaseRecord);
            } else if (payload.eventType === 'UPDATE' && payload.new && onRecordUpdated) {
              onRecordUpdated(payload.new as ReleaseRecord);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.warn('Real-time subscription notice:', err);
    }
  }, [onNewRecordReceived, onRecordUpdated]);

  const handleEditClick = (record: ReleaseRecord) => {
    setEditingRecord(record);
    setIsEditModalOpen(true);
  };

  const handleUpdateSuccess = (updatedRecord: ReleaseRecord) => {
    if (onRecordUpdated) {
      onRecordUpdated(updatedRecord);
    }
  };

  // Environment Drift Matrix Computation
  // CRITICAL REQUIREMENT: Must ONLY display the latest version of records where status === 'SUCCESS'
  const matrixData = useMemo(() => {
    // 1. Filter ONLY records where status === 'SUCCESS'
    const successRecords = records.filter(
      (r) => String(r.status || '').toUpperCase() === 'SUCCESS'
    );

    // 2. Sort by creation date descending to ensure first match is the latest
    const sorted = [...successRecords].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    interface ServiceMatrixEntry {
      server: string;
      service: string;
      sitRecord?: ReleaseRecord;
      uatRecord?: ReleaseRecord;
      prodRecord?: ReleaseRecord;
    }

    const serviceMap = new Map<string, ServiceMatrixEntry>();

    // Also include services from all records so services without success still appear in matrix
    records.forEach((r) => {
      const key = `${r.server}::${r.service}`;
      if (!serviceMap.has(key)) {
        serviceMap.set(key, { server: r.server, service: r.service });
      }
    });

    // Populate latest SUCCESS record per environment
    for (const r of sorted) {
      const key = `${r.server}::${r.service}`;
      const entry: ServiceMatrixEntry = serviceMap.get(key) || { server: r.server, service: r.service };
      const envUpper = (r.environment || '').toUpperCase();

      if (envUpper.includes('SIT') && !entry.sitRecord) {
        entry.sitRecord = r;
      } else if (envUpper.includes('UAT') && !entry.uatRecord) {
        entry.uatRecord = r;
      } else if (envUpper.includes('PROD') && !entry.prodRecord) {
        entry.prodRecord = r;
      }
      serviceMap.set(key, entry);
    }

    return Array.from(serviceMap.values()).map((item) => {
      const sitVer = item.sitRecord?.version;
      const uatVer = item.uatRecord?.version;
      const prodVer = item.prodRecord?.version;

      const activeVersions = [sitVer, uatVer, prodVer].filter(Boolean) as string[];
      const uniqueVersions = Array.from(new Set(activeVersions));

      let syncStatus: 'IN_SYNC' | 'DRIFT_DETECTED' | 'NO_RELEASES' = 'NO_RELEASES';
      if (activeVersions.length > 1 && uniqueVersions.length > 1) {
        syncStatus = 'DRIFT_DETECTED';
      } else if (activeVersions.length > 0) {
        syncStatus = 'IN_SYNC';
      }

      return {
        ...item,
        sitVersion: sitVer || null,
        uatVersion: uatVer || null,
        prodVersion: prodVer || null,
        syncStatus,
      };
    });
  }, [records]);

  // Filtering records for the Feed view
  const filteredRecords = records.filter((r) => {
    // Environment filter
    if (selectedEnv !== 'All') {
      if (r.environment.toUpperCase() !== selectedEnv.toUpperCase()) {
        return false;
      }
    }

    // Status filter - Strict uppercase standard
    if (selectedStatus !== 'All') {
      const recStatus = String(r.status || 'PENDING').toUpperCase();
      if (recStatus !== selectedStatus) {
        return false;
      }
    }

    // User filter
    if (selectedUser !== 'All') {
      const rUser = (r.added_by || '').toLowerCase();
      const sUser = selectedUser.toLowerCase();
      if (!rUser.includes(sUser) && !sUser.includes(rUser)) {
        return false;
      }
    }

    // Search query: filtering by service, environment, developer name, server, or notes
    if (searchQuery.trim()) {
      const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const matchesAllTokens = tokens.every((token) => {
        const matchService = r.service.toLowerCase().includes(token);
        const matchEnv = r.environment.toLowerCase().includes(token);
        const matchDev = (r.developerName || '').toLowerCase().includes(token);
        const matchServer = r.server.toLowerCase().includes(token);
        const matchStatus = (r.status || '').toLowerCase().includes(token);
        const matchVersion = (r.version || '').toLowerCase().includes(token);
        const matchNote = r.note?.toLowerCase().includes(token) || false;
        const matchUser = r.added_by.toLowerCase().includes(token);

        return (
          matchService ||
          matchEnv ||
          matchDev ||
          matchServer ||
          matchStatus ||
          matchVersion ||
          matchNote ||
          matchUser
        );
      });

      if (!matchesAllTokens) {
        return false;
      }
    }

    return true;
  });

  const curlSnippet = `curl -X POST "${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/records" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer your-enterprise-release-api-secret" \\
  -d '{
    "environment": "Prod",
    "server": "Bot-Builder",
    "service": "bot-builder-api",
    "version": "v1.0.2",
    "developerName": "Sufyan Tariq",
    "status": "SUCCESS",
    "isBuildUpdate": true,
    "source": "Teams Group",
    "added_by": "A.Hameed",
    "note": "Production deployment verified"
  }'`;

  const handleCopyCurl = () => {
    navigator.clipboard.writeText(curlSnippet);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-zinc-800/80 mb-6">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Enterprise Release Tracker
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Real-time deployment audit log & cross-environment version matrix.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            id="btn-show-api-info"
            onClick={() => setShowApiHelper(!showApiHelper)}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-zinc-300 bg-[#111111] hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-colors"
          >
            <Code2 className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
            CLI / API Spec
          </button>
          <button
            id="btn-refresh-feed"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 text-zinc-400 hover:text-white bg-[#111111] hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-colors disabled:opacity-50"
            title="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
          <button
            id="btn-add-record-top"
            onClick={onAddRecord}
            className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-lg shadow-emerald-950/40 transition-all"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Log Release
          </button>
        </div>
      </div>

      {/* CLI / API cURL Helper Dropdown */}
      {showApiHelper && (
        <div className="mb-6 p-5 bg-[#111111] rounded-2xl border border-zinc-800 text-slate-200 shadow-2xl animate-in fade-in duration-150">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Write-Path Endpoint (POST /api/records) with Version & Uppercase Status
              </span>
            </div>
            <button
              id="btn-copy-curl-code"
              onClick={handleCopyCurl}
              className="inline-flex items-center px-3 py-1 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 transition-colors"
            >
              {copiedCurl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400 mr-1" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  <span>Copy cURL</span>
                </>
              )}
            </button>
          </div>
          <pre className="text-xs font-mono text-emerald-400 bg-black/60 p-4 rounded-xl overflow-x-auto whitespace-pre-wrap border border-zinc-800">
            {curlSnippet}
          </pre>
        </div>
      )}

      {/* Top Search Bar */}
      <div className="bg-[#111111] rounded-2xl border border-zinc-800 shadow-xl p-4 mb-6">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
            <Search className="w-5 h-5 text-emerald-400" />
          </div>
          <input
            id="input-top-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search records by service, environment (Prod, UAT, SIT), developer name, or version..."
            className="w-full pl-11 pr-10 py-2.5 sm:py-3 bg-[#18181b] hover:bg-[#1f1f23] focus:bg-[#18181b] border border-zinc-800 focus:border-emerald-500 rounded-xl text-sm sm:text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium"
          />
          {searchQuery && (
            <button
              id="btn-clear-top-search"
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-zinc-500 hover:text-white transition-colors"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Filter Search Hints */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="font-semibold text-zinc-500 uppercase tracking-wider text-[11px]">
              Quick filter:
            </span>
            <button
              type="button"
              onClick={() => setSearchQuery('bot-builder-api')}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 border border-zinc-700/60 transition-colors"
            >
              <Server className="w-3 h-3 text-emerald-400" />
              <span>bot-builder-api</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchQuery('Prod')}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-950/40 text-rose-300 hover:bg-rose-900/50 border border-rose-800/50 transition-colors"
            >
              <Layers className="w-3 h-3 text-rose-400" />
              <span>Prod</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchQuery('Sufyan')}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 border border-emerald-800/50 transition-colors"
            >
              <User className="w-3 h-3 text-emerald-400" />
              <span>Sufyan</span>
            </button>
          </div>

          <div className="text-zinc-400 font-medium">
            {searchQuery.trim() || selectedEnv !== 'All' || selectedStatus !== 'All' || selectedUser !== 'All' ? (
              <span>
                Showing <strong className="text-emerald-400 font-bold">{filteredRecords.length}</strong> of{' '}
                {records.length} records{selectedEnv !== 'All' && <span className="text-blue-400 font-semibold ml-1">({selectedEnv})</span>}
              </span>
            ) : (
              <span>{records.length} total releases logged</span>
            )}
          </div>
        </div>
      </div>

      {/* Analytics & Stats Bar */}
      <StatsBar records={records} />

      {/* View Switcher Tabs: Activity Feed vs Environment Drift Matrix */}
      <div className="flex items-center space-x-2 mb-6 border-b border-zinc-800/80 pb-3">
        <button
          id="tab-activity-feed"
          onClick={() => setActiveTab('feed')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            activeTab === 'feed'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
              : 'bg-[#111111] text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Deployment Audit Log</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] bg-black/40 text-zinc-200">
            {filteredRecords.length}
          </span>
        </button>

        <button
          id="tab-drift-matrix"
          onClick={() => setActiveTab('matrix')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            activeTab === 'matrix'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
              : 'bg-[#111111] text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <Table className="w-4 h-4" />
          <span>Environment Drift Matrix</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] bg-black/40 text-emerald-300">
            SUCCESS Only
          </span>
        </button>
      </div>

      {/* TAB 1: ENVIRONMENT DRIFT MATRIX */}
      {activeTab === 'matrix' && (
        <div className="bg-[#111111] rounded-2xl border border-zinc-800 shadow-2xl p-5 sm:p-6 mb-8 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80 mb-5">
            <div>
              <div className="flex items-center space-x-2">
                <Table className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Environment Drift Matrix
                </h2>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Displays <strong>ONLY</strong> the latest version of records where{' '}
                <code className="text-emerald-400 font-semibold">status === 'SUCCESS'</code>.
                Identifies version divergence between SIT, UAT, and Production.
              </p>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <span className="inline-flex items-center space-x-1 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>In Sync</span>
              </span>
              <span className="inline-flex items-center space-x-1 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Drift Detected</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Server / Service</th>
                  <th className="pb-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-blue-950/40 text-blue-300 border border-blue-800/40">
                      SIT
                    </span>
                  </th>
                  <th className="pb-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-purple-950/40 text-purple-300 border border-purple-800/40">
                      UAT
                    </span>
                  </th>
                  <th className="pb-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-800/40">
                      Prod
                    </span>
                  </th>
                  <th className="pb-3 pl-4 text-right">Drift Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {matrixData.map((row) => (
                  <tr key={`${row.server}-${row.service}`} className="hover:bg-zinc-800/20 transition-colors">
                    {/* Service & Server Column */}
                    <td className="py-3.5 pr-4">
                      <div className="font-semibold text-white">{row.service}</div>
                      <div className="text-xs font-mono text-zinc-500">{row.server}</div>
                    </td>

                    {/* SIT Cell */}
                    <td className="py-3.5 px-4">
                      {row.sitVersion ? (
                        <div
                          onClick={() => row.sitRecord && handleEditClick(row.sitRecord)}
                          className="cursor-pointer group inline-flex flex-col"
                          title="Click to view/edit SIT release"
                        >
                          <span className="inline-flex items-center space-x-1 text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-blue-950/30 text-blue-300 border border-blue-800/40 group-hover:border-blue-500">
                            <Tag className="w-3 h-3 text-blue-400" />
                            <span>{row.sitVersion}</span>
                          </span>
                          <span className="text-[10px] text-zinc-500 mt-0.5">
                            by {row.sitRecord?.developerName || 'Dev'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600 font-mono">—</span>
                      )}
                    </td>

                    {/* UAT Cell */}
                    <td className="py-3.5 px-4">
                      {row.uatVersion ? (
                        <div
                          onClick={() => row.uatRecord && handleEditClick(row.uatRecord)}
                          className="cursor-pointer group inline-flex flex-col"
                          title="Click to view/edit UAT release"
                        >
                          <span className="inline-flex items-center space-x-1 text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-purple-950/30 text-purple-300 border border-purple-800/40 group-hover:border-purple-500">
                            <Tag className="w-3 h-3 text-purple-400" />
                            <span>{row.uatVersion}</span>
                          </span>
                          <span className="text-[10px] text-zinc-500 mt-0.5">
                            by {row.uatRecord?.developerName || 'Dev'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600 font-mono">—</span>
                      )}
                    </td>

                    {/* Prod Cell */}
                    <td className="py-3.5 px-4">
                      {row.prodVersion ? (
                        <div
                          onClick={() => row.prodRecord && handleEditClick(row.prodRecord)}
                          className="cursor-pointer group inline-flex flex-col"
                          title="Click to view/edit Prod release"
                        >
                          <span className="inline-flex items-center space-x-1 text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-950/30 text-emerald-300 border border-emerald-800/40 group-hover:border-emerald-500">
                            <Tag className="w-3 h-3 text-emerald-400" />
                            <span>{row.prodVersion}</span>
                          </span>
                          <span className="text-[10px] text-zinc-500 mt-0.5">
                            by {row.prodRecord?.developerName || 'Dev'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600 font-mono">—</span>
                      )}
                    </td>

                    {/* Drift Status Indicator */}
                    <td className="py-3.5 pl-4 text-right">
                      {row.syncStatus === 'IN_SYNC' && (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>In Sync</span>
                        </span>
                      )}
                      {row.syncStatus === 'DRIFT_DETECTED' && (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-950/40 text-amber-400 border border-amber-800/40">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Drift Detected</span>
                        </span>
                      )}
                      {row.syncStatus === 'NO_RELEASES' && (
                        <span className="text-xs text-zinc-600">No Success Releases</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: RELEASE ACTIVITY FEED */}
      {activeTab === 'feed' && (
        <>
          {/* Quick Filter Attributes Toolbar */}
          <div className="bg-[#111111] p-4 rounded-2xl border border-zinc-800 shadow-xl mb-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                  Filter Attributes
                </span>
              </div>

              {/* Logged By User Filter */}
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex-shrink-0">
                  Logged By:
                </span>
                <div className="inline-flex rounded-xl p-1 bg-[#18181b] border border-zinc-800 text-xs font-medium">
                  {(['All', 'A.Hameed', 'Hanzala'] as const).map((usr) => (
                    <button
                      key={usr}
                      id={`btn-filter-user-${usr.replace('.', '')}`}
                      onClick={() => setSelectedUser(usr)}
                      className={`px-3 py-1 rounded-lg transition-colors ${
                        selectedUser === usr
                          ? 'bg-zinc-800 text-white font-bold shadow-xs'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {usr}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Filter Pills: Environment & Strict Uppercase Status */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-800/80 text-xs">
              {/* Environment Filter Pills */}
              <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
                <span className="font-semibold text-zinc-400 uppercase tracking-wider">
                  Environment:
                </span>
                <div className="flex items-center space-x-1.5">
                  {(['All', 'Prod', 'UAT', 'SIT'] as const).map((env) => {
                    const isActive = selectedEnv === env;
                    let activeStyle = 'bg-emerald-600 text-white';
                    if (env === 'Prod') activeStyle = 'bg-rose-600 text-white';
                    if (env === 'UAT') activeStyle = 'bg-purple-600 text-white';
                    if (env === 'SIT') activeStyle = 'bg-blue-600 text-white';

                    return (
                      <button
                        key={env}
                        id={`btn-filter-env-${env}`}
                        onClick={() => setSelectedEnv(env)}
                        className={`px-3 py-1 rounded-xl font-semibold transition-all ${
                          isActive
                            ? activeStyle
                            : 'bg-[#18181b] text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        {env === 'All' ? 'All Envs' : env}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Status Filter Pills - Strictly Uppercase Standard */}
              <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
                <span className="font-semibold text-zinc-400 uppercase tracking-wider">
                  Status:
                </span>
                <div className="flex items-center space-x-1.5">
                  {(['All', 'SUCCESS', 'PENDING', 'FAILED'] as const).map((st) => {
                    const isActive = selectedStatus === st;
                    let activeStyle = 'bg-zinc-700 text-white';
                    if (st === 'SUCCESS') activeStyle = 'bg-emerald-600 text-white';
                    if (st === 'PENDING') activeStyle = 'bg-amber-600 text-white';
                    if (st === 'FAILED') activeStyle = 'bg-rose-600 text-white';

                    return (
                      <button
                        key={st}
                        id={`btn-filter-status-${st}`}
                        onClick={() => setSelectedStatus(st)}
                        className={`px-3 py-1 rounded-xl font-semibold transition-all ${
                          isActive
                            ? activeStyle
                            : 'bg-[#18181b] text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        {st === 'All' ? 'All Statuses' : st}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Feed List or Empty State */}
          {filteredRecords.length === 0 ? (
            <div className="bg-[#111111] rounded-2xl border border-zinc-800 p-12 text-center shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500 flex items-center justify-center mx-auto mb-4">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                No Release Records Found
              </h3>
              <p className="mt-1 text-sm text-zinc-400 max-w-sm mx-auto">
                No releases match your current active filters. Try resetting search or status filters.
              </p>
              <div className="mt-5">
                <button
                  id="btn-reset-filters"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedEnv('All');
                    setSelectedStatus('All');
                    setSelectedUser('All');
                  }}
                  className="inline-flex items-center px-4 py-2 text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 hover:text-white rounded-xl transition-colors"
                >
                  Reset All Filters
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
                <span>
                  Showing <strong className="text-white">{filteredRecords.length}</strong> of{' '}
                  {records.length} deployment records
                </span>
                <span className="text-zinc-500 text-[11px]">Click any row to expand details</span>
              </div>
              <div className="space-y-2.5">
                {filteredRecords.map((record) => (
                  <ReleaseCard
                    key={record.id}
                    record={record}
                    isExpanded={expandedRowId === record.id}
                    onToggle={() =>
                      setExpandedRowId((prev) => (prev === record.id ? null : record.id))
                    }
                    onEdit={handleEditClick}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Dark-themed Shadcn-style Edit Record Modal */}
      <EditRecordModal
        record={editingRecord}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingRecord(null);
        }}
        onUpdateSuccess={handleUpdateSuccess}
      />
    </div>
  );
};
