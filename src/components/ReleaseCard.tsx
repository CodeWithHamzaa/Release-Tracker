import React, { useState } from 'react';
import {
  Server,
  User,
  Calendar,
  Pencil,
  FileCode,
  Sliders,
  Terminal,
  CheckCircle2,
  Clock,
  XCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';

interface ReleaseCardProps {
  record: ReleaseRecord;
  onEdit?: (record: ReleaseRecord) => void;
}

export const ReleaseCard: React.FC<ReleaseCardProps> = ({ record, onEdit }) => {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [showCommands, setShowCommands] = useState(false);

  // Status badge styling strictly as requested:
  // Green for 'Success', Red for 'Failed', Yellow/Amber for 'Pending'
  const getStatusBadge = (status: string = 'Pending') => {
    switch (status) {
      case 'Success':
        return {
          container: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          dot: 'bg-emerald-500',
          icon: <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />,
          label: 'Success',
        };
      case 'Failed':
        return {
          container: 'bg-rose-50 text-rose-700 border-rose-200',
          dot: 'bg-rose-500',
          icon: <XCircle className="w-3.5 h-3.5 mr-1 text-rose-600" />,
          label: 'Failed',
        };
      case 'Pending':
      default:
        return {
          container: 'bg-amber-50 text-amber-700 border-amber-200',
          dot: 'bg-amber-500',
          icon: <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" />,
          label: 'Pending',
        };
    }
  };

  // Environment badge
  const getEnvBadge = (env: string) => {
    const lower = (env || '').toLowerCase();
    if (lower.includes('prod')) {
      return 'bg-red-50 text-red-700 border-red-200';
    }
    if (lower.includes('uat')) {
      return 'bg-purple-50 text-purple-700 border-purple-200';
    }
    return 'bg-blue-50 text-blue-700 border-blue-200';
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
      id={`release-card-${record.id}`}
      className="bg-white rounded-xl border border-slate-200/90 shadow-xs hover:shadow-sm hover:border-slate-300 transition-all p-5 flex flex-col space-y-3.5"
    >
      {/* Top Header: Service/Server + Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-2.5 border-b border-slate-100">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Server className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-1.5 flex-wrap">
              <span className="text-base font-bold text-slate-800 tracking-tight">
                {record.server}
              </span>
              <span className="text-slate-300">/</span>
              <span className="text-sm font-semibold text-blue-600">
                {record.service}
              </span>
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 mt-0.5">
              <Calendar className="w-3 h-3" />
              <span>{formatted}</span>
              {timeAgo && <span className="text-slate-400">({timeAgo})</span>}
            </div>
          </div>
        </div>

        {/* Status & Environment Badges */}
        <div className="flex items-center space-x-2 self-start sm:self-center flex-shrink-0">
          {/* Status Badge */}
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${statusInfo.container}`}
          >
            {statusInfo.icon}
            {statusInfo.label}
          </span>

          {/* Environment Badge */}
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${getEnvBadge(
              record.environment
            )}`}
          >
            <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-75" />
            {record.environment}
          </span>
        </div>
      </div>

      {/* Prominent Developer Name Display */}
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
            {(record.developerName || 'D').charAt(0).toUpperCase()}
          </div>
          <div className="text-sm">
            <span className="text-slate-500 text-xs">Build provided by: </span>
            <span className="font-semibold text-slate-800">
              {record.developerName || 'Unknown Developer'}
            </span>
          </div>
        </div>

        {/* Change category tags */}
        <div className="flex items-center space-x-1.5 flex-shrink-0 text-xs">
          {record.isBuildUpdate && (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium border border-emerald-200/60" title="Code package update">
              <FileCode className="w-3 h-3 mr-1" />
              Build
            </span>
          )}
          {record.isEnvUpdate && (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium border border-amber-200/60" title="Env variables updated">
              <Sliders className="w-3 h-3 mr-1" />
              Env
            </span>
          )}
          {record.isConfigUpdate && (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium border border-indigo-200/60" title="Config updated">
              Config
            </span>
          )}
          {record.hasCommands && (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-violet-50 text-violet-700 font-medium border border-violet-200/60" title="Commands required">
              <Terminal className="w-3 h-3 mr-1" />
              Commands
            </span>
          )}
        </div>
      </div>

      {/* Clean Note Area */}
      {record.note && (
        <div className="p-3 rounded-lg bg-slate-50/70 border border-slate-200/60 text-xs sm:text-sm text-slate-700 leading-relaxed">
          <span className="font-semibold text-slate-500 text-xs block mb-0.5">Note:</span>
          <p className="whitespace-pre-wrap">{record.note}</p>
        </div>
      )}

      {/* Clean Command Details Toggle if present */}
      {record.hasCommands && record.commandDetails && (
        <div className="text-xs">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowCommands(!showCommands)}
              className="inline-flex items-center space-x-1 text-slate-600 hover:text-slate-900 font-medium py-1"
            >
              <Terminal className="w-3.5 h-3.5 text-violet-600 mr-0.5" />
              <span>{showCommands ? 'Hide deployment commands' : 'View deployment commands'}</span>
              {showCommands ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showCommands && (
              <button
                type="button"
                onClick={handleCopyCommands}
                className="inline-flex items-center px-2 py-0.5 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
              >
                {copiedCmd ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600 mr-1" />
                    <span className="text-emerald-700">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 mr-1" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>
          {showCommands && (
            <pre className="mt-1.5 p-2.5 rounded-lg bg-slate-900 text-emerald-400 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
              {record.commandDetails}
            </pre>
          )}
        </div>
      )}

      {/* Footer: User & Source + Edit Button */}
      <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center space-x-2">
          <span>Added by <strong className="text-slate-700 font-semibold">{record.added_by}</strong></span>
          <span>•</span>
          <span className="text-slate-400">{record.source}</span>
        </div>

        <button
          id={`btn-edit-record-${record.id}`}
          onClick={() => onEdit?.(record)}
          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 hover:border-blue-200 border border-slate-200 rounded-lg transition-colors"
        >
          <Pencil className="w-3 h-3 mr-1.5 text-slate-500 hover:text-blue-600" />
          Edit
        </button>
      </div>
    </div>
  );
};
