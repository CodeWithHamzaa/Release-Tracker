import React, { useState, useEffect } from 'react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEnv, setSelectedEnv] = useState<'All' | 'Prod' | 'UAT' | 'SIT'>('All');
  const [selectedStatus, setSelectedStatus] = useState<'All' | 'Success' | 'Pending' | 'Failed'>('All');
  const [selectedUser, setSelectedUser] = useState<'All' | 'A.Hameed' | 'Hanzala'>('All');
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [showApiHelper, setShowApiHelper] = useState(false);

  // Edit Modal State
  const [editingRecord, setEditingRecord] = useState<ReleaseRecord | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

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

  // Filtering records
  const filteredRecords = records.filter((r) => {
    // Environment filter
    if (selectedEnv !== 'All') {
      if (r.environment.toLowerCase() !== selectedEnv.toLowerCase()) {
        return false;
      }
    }

    // Status filter
    if (selectedStatus !== 'All') {
      const recStatus = (r.status || 'Pending').toLowerCase();
      if (recStatus !== selectedStatus.toLowerCase()) {
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
        const matchNote = r.note?.toLowerCase().includes(token) || false;
        const matchCommands = r.commandDetails?.toLowerCase().includes(token) || false;
        const matchSource = r.source.toLowerCase().includes(token);
        const matchUser = r.added_by.toLowerCase().includes(token);

        return (
          matchService ||
          matchEnv ||
          matchDev ||
          matchServer ||
          matchStatus ||
          matchNote ||
          matchCommands ||
          matchSource ||
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
    "developerName": "Sufyan Tariq",
    "status": "Success",
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
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Enterprise Release Tracker
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Real-time audit log of deployments across SIT, UAT, and Production environments.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            id="btn-show-api-info"
            onClick={() => setShowApiHelper(!showApiHelper)}
            className="inline-flex items-center px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-xs transition-colors"
          >
            <Code2 className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
            CLI / API Spec
          </button>
          <button
            id="btn-refresh-feed"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            title="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            id="btn-add-record-top"
            onClick={onAddRecord}
            className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Log Release
          </button>
        </div>
      </div>

      {/* CLI / Write-Path API Quick Reference Box */}
      {showApiHelper && (
        <div className="mb-6 p-5 bg-slate-900 rounded-xl border border-slate-800 text-slate-100 shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Single Write-Path API (POST /api/records) - With Developer Attribution
              </span>
            </div>
            <button
              id="btn-copy-curl-code"
              onClick={handleCopyCurl}
              className="inline-flex items-center px-2.5 py-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors"
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
          <pre className="text-xs font-mono text-emerald-300 bg-black/40 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap border border-slate-800">
            {curlSnippet}
          </pre>
        </div>
      )}

      {/* Top Search Bar - Service, Environment, Developer Name */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 mb-6">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-5 h-5 text-blue-600" />
          </div>
          <input
            id="input-top-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search records by service, environment (Prod, UAT, SIT), or developer name..."
            className="w-full pl-11 pr-10 py-2.5 sm:py-3 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-sm sm:text-base text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20 transition-all outline-none font-medium"
          />
          {searchQuery && (
            <button
              id="btn-clear-top-search"
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-700 transition-colors"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Scope Indicators and Live Result Count */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
              Filters by:
            </span>
            <button
              type="button"
              onClick={() => setSearchQuery('bot-builder-api')}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
              title="Click to search by example service"
            >
              <Server className="w-3 h-3 text-blue-600" />
              <span>Service</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchQuery('Prod')}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-colors"
              title="Click to search by Prod environment"
            >
              <Layers className="w-3 h-3 text-purple-600" />
              <span>Environment</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchQuery('Sufyan')}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
              title="Click to search by developer name"
            >
              <User className="w-3 h-3 text-emerald-600" />
              <span>Developer Name</span>
            </button>
          </div>

          <div className="text-slate-500 font-medium">
            {searchQuery.trim() ? (
              <span>
                Matching <strong className="text-blue-600 font-bold">{filteredRecords.length}</strong> of{' '}
                {records.length} records
              </span>
            ) : (
              <span>{records.length} total releases tracked</span>
            )}
          </div>
        </div>
      </div>

      {/* Analytics & Stats Bar with Status Breakdown */}
      <StatsBar records={records} />

      {/* Filter Toolbar for Environment, Status, and Author */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs mb-6 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Quick Filter Attributes
            </span>
          </div>

          {/* User selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex-shrink-0">
              Logged By:
            </span>
            <div className="inline-flex rounded-lg p-1 bg-slate-100 border border-slate-200 text-xs font-medium">
              {(['All', 'A.Hameed', 'Hanzala'] as const).map((usr) => (
                <button
                  key={usr}
                  id={`btn-filter-user-${usr.replace('.', '')}`}
                  onClick={() => setSelectedUser(usr)}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    selectedUser === usr
                      ? 'bg-white text-slate-800 font-bold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {usr}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filter Pills: Environment & Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-slate-100 text-xs">
          {/* Environment Filter Pills */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="font-semibold text-slate-500 uppercase tracking-wider">
              Environment:
            </span>
            <div className="flex items-center space-x-1.5">
              {(['All', 'Prod', 'UAT', 'SIT'] as const).map((env) => {
                const isActive = selectedEnv === env;
                let activeStyle = 'bg-blue-600 text-white';
                if (env === 'Prod') activeStyle = 'bg-red-600 text-white';
                if (env === 'UAT') activeStyle = 'bg-purple-600 text-white';
                if (env === 'SIT') activeStyle = 'bg-blue-600 text-white';

                return (
                  <button
                    key={env}
                    id={`btn-filter-env-${env}`}
                    onClick={() => setSelectedEnv(env)}
                    className={`px-3 py-1 rounded-full font-semibold transition-colors ${
                      isActive
                        ? activeStyle
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {env === 'All' ? 'All' : env}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status Filter Pills */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="font-semibold text-slate-500 uppercase tracking-wider">
              Status:
            </span>
            <div className="flex items-center space-x-1.5">
              {(['All', 'Success', 'Pending', 'Failed'] as const).map((st) => {
                const isActive = selectedStatus === st;
                let activeStyle = 'bg-slate-800 text-white';
                if (st === 'Success') activeStyle = 'bg-emerald-600 text-white';
                if (st === 'Pending') activeStyle = 'bg-amber-600 text-white';
                if (st === 'Failed') activeStyle = 'bg-rose-600 text-white';

                return (
                  <button
                    key={st}
                    id={`btn-filter-status-${st}`}
                    onClick={() => setSelectedStatus(st)}
                    className={`px-3 py-1 rounded-full font-semibold transition-colors ${
                      isActive
                        ? activeStyle
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-800">
            No Release Records Found
          </h3>
          <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
            No releases match your current active filters. Try resetting your search or filters.
          </p>
          <div className="mt-4">
            <button
              id="btn-reset-filters"
              onClick={() => {
                setSearchQuery('');
                setSelectedEnv('All');
                setSelectedStatus('All');
                setSelectedUser('All');
              }}
              className="inline-flex items-center px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>
              Showing {filteredRecords.length} of {records.length} total releases
            </span>
            <span>Sorted by Most Recent</span>
          </div>
          {filteredRecords.map((record) => (
            <ReleaseCard
              key={record.id}
              record={record}
              onEdit={handleEditClick}
            />
          ))}
        </div>
      )}

      {/* Edit Record Modal */}
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
