import React, { useState, useMemo } from 'react';
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
  ChevronDown,
  Table,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';
import { ReleaseCard } from './ReleaseCard';
import { StatsBar } from './StatsBar';
import { EditRecordModal } from './EditRecordModal';

interface DashboardViewProps {
  records: ReleaseRecord[];
  onAddRecord: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
  onRecordUpdated?: (record: ReleaseRecord) => void;
}

type EnvFilter = 'All' | 'SIT' | 'UAT' | 'Prod';
type StatusFilter = 'All' | 'SUCCESS' | 'PENDING' | 'FAILED';
type UserFilter = 'All' | 'A.Hameed' | 'Hanzala';

/**
 * Native <select> in a dark shell. Native keeps keyboard/mobile behaviour and
 * screen-reader semantics for free; the chevron is drawn by us so it matches
 * the rest of the theme.
 */
const FilterSelect = <T extends string>({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  /** Wording for the "All" option — spelled out rather than pluralizing `label`. */
  allLabel: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) => (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor={id}
      className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
    >
      {label}
    </label>
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/[0.03] py-2 pl-3 pr-9 text-sm font-medium text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.05] focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
      >
        {options.map((opt) => (
          <option key={opt} value={opt} className="bg-[#111111] text-zinc-200">
            {opt === 'All' ? allLabel : opt}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
    </div>
  </div>
);

/** Version chip in the drift matrix. Highlighted when it diverges from the row baseline. */
const MatrixVersion: React.FC<{
  version: string | null;
  diverges: boolean;
  onClick?: () => void;
}> = ({ version, diverges, onClick }) => {
  if (!version) {
    return <span className="font-mono text-xs text-zinc-700">—</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={diverges ? `${version} — differs from the rest of this row` : version}
      className={`rounded-md border px-2 py-1 font-mono text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
        diverges
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-400/60'
          : 'border-white/5 bg-white/[0.03] text-zinc-100 hover:border-white/20'
      }`}
    >
      {version}
    </button>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  records,
  onAddRecord,
  onRefresh,
  isLoading = false,
  onRecordUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'feed' | 'matrix'>('feed');

  // Filters. Environment defaults to SIT, matching the previously requested behaviour.
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEnv, setSelectedEnv] = useState<EnvFilter>('SIT');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('All');
  const [selectedUser, setSelectedUser] = useState<UserFilter>('All');

  const [copiedCurl, setCopiedCurl] = useState(false);
  const [showApiHelper, setShowApiHelper] = useState(false);

  const [editingRecord, setEditingRecord] = useState<ReleaseRecord | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const handleEditClick = (record: ReleaseRecord) => {
    setEditingRecord(record);
    setIsEditModalOpen(true);
  };

  const handleUpdateSuccess = (updatedRecord: ReleaseRecord) => {
    onRecordUpdated?.(updatedRecord);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedEnv('All');
    setSelectedStatus('All');
    setSelectedUser('All');
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedEnv !== 'All' ||
    selectedStatus !== 'All' ||
    selectedUser !== 'All';

  // ── Environment Drift Matrix ───────────────────────────────────────────────
  // Shows ONLY the latest record per environment where status === 'SUCCESS'.
  const matrixData = useMemo(() => {
    const successRecords = records.filter(
      (r) => String(r.status || '').toUpperCase() === 'SUCCESS'
    );

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

    // Seed from all records so services without a SUCCESS release still appear.
    records.forEach((r) => {
      const key = `${r.server}::${r.service}`;
      if (!serviceMap.has(key)) {
        serviceMap.set(key, { server: r.server, service: r.service });
      }
    });

    for (const r of sorted) {
      const key = `${r.server}::${r.service}`;
      const entry: ServiceMatrixEntry =
        serviceMap.get(key) || { server: r.server, service: r.service };
      const envUpper = (r.environment || '').toUpperCase();

      if (envUpper.includes('SIT') && !entry.sitRecord) entry.sitRecord = r;
      else if (envUpper.includes('UAT') && !entry.uatRecord) entry.uatRecord = r;
      else if (envUpper.includes('PROD') && !entry.prodRecord) entry.prodRecord = r;

      serviceMap.set(key, entry);
    }

    return Array.from(serviceMap.values()).map((item) => {
      const sitVersion = item.sitRecord?.version || null;
      const uatVersion = item.uatRecord?.version || null;
      const prodVersion = item.prodRecord?.version || null;

      const activeVersions = [sitVersion, uatVersion, prodVersion].filter(Boolean) as string[];
      const uniqueVersions = Array.from(new Set(activeVersions));

      let syncStatus: 'IN_SYNC' | 'DRIFT_DETECTED' | 'NO_RELEASES' = 'NO_RELEASES';
      if (activeVersions.length > 1 && uniqueVersions.length > 1) syncStatus = 'DRIFT_DETECTED';
      else if (activeVersions.length > 0) syncStatus = 'IN_SYNC';

      // Baseline = the version the row is measured against; everything else is drift.
      // Most frequent version wins. On a tie, prefer Prod, then UAT, then SIT, so the
      // highlight reads as "this differs from production" rather than picking arbitrarily.
      let baseline: string | null = null;
      if (activeVersions.length > 0) {
        const counts = new Map<string, number>();
        activeVersions.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
        const topCount = Math.max(...counts.values());
        const tied = Array.from(counts.entries())
          .filter(([, count]) => count === topCount)
          .map(([version]) => version);
        baseline =
          [prodVersion, uatVersion, sitVersion].find((v) => v && tied.includes(v)) ?? tied[0];
      }

      const diverges = (v: string | null) =>
        syncStatus === 'DRIFT_DETECTED' && v !== null && v !== baseline;

      return {
        ...item,
        sitVersion,
        uatVersion,
        prodVersion,
        syncStatus,
        sitDiverges: diverges(sitVersion),
        uatDiverges: diverges(uatVersion),
        prodDiverges: diverges(prodVersion),
      };
    });
  }, [records]);

  const driftCount = useMemo(
    () => matrixData.filter((r) => r.syncStatus === 'DRIFT_DETECTED').length,
    [matrixData]
  );

  // ── Feed filtering ─────────────────────────────────────────────────────────
  const filteredRecords = useMemo(() => {
    const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);

    return records
      .filter((r) => {
        if (selectedEnv !== 'All' && r.environment.toUpperCase() !== selectedEnv.toUpperCase()) {
          return false;
        }

        if (selectedStatus !== 'All') {
          if (String(r.status || 'PENDING').toUpperCase() !== selectedStatus) return false;
        }

        if (selectedUser !== 'All') {
          const rUser = (r.added_by || '').toLowerCase();
          const sUser = selectedUser.toLowerCase();
          if (!rUser.includes(sUser) && !sUser.includes(rUser)) return false;
        }

        if (tokens.length > 0) {
          const haystack = [
            r.service,
            r.server,
            r.environment,
            r.developerName,
            r.status,
            r.version,
            r.note,
            r.added_by,
            r.source,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!tokens.every((token) => haystack.includes(token))) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [records, searchQuery, selectedEnv, selectedStatus, selectedUser]);

  const curlSnippet = `curl -X POST "${
    typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'
  }/api/records" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_SECRET_KEY" \\
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

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
      active
        ? 'bg-white/[0.06] text-white'
        : 'text-zinc-500 hover:bg-white/[0.02] hover:text-zinc-300'
    }`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Page header ── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Release Tracker
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            Deployment audit log and cross-environment version matrix.
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            id="btn-show-api-info"
            onClick={() => setShowApiHelper((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <Code2 className="h-3.5 w-3.5" />
            API
          </button>
          <button
            id="btn-refresh-feed"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh feed"
            className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
          <button
            id="btn-add-record-top"
            onClick={onAddRecord}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <Plus className="h-4 w-4" />
            Log Release
          </button>
        </div>
      </div>

      {/* ── API helper ── */}
      {showApiHelper && (
        <div className="animate-panel mb-6 rounded-xl border border-white/5 bg-[#111111] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <Terminal className="h-3.5 w-3.5 text-emerald-400" />
              POST /api/records
            </span>
            <button
              id="btn-copy-curl-code"
              onClick={handleCopyCurl}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              {copiedCurl ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
          <pre className="scrollbar-subtle overflow-x-auto rounded-lg border border-white/5 bg-black/60 p-4 font-mono text-[11px] leading-relaxed text-emerald-400">
            {curlSnippet}
          </pre>
        </div>
      )}

      {/* ── Stats ── */}
      <StatsBar records={records} />

      {/* ── Filter bar ── */}
      <div className="mb-6 rounded-xl border border-white/5 bg-[#111111] p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          {/* Search */}
          <div className="flex flex-col gap-1.5 md:col-span-5">
            <label
              htmlFor="input-top-search"
              className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
            >
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="input-top-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Service, server, or developer..."
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] py-2 pl-9 pr-9 text-sm text-white placeholder-zinc-600 transition-colors hover:border-white/20 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              {searchQuery && (
                <button
                  id="btn-clear-top-search"
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="md:col-span-2">
            <FilterSelect
              id="select-filter-env"
              label="Environment"
              allLabel="All environments"
              value={selectedEnv}
              options={['All', 'SIT', 'UAT', 'Prod'] as const}
              onChange={setSelectedEnv}
            />
          </div>

          <div className="md:col-span-2">
            <FilterSelect
              id="select-filter-status"
              label="Status"
              allLabel="All statuses"
              value={selectedStatus}
              options={['All', 'SUCCESS', 'PENDING', 'FAILED'] as const}
              onChange={setSelectedStatus}
            />
          </div>

          <div className="md:col-span-3">
            <FilterSelect
              id="select-filter-user"
              label="Logged by"
              allLabel="Anyone"
              value={selectedUser}
              options={['All', 'A.Hameed', 'Hanzala'] as const}
              onChange={setSelectedUser}
            />
          </div>
        </div>

        {/* Result count + active filter reset */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs">
          <span className="text-zinc-500">
            Showing <strong className="font-semibold text-white">{filteredRecords.length}</strong>{' '}
            of {records.length} records
          </span>
          {hasActiveFilters && (
            <button
              id="btn-reset-filters"
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 font-medium text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
            >
              <Filter className="h-3 w-3" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="mb-5 flex items-center gap-1 border-b border-white/5 pb-3">
        <button id="tab-activity-feed" onClick={() => setActiveTab('feed')} className={tabClass(activeTab === 'feed')}>
          <Layers className="h-4 w-4" />
          Audit Log
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[11px] text-zinc-400">
            {filteredRecords.length}
          </span>
        </button>
        <button id="tab-drift-matrix" onClick={() => setActiveTab('matrix')} className={tabClass(activeTab === 'matrix')}>
          <Table className="h-4 w-4" />
          Drift Matrix
          {driftCount > 0 && (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
              {driftCount}
            </span>
          )}
        </button>
      </div>

      {/* ── TAB: Drift matrix ── */}
      {activeTab === 'matrix' && (
        <div className="animate-panel overflow-hidden rounded-xl border border-white/5 bg-[#111111]">
          <div className="flex flex-col gap-3 border-b border-white/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-white">
                Environment Drift Matrix
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Latest <span className="font-mono text-emerald-400">SUCCESS</span> release per
                environment. Amber marks a version that diverges from the rest of its row.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                In sync
              </span>
              <span className="inline-flex items-center gap-1.5 text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Drift
              </span>
            </div>
          </div>

          <div className="scrollbar-subtle overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="py-3 pl-5 pr-4">Service</th>
                  <th className="px-4 py-3">SIT</th>
                  <th className="px-4 py-3">UAT</th>
                  <th className="px-4 py-3">Prod</th>
                  <th className="py-3 pl-4 pr-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {matrixData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-zinc-500">
                      No services tracked yet.
                    </td>
                  </tr>
                ) : (
                  matrixData.map((row) => (
                    <tr
                      key={`${row.server}-${row.service}`}
                      className="transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="py-3.5 pl-5 pr-4">
                        <div className="font-mono text-sm font-medium text-white">
                          {row.service}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">{row.server}</div>
                      </td>

                      <td className="px-4 py-3.5">
                        <MatrixVersion
                          version={row.sitVersion}
                          diverges={row.sitDiverges}
                          onClick={() => row.sitRecord && handleEditClick(row.sitRecord)}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <MatrixVersion
                          version={row.uatVersion}
                          diverges={row.uatDiverges}
                          onClick={() => row.uatRecord && handleEditClick(row.uatRecord)}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <MatrixVersion
                          version={row.prodVersion}
                          diverges={row.prodDiverges}
                          onClick={() => row.prodRecord && handleEditClick(row.prodRecord)}
                        />
                      </td>

                      <td className="py-3.5 pl-4 pr-5 text-right">
                        {row.syncStatus === 'IN_SYNC' && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />
                            In sync
                          </span>
                        )}
                        {row.syncStatus === 'DRIFT_DETECTED' && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            Drift
                          </span>
                        )}
                        {row.syncStatus === 'NO_RELEASES' && (
                          <span className="text-[11px] text-zinc-600">No releases</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: Audit log feed ── */}
      {activeTab === 'feed' && (
        <>
          {filteredRecords.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-[#111111] px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/5 bg-white/[0.03] text-zinc-600">
                <Layers className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold text-white">No releases found</h3>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-zinc-500">
                {hasActiveFilters
                  ? 'No releases match the current filters.'
                  : 'Nothing has been logged yet.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Clear filters
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
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
          )}
        </>
      )}

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
