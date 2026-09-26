import React, { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardList, Copy, X } from 'lucide-react';
import { ReleaseRecord } from '@/lib/types';
import { syncLines } from '@/lib/syncLines';
import { copyText } from '../download';

// "Changes since last sync" lines for section 1.2 of the ALARA knowledge index.
export const SyncLinesModal: React.FC<{ records: ReleaseRecord[]; onClose: () => void }> = ({ records, onClose }) => {
  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => syncLines(records, since || undefined), [records, since]);
  const text = lines.join('\n');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#111111] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 bg-[#161618] px-6 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 id="sync-title" className="text-base font-bold text-white">Knowledge index §1.2 lines</h2>
              <p className="text-xs text-zinc-400">SUCCESS and FAILED releases, newest first. PENDING is skipped.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="sync-since" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-300">
                Since
              </label>
              <input
                id="sync-since"
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                className="rounded-xl border border-zinc-700/80 bg-[#1f1f23] px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </div>
            <span className="pb-2 text-xs text-zinc-500">{lines.length} line(s)</span>
          </div>
          <pre
            aria-label="Section 1.2 lines"
            className="min-h-[120px] overflow-x-auto whitespace-pre rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-zinc-200"
          >
            {text || 'Nothing logged since this date.'}
          </pre>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 bg-[#161618] px-6 py-4">
          <button
            type="button"
            disabled={!text}
            onClick={async () => {
              if (await copyText(text)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy lines'}
          </button>
        </div>
      </div>
    </div>
  );
};
