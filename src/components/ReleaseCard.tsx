import React, { useState } from 'react';
import {
  Server,
  Pencil,
  FileCode,
  Sliders,
  Terminal,
  Clock,
  Copy,
  Check,
  ChevronDown,
  Tag,
} from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';

export interface ReleaseCardProps {
  record: ReleaseRecord;
  isExpanded?: boolean;
  onToggle?: () => void;
  onEdit?: (record: ReleaseRecord) => void;
}

// Generate 1-2 letter initials for developer avatar circle
function getInitials(name?: string | null): string {
  if (!name) return 'DV';
  const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const ReleaseCard: React.FC<ReleaseCardProps> = ({
  record,
  isExpanded: controlledExpanded,
  onToggle,
  onEdit,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Controlled or uncontrolled expansion state
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  // Status badge styling with pulsing dot
  const getStatusBadge = (statusInput: string = 'PENDING') => {
    const status = String(statusInput || 'PENDING').trim().toUpperCase();
    switch (status) {
      case 'SUCCESS':
        return {
          container: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40',
          dot: 'bg-emerald-400',
          ping: 'bg-emerald-400',
          label: 'SUCCESS',
        };
      case 'FAILED':
        return {
          container: 'bg-rose-950/40 text-rose-400 border-rose-800/40',
          dot: 'bg-rose-400',
          ping: 'bg-rose-400',
          label: 'FAILED',
        };
      case 'PENDING':
      default:
        return {
          container: 'bg-amber-950/40 text-amber-400 border-amber-800/40',
          dot: 'bg-amber-400',
          ping: 'bg-amber-400',
          label: 'PENDING',
        };
    }
  };

  // Environment badge colors
  const getEnvBadge = (env: string) => {
    const upper = (env || '').toUpperCase();
    if (upper.includes('PROD')) {
      return 'bg-rose-950/40 text-rose-300 border-rose-800/50';
    }
    if (upper.includes('UAT')) {
      return 'bg-purple-950/40 text-purple-300 border-purple-800/50';
    }
    return 'bg-blue-950/40 text-blue-300 border-blue-800/50';
  };

  const formatDate = (dateInput: string | Date) => {
    try {
      const d = new Date(dateInput);
      return {
        formatted: d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        timeAgo: getTimeAgo(d),
      };
    } catch {
      return { formatted: String(dateInput), timeAgo: '' };
    }
  };

  function getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const { formatted, timeAgo } = formatDate(record.createdAt);
  const statusInfo = getStatusBadge(record.status);

  const handleCopyCommands = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (record.commandDetails) {
      navigator.clipboard.writeText(record.commandDetails);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    }
  };

  return (
    <div
      id={`release-row-${record.id}`}
      onClick={handleToggle}
      className={`bg-[#111111] border border-white/5 hover:border-white/15 rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ease-in-out group select-none shadow-sm ${
        isExpanded ? 'ring-1 ring-emerald-500/20' : ''
      }`}
    >
      {/* 1. COLLAPSED STATE (Front View): Compact Essential Details */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5">
        {/* Left Side: Dev Name + Avatar Circle, Environment Pill, Purpose / Note */}
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          {/* Dev Name with Avatar Circle */}
          <div className="flex items-center space-x-2 flex-shrink-0">
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 flex items-center justify-center text-[11px] sm:text-xs font-bold flex-shrink-0 shadow-inner"
              title={record.developerName || record.added_by || 'Developer'}
            >
              {getInitials(record.developerName || record.added_by)}
            </div>
            <span className="text-xs sm:text-sm font-semibold text-zinc-200 whitespace-nowrap hidden sm:inline-block max-w-[120px] truncate">
              {record.developerName || record.added_by || 'Developer'}
            </span>
          </div>

          {/* Environment Pill/Badge */}
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-bold border uppercase tracking-wider flex-shrink-0 ${getEnvBadge(
              record.environment
            )}`}
          >
            {record.environment}
          </span>

          {/* Purpose / Note (truncated to one line) */}
          <div className="flex-1 min-w-0 pr-2">
            <p className="text-xs sm:text-sm text-zinc-300 truncate font-normal">
              {record.note ? (
                record.note
              ) : (
                <span className="text-zinc-500 italic">
                  {record.service} {record.version} deployment
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Right Side: Timestamp + ChevronDown Action Icon */}
        <div className="flex items-center space-x-3 flex-shrink-0">
          <span
            className="text-xs text-zinc-400 whitespace-nowrap font-medium flex items-center space-x-1"
            title={formatted}
          >
            <Clock className="w-3.5 h-3.5 text-zinc-500 hidden md:inline" />
            <span>{timeAgo || formatted}</span>
          </span>

          {/* Action Icon: ChevronDown with smooth rotation */}
          <div
            className={`p-1 text-zinc-400 group-hover:text-zinc-200 transition-transform duration-200 ease-in-out ${
              isExpanded ? 'rotate-180 text-emerald-400' : 'rotate-0'
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* 2. EXPANDED STATE: Full Details with bg-[#0a0a0a] border-t border-white/10 p-4 */}
      {isExpanded && (
        <div
          className="bg-[#0a0a0a] border-t border-white/10 p-4 sm:p-5 space-y-4 transition-all duration-200 ease-in-out"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Specifications Row */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-white/5">
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              {/* Server Name: The server field (bold) */}
              <div className="flex items-center space-x-1.5 bg-[#111111] px-3 py-1.5 rounded-lg border border-white/5">
                <Server className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-400 font-medium">Server:</span>
                <span className="text-xs sm:text-sm font-bold text-white tracking-tight font-mono">
                  {record.server}
                </span>
              </div>

              {/* Target Service */}
              <div className="flex items-center space-x-1.5 bg-[#111111] px-3 py-1.5 rounded-lg border border-white/5">
                <span className="text-xs text-zinc-400 font-medium">Target Service:</span>
                <span className="text-xs sm:text-sm font-semibold text-emerald-400 font-mono">
                  {record.service}
                </span>
              </div>

              {/* Build Version */}
              <div className="flex items-center space-x-1.5 bg-[#111111] px-3 py-1.5 rounded-lg border border-white/5">
                <Tag className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-400 font-medium">Build Version:</span>
                <span className="text-xs sm:text-sm font-mono font-bold text-zinc-200">
                  {record.version || 'v1.0.0'}
                </span>
              </div>

              {/* Status with Pulsing Dot */}
              <div className="flex items-center space-x-1.5">
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${statusInfo.container}`}
                >
                  <span className="relative flex h-2 w-2 mr-1.5">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusInfo.ping}`}
                    ></span>
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${statusInfo.dot}`}
                    ></span>
                  </span>
                  <span>{statusInfo.label}</span>
                </span>
              </div>
            </div>

            {/* Edit Button */}
            {onEdit && (
              <button
                type="button"
                id={`btn-edit-record-${record.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(record);
                }}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-emerald-600 text-zinc-300 hover:text-white border border-zinc-700 hover:border-emerald-500 transition-all duration-200 ease-in-out shadow-xs flex-shrink-0 self-start md:self-auto"
                title="Edit release details and status"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Record</span>
              </button>
            )}
          </div>

          {/* Full Purpose / Note */}
          {record.note && (
            <div className="p-3 rounded-lg bg-[#111111] border border-white/5 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Purpose / Release Note:
              </span>
              {record.note}
            </div>
          )}

          {/* Changes Included */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Changes Included:
              </span>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                {record.isBuildUpdate && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-950/40 text-emerald-300 border border-emerald-800/40">
                    <FileCode className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                    Build Update
                  </span>
                )}
                {record.isEnvUpdate && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-amber-950/40 text-amber-300 border border-amber-800/40">
                    <Sliders className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                    Env Configs
                  </span>
                )}
                {record.isConfigUpdate && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-950/40 text-indigo-300 border border-indigo-800/40">
                    <Sliders className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                    Config Update
                  </span>
                )}
                {record.hasCommands && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-200 border border-zinc-700">
                    <Terminal className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                    Commands
                  </span>
                )}
                {!record.isBuildUpdate &&
                  !record.isEnvUpdate &&
                  !record.isConfigUpdate &&
                  !record.hasCommands && (
                    <span className="text-xs text-zinc-500 italic">
                      Standard release package (no config flags)
                    </span>
                  )}
              </div>
            </div>

            {/* Env Details Expansion */}
            {record.isEnvUpdate && record.envDetails && (
              <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-lg text-xs space-y-1.5">
                <div className="font-bold text-amber-400 flex items-center space-x-1.5 uppercase tracking-wider text-[11px]">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>Environment Variables:</span>
                </div>
                <pre className="font-mono text-amber-200/90 whitespace-pre-wrap text-[11px] overflow-x-auto bg-black/50 p-2.5 rounded border border-amber-900/30">
                  {record.envDetails}
                </pre>
              </div>
            )}

            {/* Config Details Expansion */}
            {record.isConfigUpdate && record.configDetails && (
              <div className="p-3 bg-indigo-950/20 border border-indigo-800/40 rounded-lg text-xs space-y-1.5">
                <div className="font-bold text-indigo-400 flex items-center space-x-1.5 uppercase tracking-wider text-[11px]">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Configuration Updates:</span>
                </div>
                <p className="text-indigo-200/90 text-xs bg-black/50 p-2.5 rounded border border-indigo-900/30 font-mono">
                  {record.configDetails}
                </p>
              </div>
            )}

            {/* Deployment Commands with Copy Button */}
            {record.hasCommands && record.commandDetails && (
              <div className="rounded-lg border border-white/10 overflow-hidden bg-black/50">
                <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/80 border-b border-white/5">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-300">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Deployment Commands</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCommands}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-zinc-700 transition-colors"
                    title="Copy commands"
                  >
                    {copiedCmd ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-zinc-400" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 bg-black text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap selection:bg-emerald-950">
                  {record.commandDetails}
                </div>
              </div>
            )}
          </div>

          {/* Footer Metadata */}
          <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-500 pt-3 border-t border-white/5 gap-2">
            <div className="flex items-center space-x-3 flex-wrap">
              <span>
                Logged by: <strong className="text-zinc-300">{record.added_by}</strong>
              </span>
              <span>
                Source: <strong className="text-zinc-300">{record.source}</strong>
              </span>
              <span>
                Developer:{' '}
                <strong className="text-zinc-300">
                  {record.developerName || record.added_by}
                </strong>
              </span>
            </div>
            <div>
              <span>Timestamp: {formatted}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

