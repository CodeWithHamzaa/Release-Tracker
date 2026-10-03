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
  return 'bg-white/5 text-zinc-200 border-white/15';
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
  <div className="overflow-hidden rounded-lg border border-white/15">
    <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-2">
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

  const noteText = hasText(record.note) ? record.note.trim() : null;

  const details: Array<{ label: string; value: React.ReactNode; title?: string }> = [
    { label: 'Server', value: record.server || '—' },
    { label: 'Service', value: <span className="font-mono">{record.service || '—'}</span> },
    { label: 'Environment', value: record.environment || '—' },
    { label: 'Version', value: <span className="font-mono">{record.version || '—'}</span> },
    { label: 'Developer', value: developer },
    {
      label: 'Logged by',
      value: (
        <>
          {record.added_by}
          {hasText(record.source) && <span className="text-zinc-300"> via {record.source.trim()}</span>}
        </>
      ),
    },
    { label: 'Deployed', value: created.relative || created.absolute, title: created.absolute },
    ...(updated.absolute !== created.absolute
      ? [{ label: 'Edited', value: updated.relative || updated.absolute, title: updated.absolute }]
      : []),
  ];

  return (
    <div
      id={`release-row-${record.id}`}
      className={`rounded-xl border bg-surface-raised transition-[border-color,box-shadow] duration-300 ${
        isExpanded
          ? 'border-emerald-400/40 shadow-lg shadow-black/50 ring-1 ring-emerald-400/20'
          : 'border-white/15 hover:border-white/30'
      }`}
    >
      {/* ── COLLAPSED / HEADER ROW ──
          Leads with the release note (the "why"), then service, version and
          environment. The server name is deliberately NOT here: it lives in the
          expanded details. */}
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isExpanded}
        aria-controls={`release-panel-${record.id}`}
        className="flex w-full items-start gap-3 rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 sm:gap-4 sm:px-5 sm:py-4"
      >
        {/* Status dot */}
        <span className="relative mt-1.5 flex h-2.5 w-2.5 flex-shrink-0" title={status}>
          <span
            className={`h-2.5 w-2.5 rounded-full ${statusStyle.dot} ${statusStyle.glow} animate-status-pulse`}
          />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Line 1: the service is the headline of the row, with its version. */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-base font-semibold leading-tight text-white">
              {record.service}
            </span>
            <span className="flex-shrink-0 rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-100">
              {record.version || '—'}
            </span>
          </div>

          {/* Line 2: the release note is the record's purpose, so it reads as a
              supporting description: two lines collapsed, full text expanded. */}
          {noteText ? (
            <p
              className={`whitespace-pre-line break-words text-[13px] leading-snug text-zinc-300 ${
                isExpanded ? '' : 'line-clamp-2'
              }`}
            >
              {noteText}
            </p>
          ) : (
            <p className="text-[13px] italic text-zinc-400">No notes recorded</p>
          )}

          {/* Below md the right-hand pills are hidden, so a compact line carries
              environment, developer and time instead. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-zinc-200 md:hidden">
            <span
              className={`rounded-full border px-2 py-px text-[10px] font-bold uppercase tracking-wider ${envStyles(
                record.environment
              )}`}
            >
              {record.environment}
            </span>
            <span className="truncate">{developer}</span>
            <span className="text-zinc-400">·</span>
            <span className="whitespace-nowrap text-zinc-300">{created.relative}</span>
          </div>
        </div>

        {/* Environment pill */}
        <span
          className={`mt-0.5 hidden flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider md:inline-block ${envStyles(
            record.environment
          )}`}
        >
          {record.environment}
        </span>

        {/* Developer + relative time */}
        <div className="hidden flex-shrink-0 items-center gap-2 md:flex">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[11px] font-bold text-zinc-100"
            title={developer}
          >
            {getInitials(developer)}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="max-w-[120px] truncate text-xs font-semibold text-zinc-200">
              {developer}
            </span>
            <span className="text-xs text-zinc-300" title={created.absolute}>
              {created.relative}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown
          className={`mt-1 h-4 w-4 flex-shrink-0 transition-transform duration-300 motion-reduce:transition-none ${
            isExpanded ? 'rotate-180 text-emerald-300' : 'text-zinc-300'
          }`}
        />
      </button>

      {/* ── EXPANDED ──
          Always mounted so it can animate: the grid row slides between 0fr and
          1fr. While collapsed it is inert and hidden from assistive tech. */}
      <div
        id={`release-panel-${record.id}`}
        aria-hidden={!isExpanded}
        inert={!isExpanded}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-white/15 bg-surface-base px-4 py-4 sm:px-5 sm:py-5">
            {/* Summary row: status + what changed, with actions anchored right. */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${statusStyle.chip}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                  {status}
                </span>

                {changeTags.map((tag) => (
                  <span
                    key={tag.key}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${tag.className}`}
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
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/30 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-zinc-100 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/15 hover:text-emerald-200"
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
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/30 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-zinc-100 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/15 hover:text-emerald-200"
                    title="Edit release details and status"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {/* Supplementary details: the server name is first. */}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border border-white/15 bg-surface-raised p-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {details.map((d) => (
                <div key={d.label} className="min-w-0" title={d.title}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                    {d.label}
                  </dt>
                  <dd className="mt-0.5 truncate text-sm font-medium text-zinc-100">{d.value}</dd>
                </div>
              ))}
            </dl>

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
                    bodyClass="text-emerald-300 selection:bg-emerald-500/20"
                    action={
                      <button
                        type="button"
                        onClick={handleCopyCommands}
                        className="inline-flex items-center gap-1 rounded border border-white/30 bg-white/[0.06] px-2 py-1 text-xs font-medium text-zinc-200 transition-colors hover:border-white/30 hover:text-white"
                        title="Copy commands"
                      >
                        {copiedCmd ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-300" />
                            <span className="text-emerald-300">Copied</span>
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

            {/* Record id: provenance, kept small and out of the way. */}
            <div className="mt-4 flex justify-end border-t border-white/15 pt-3">
              <button
                type="button"
                onClick={handleCopyId}
                title={`Record ID: ${record.id} (click to copy)`}
                className="font-mono text-[11px] text-zinc-300 transition-colors hover:text-zinc-100"
              >
                {copiedId ? 'id copied' : `#${String(record.id).slice(-8)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
