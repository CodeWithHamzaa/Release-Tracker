import React, { useState } from 'react';
import {
  Pencil,
  FileTerminal,
  FileCode,
  Sliders,
  Terminal,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';

export interface ReleaseCardProps {
  record: ReleaseRecord;
  isExpanded?: boolean;
  onToggle?: () => void;
  onEdit?: (record: ReleaseRecord) => void;
  onRunbook?: (record: ReleaseRecord) => void;
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

/** True only for a string with actual content — blank/whitespace hides its section. */
function hasText(value?: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * A collapsible code/detail block. Only rendered when its payload is non-empty,
 * so an expanded card shows what actually changed and nothing else.
 */
const DetailBlock: React.FC<{
  title: string;
  icon: React.ElementType;
  accent: string;
  body: string;
  bodyClass: string;
  action?: React.ReactNode;
}> = ({ title, icon: Icon, accent, body, bodyClass, action }) => (
  <div className="overflow-hidden rounded-lg border border-white/5">
    <div className="flex items-center justify-between gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-2">
      <span
        className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider ${accent}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {title}
      </span>
      {action}
    </div>
    <pre
      className={`scrollbar-subtle overflow-x-auto whitespace-pre-wrap bg-black/60 p-3 font-mono text-[11px] leading-relaxed ${bodyClass}`}
    >
      {body.trim()}
    </pre>
  </div>
);

export const ReleaseCard: React.FC<ReleaseCardProps> = ({
  record,
  isExpanded: controlledExpanded,
  onToggle,
  onEdit,
  onRunbook,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

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

  // navigator.clipboard is undefined on insecure origins (plain HTTP off
  // localhost) and writeText() can reject if permission is denied, so a bare
  // call can throw synchronously or leave an unhandled rejection. Route both
  // through one helper that only flips the "copied" flag on real success.
  const copyToClipboard = (text: string, onCopied: (copied: boolean) => void) => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        onCopied(true);
        setTimeout(() => onCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard write denied or unavailable -- leave the UI unchanged
        // rather than falsely claiming success.
      });
  };

  const handleCopyId = () => {
    copyToClipboard(record.id, setCopiedId);
  };

  const handleCopyCommands = () => {
    if (!record.commandDetails) return;
    copyToClipboard(record.commandDetails, setCopiedCmd);
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

      {/* ── EXPANDED ──
          Only what this release actually carries. Empty sections are omitted
          rather than rendered as "none", and the technical identifiers sit in a
          muted footer so they never compete with the release content. */}
      {isExpanded && (
        <div
          id={`release-panel-${record.id}`}
          className="animate-accordion border-t border-white/10 bg-[#0a0a0a] px-4 py-4 sm:px-5 sm:py-5"
        >
          {/* Summary row: status + what changed, with Edit anchored right. */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${statusStyle.chip}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                {status}
              </span>

              {changeTags.map((tag) => (
                <span
                  key={tag.key}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium ${tag.className}`}
                >
                  <tag.icon className="h-3.5 w-3.5" />
                  {tag.label}
                </span>
              ))}
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
            {onRunbook && (
              <button
                type="button"
                id={`btn-runbook-${record.id}`}
                onClick={() => onRunbook(record)}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                title="Patch runbook for alara_server.sh on this server"
              >
                <FileTerminal className="h-3.5 w-3.5" />
                Runbook
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                id={`btn-edit-record-${record.id}`}
                onClick={() => onEdit(record)}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                title="Edit release details and status"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
            </div>
          </div>

          {/* Release note — the headline of the entry, so it leads and reads big. */}
          {hasText(record.note) && (
            <p className="border-l-2 border-white/10 py-0.5 pl-3.5 text-[13px] leading-relaxed text-zinc-300">
              {record.note.trim()}
            </p>
          )}

          {/* Detail payloads. Each appears only when it has content. */}
          {(hasText(record.envDetails) ||
            hasText(record.configDetails) ||
            hasText(record.commandDetails)) && (
            <div className="mt-4 space-y-2.5">
              {hasText(record.envDetails) && (
                <DetailBlock
                  title="Environment Variables"
                  icon={Sliders}
                  accent="text-amber-300"
                  body={record.envDetails}
                  bodyClass="text-amber-200/90"
                />
              )}

              {hasText(record.configDetails) && (
                <DetailBlock
                  title="Configuration Changes"
                  icon={Sliders}
                  accent="text-indigo-300"
                  body={record.configDetails}
                  bodyClass="text-indigo-200/90"
                />
              )}

              {hasText(record.commandDetails) && (
                <DetailBlock
                  title="Deployment Commands"
                  icon={Terminal}
                  accent="text-sky-300"
                  body={record.commandDetails}
                  bodyClass="text-emerald-400 selection:bg-emerald-500/20"
                  action={
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
                  }
                />
              )}
            </div>
          )}

          {/* Audit footer. Deliberately muted: provenance, not content.
              Record ID and source are tooltips rather than labelled fields. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/5 pt-3 text-[11px] text-zinc-500">
            <span>
              by <span className="font-medium text-zinc-400">{developer}</span>
            </span>
            <span title={`Logged by ${record.added_by}`}>
              logged by <span className="font-medium text-zinc-400">{record.added_by}</span>
              {hasText(record.source) && (
                <span className="text-zinc-600"> via {record.source.trim()}</span>
              )}
            </span>
            <span title={`Created ${created.absolute}`}>{created.relative || created.absolute}</span>
            {updated.absolute !== created.absolute && (
              <span title={`Last updated ${updated.absolute}`}>
                edited {updated.relative || updated.absolute}
              </span>
            )}
            <button
              type="button"
              onClick={handleCopyId}
              title={`Record ID: ${record.id} (click to copy)`}
              className="ml-auto font-mono text-[10px] text-zinc-700 transition-colors hover:text-zinc-400 focus:outline-none focus-visible:text-zinc-300"
            >
              {copiedId ? 'id copied' : `#${String(record.id).slice(-8)}`}
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
