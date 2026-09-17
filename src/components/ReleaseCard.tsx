import React, { useState } from 'react';
import {
  Server,
  Pencil,
  FileCode,
  Sliders,
  Terminal,
  Copy,
  Check,
  ChevronDown,
  Tag,
  Radio,
  Hash,
} from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';

export interface ReleaseCardProps {
  record: ReleaseRecord;
  isExpanded?: boolean;
  onToggle?: () => void;
  onEdit?: (record: ReleaseRecord) => void;
}

type StatusKey = 'SUCCESS' | 'FAILED' | 'PENDING';

const STATUS_STYLES: Record<
  StatusKey,
  { dot: string; glow: string; text: string; chip: string }
> = {
  SUCCESS: {
    dot: 'bg-emerald-400',
    glow: 'shadow-[0_0_8px_1px_rgba(52,211,153,0.5)]',
    text: 'text-emerald-400',
    chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  },
  FAILED: {
    dot: 'bg-rose-400',
    glow: 'shadow-[0_0_8px_1px_rgba(251,113,133,0.5)]',
    text: 'text-rose-400',
    chip: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  },
  PENDING: {
    dot: 'bg-amber-400',
    glow: 'shadow-[0_0_8px_1px_rgba(251,191,36,0.5)]',
    text: 'text-amber-400',
    chip: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  },
};

function normalizeStatus(input?: string | null): StatusKey {
  const s = String(input || 'PENDING').trim().toUpperCase();
  return s === 'SUCCESS' || s === 'FAILED' ? s : 'PENDING';
}

/** Environment pill colors, keyed loosely so 'Prod'/'Production' both match. */
function envStyles(env?: string | null): string {
  const upper = String(env || '').toUpperCase();
  if (upper.includes('PROD')) return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
  if (upper.includes('UAT')) return 'bg-purple-500/10 text-purple-300 border-purple-500/20';
  if (upper.includes('SIT')) return 'bg-sky-500/10 text-sky-300 border-sky-500/20';
  return 'bg-white/5 text-zinc-300 border-white/10';
}

/** "2 hours ago" style relative time, with a full timestamp kept for the tooltip. */
function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';

  const units: Array<[string, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [label, secondsInUnit] of units) {
    const value = Math.floor(seconds / secondsInUnit);
    if (value >= 1) return `${value} ${label}${value === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

function formatTimestamp(input: string | Date): { absolute: string; relative: string } {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    return { absolute: String(input), relative: '' };
  }
  return {
    absolute: d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    relative: relativeTime(d),
  };
}

function getInitials(name?: string | null): string {
  if (!name) return 'DV';
  const parts = name.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Small labelled cell used across the expanded detail grid. */
const DetailCell: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {label}
    </div>
    <div className="mt-1 text-sm text-zinc-200">{children}</div>
  </div>
);

export const ReleaseCard: React.FC<ReleaseCardProps> = ({
  record,
  isExpanded: controlledExpanded,
  onToggle,
  onEdit,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  const handleToggle = () => {
    if (onToggle) onToggle();
    else setInternalExpanded((prev) => !prev);
  };

  const status = normalizeStatus(record.status);
  const statusStyle = STATUS_STYLES[status];
  const created = formatTimestamp(record.createdAt);
  const updated = formatTimestamp(record.updatedAt);
  const developer = record.developerName || record.added_by || 'Unknown';

  const handleCopyCommands = () => {
    if (!record.commandDetails) return;
    navigator.clipboard.writeText(record.commandDetails);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const changeTags = [
    record.isBuildUpdate && {
      key: 'build',
      label: 'Build',
      icon: FileCode,
      className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    },
    record.isEnvUpdate && {
      key: 'env',
      label: 'Env Configs',
      icon: Sliders,
      className: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    },
    record.isConfigUpdate && {
      key: 'config',
      label: 'Config Update',
      icon: Sliders,
      className: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    },
    record.hasCommands && {
      key: 'commands',
      label: 'Commands',
      icon: Terminal,
      className: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    icon: typeof FileCode;
    className: string;
  }>;

  return (
    <div
      id={`release-row-${record.id}`}
      className={`rounded-xl border bg-[#111111] transition-colors duration-200 ${
        isExpanded
          ? 'border-white/20 shadow-lg shadow-black/40'
          : 'border-white/5 hover:border-white/20'
      }`}
    >
      {/* ── COLLAPSED / HEADER ROW: everything glanceable, nothing else ── */}
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isExpanded}
        aria-controls={`release-panel-${record.id}`}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 sm:gap-4 sm:px-5"
      >
        {/* Status dot */}
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0" title={status}>
          <span
            className={`h-2.5 w-2.5 rounded-full ${statusStyle.dot} ${statusStyle.glow} animate-status-pulse`}
          />
        </span>

        {/* Server / Service */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight text-white sm:text-[15px]">
              {record.server}
            </span>
            <span className="text-zinc-600">/</span>
            <span className="truncate font-mono text-sm font-medium text-zinc-300">
              {record.service}
            </span>
          </div>
          {/* Below md the pills on the right are hidden, so this line carries
              environment and version too — they stay glanceable on a phone. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 md:hidden">
            <span
              className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${envStyles(
                record.environment
              )}`}
            >
              {record.environment}
            </span>
            <span className="font-mono text-zinc-400">{record.version || '—'}</span>
            <span>·</span>
            <span className="truncate">{developer}</span>
            <span>·</span>
            <span className="whitespace-nowrap">{created.relative}</span>
          </div>
        </div>

        {/* Environment pill */}
        <span
          className={`hidden flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider md:inline-block ${envStyles(
            record.environment
          )}`}
        >
          {record.environment}
        </span>

        {/* Version */}
        <span className="hidden flex-shrink-0 rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 font-mono text-xs font-medium text-zinc-300 md:inline-block">
          {record.version || '—'}
        </span>

        {/* Developer + relative time */}
        <div className="hidden flex-shrink-0 items-center gap-2 md:flex">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] font-bold text-zinc-300"
            title={developer}
          >
            {getInitials(developer)}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="max-w-[110px] truncate text-xs font-medium text-zinc-300">
              {developer}
            </span>
            <span className="text-[11px] text-zinc-500" title={created.absolute}>
              {created.relative}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-zinc-500 transition-transform duration-200 ${
            isExpanded ? 'rotate-180 text-emerald-400' : ''
          }`}
        />
      </button>

      {/* ── EXPANDED: every detail saved on this record ── */}
      {isExpanded && (
        <div
          id={`release-panel-${record.id}`}
          className="animate-accordion border-t border-white/10 bg-[#0a0a0a] px-4 py-4 sm:px-5 sm:py-5"
        >
          {/* Action row */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${statusStyle.chip}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
              {status}
            </span>

            {onEdit && (
              <button
                type="button"
                id={`btn-edit-record-${record.id}`}
                onClick={() => onEdit(record)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                title="Edit release details and status"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>

          {/* Core fields */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <DetailCell label="Server">
              <span className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-zinc-500" />
                <span className="font-medium text-white">{record.server}</span>
              </span>
            </DetailCell>
            <DetailCell label="Service">
              <span className="font-mono text-emerald-400">{record.service}</span>
            </DetailCell>
            <DetailCell label="Version">
              <span className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-zinc-500" />
                <span className="font-mono font-medium text-zinc-100">
                  {record.version || '—'}
                </span>
              </span>
            </DetailCell>
            <DetailCell label="Environment">
              <span className="font-medium">{record.environment}</span>
            </DetailCell>
          </div>

          {/* Release note */}
          <div className="mt-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Release Note
            </div>
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              {record.note ? (
                record.note
              ) : (
                <span className="italic text-zinc-600">No release note recorded.</span>
              )}
            </p>
          </div>

          {/* What this release included */}
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Included in this release
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {changeTags.length > 0 ? (
                changeTags.map((tag) => (
                  <span
                    key={tag.key}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${tag.className}`}
                  >
                    <tag.icon className="h-3.5 w-3.5" />
                    {tag.label}
                  </span>
                ))
              ) : (
                <span className="text-xs italic text-zinc-600">
                  Standard release package — no change flags set.
                </span>
              )}
            </div>
          </div>

          {/* Environment variables */}
          {record.envDetails && (
            <div className="mt-3 overflow-hidden rounded-lg border border-white/5">
              <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                <Sliders className="h-3.5 w-3.5" />
                Environment Variables
              </div>
              <pre className="scrollbar-subtle overflow-x-auto bg-black/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-amber-200/90">
                {record.envDetails}
              </pre>
            </div>
          )}

          {/* Configuration changes */}
          {record.configDetails && (
            <div className="mt-3 overflow-hidden rounded-lg border border-white/5">
              <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
                <Sliders className="h-3.5 w-3.5" />
                Configuration Changes
              </div>
              <p className="bg-black/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-indigo-200/90">
                {record.configDetails}
              </p>
            </div>
          )}

          {/* Deployment commands */}
          {record.commandDetails && (
            <div className="mt-3 overflow-hidden rounded-lg border border-white/5">
              <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-3 py-2">
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                  <Terminal className="h-3.5 w-3.5" />
                  Deployment Commands
                </span>
                <button
                  type="button"
                  onClick={handleCopyCommands}
                  className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                  title="Copy commands"
                >
                  {copiedCmd ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="scrollbar-subtle overflow-x-auto bg-black/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-emerald-400 selection:bg-emerald-500/20">
                {record.commandDetails}
              </pre>
            </div>
          )}

          {/* Provenance */}
          <div className="mt-4 grid grid-cols-1 gap-2.5 border-t border-white/5 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailCell label="Developer">
              <span className="font-medium">{developer}</span>
            </DetailCell>
            <DetailCell label="Logged by">
              <span className="font-medium">{record.added_by}</span>
            </DetailCell>
            <DetailCell label="Source">
              <span className="flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-zinc-500" />
                {record.source || '—'}
              </span>
            </DetailCell>
            <DetailCell label="Record ID">
              <span className="flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-zinc-500" />
                <span className="truncate font-mono text-xs text-zinc-400" title={record.id}>
                  {record.id}
                </span>
              </span>
            </DetailCell>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
            <span>
              Created <span className="text-zinc-400">{created.absolute}</span>
              {created.relative && <span className="text-zinc-600"> ({created.relative})</span>}
            </span>
            <span>
              Updated <span className="text-zinc-400">{updated.absolute}</span>
              {updated.relative && <span className="text-zinc-600"> ({updated.relative})</span>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
