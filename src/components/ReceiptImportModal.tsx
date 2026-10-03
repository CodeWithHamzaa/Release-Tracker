import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ReceiptText, X, XCircle } from 'lucide-react';
import type { ReleaseRecord } from '@/lib/types';
import type { HealthApi, ReceiptResult } from '../useHealth';

const primary =
  'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50';
const secondary =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3.5 py-2 text-sm font-semibold text-zinc-200 hover:border-white/30 hover:text-white';

const VERDICT = {
  success: { label: 'Applied', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', Icon: CheckCircle2 },
  failed: { label: 'Failed', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300', Icon: XCircle },
  pending: { label: 'Not applied', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', Icon: AlertTriangle },
} as const;

const STATUS_CLS: Record<string, string> = { SUCCESS: 'text-emerald-300', FAILED: 'text-rose-300', PENDING: 'text-amber-300' };

// Review screen for a deployment receipt: what happened on the server (from
// the toolkit's own record), which PENDING release records it would close, and
// what status each gets. Nothing is written until Confirm.
export const ReceiptImportModal: React.FC<{
  text: string;
  label: string;
  health: HealthApi;
  onClose: () => void;
  onApplied: (updated: ReleaseRecord[], created: ReleaseRecord[]) => void;
}> = ({ text, label, health, onClose, onApplied }) => {
  const [data, setData] = useState<ReceiptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [create, setCreate] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    health
      .receipt(text, { preview: true })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setPicked(new Set(d.matches.map((m) => m.recordId)));
        setCreate(new Set(d.canCreate ? d.unmatchedImages.map((i) => i.service) : []));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [health, text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await health.receipt(text, { recordIds: [...picked], createServices: [...create] });
      onApplied(res.updated ?? [], res.created ?? []);
      await health.reload();
      setDone(
        res.unchanged
          ? 'This receipt was already uploaded: nothing changed.'
          : `Receipt saved. ${res.updated?.length ?? 0} record(s) updated${res.created?.length ? `, ${res.created.length} created` : ''}.`
      );
    } catch (e: any) {
      setError(e?.message || 'Could not save the receipt.');
    } finally {
      setBusy(false);
    }
  };

  const r = data?.receipt;
  const v = r ? VERDICT[r.verdict] : null;
  const selectedCount = picked.size + create.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-surface-raised shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/15 px-6 py-4">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 id="receipt-title" className="text-base font-bold text-white">Deployment receipt</h2>
              <p className="text-xs text-zinc-300 font-mono">{label}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-xs">
          {!data && !error && (
            <p className="flex items-center gap-2 text-zinc-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the receipt...
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-rose-800/70 bg-rose-950/40 p-3 text-rose-300">
              {error}
            </p>
          )}

          {r && v && data && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-bold uppercase tracking-wider ${v.cls}`}>
                  <v.Icon className="h-3.5 w-3.5" /> {v.label}
                </span>
                <span className="text-zinc-200">
                  {r.environment.toUpperCase()} · {r.role} · patch <span className="font-mono">{r.patchId}</span>
                </span>
              </div>
              <p className="text-zinc-300">{r.reason}</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-white/15 bg-surface-base p-3 sm:grid-cols-4">
                {[
                  ['Toolkit result', r.result ?? r.outcome],
                  ['Exit code', String(r.exitCode)],
                  ['Server', r.host ?? 'unknown'],
                  ['Finished', new Date(r.finishedAt).toLocaleString()],
                ].map(([k, val]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{k}</dt>
                    <dd className="mt-0.5 font-mono text-zinc-100">{val}</dd>
                  </div>
                ))}
              </dl>

              {data.duplicate && (
                <p className="rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-amber-300">
                  This exact receipt was already uploaded by {data.duplicate.uploadedBy} on {new Date(data.duplicate.createdAt).toLocaleString()}. Uploading
                  it again changes nothing.
                </p>
              )}

              {r.images.length > 0 && (
                <div>
                  <h3 className="mb-1 font-semibold text-zinc-100">Images the toolkit changed</h3>
                  <ul className="space-y-1 font-mono text-zinc-200">
                    {r.images.map((i) => (
                      <li key={i.service} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-zinc-300">{i.service}</span> {i.oldRef} <ArrowRight className="h-3 w-3 text-zinc-400" /> <span className="text-emerald-300">{i.newRef}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.envAdded.length > 0 && (
                <p className="text-zinc-300">
                  Env keys the script added: <span className="font-mono text-zinc-100">{r.envAdded.join(', ')}</span>
                </p>
              )}

              <div>
                <h3 className="mb-1 font-semibold text-zinc-100">Release records</h3>
                {data.matches.length === 0 && <p className="text-zinc-300">No PENDING record matches this receipt (same environment, server, and the PATCH_ID in its note or the applied image).</p>}
                <ul className="space-y-1.5">
                  {data.matches.map((m) => (
                    <li key={m.recordId}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 py-2 hover:border-white/30">
                        <input
                          type="checkbox"
                          className="accent-emerald-500"
                          checked={picked.has(m.recordId)}
                          disabled={!!done}
                          onChange={(e) => setPicked((prev) => { const n = new Set(prev); e.target.checked ? n.add(m.recordId) : n.delete(m.recordId); return n; })}
                        />
                        <span className="font-mono text-zinc-100">{m.service} {m.version}</span>
                        <span className="text-zinc-400">matched by {m.via === 'both' ? 'PATCH_ID and image' : m.via === 'image' ? 'image' : 'PATCH_ID'}</span>
                        <span className="flex-1" />
                        <span className={STATUS_CLS[m.currentStatus] ?? 'text-zinc-300'}>{m.currentStatus}</span>
                        <ArrowRight className="h-3 w-3 text-zinc-400" />
                        <span className={m.newStatus ? STATUS_CLS[m.newStatus] : 'text-amber-300'}>{m.newStatus ?? 'stays PENDING (note only)'}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {data.unmatchedImages.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-zinc-300">
                      The toolkit applied these images but no PENDING record matches{data.canCreate ? '. Tick to log them as new records:' : '.'}
                    </p>
                    <ul className="space-y-1.5">
                      {data.unmatchedImages.map((i) => (
                        <li key={i.service}>
                          <label className={`flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 ${data.canCreate ? 'cursor-pointer hover:border-white/30' : 'opacity-60'}`}>
                            <input
                              type="checkbox"
                              className="accent-emerald-500"
                              disabled={!data.canCreate || !!done}
                              checked={create.has(i.service)}
                              onChange={(e) => setCreate((prev) => { const n = new Set(prev); e.target.checked ? n.add(i.service) : n.delete(i.service); return n; })}
                            />
                            <span className="font-mono text-zinc-100">{i.service} {i.version ?? i.ref}</span>
                            <span className="flex-1" />
                            <span className="text-zinc-300">new record, {r.verdict === 'success' ? 'SUCCESS' : r.verdict === 'failed' ? 'FAILED' : 'not created'}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {done && (
                <p role="status" className="rounded-xl border border-emerald-800/70 bg-emerald-950/40 p-3 text-emerald-300">
                  {done}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/15 px-6 py-4">
          {!done && (
            <button type="button" className={secondary} onClick={onClose}>
              Cancel
            </button>
          )}
          {!done ? (
            <button type="button" className={primary} disabled={!data || busy || !!data.duplicate} onClick={confirm}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {data && data.matches.length === 0 && create.size === 0 ? 'Save the receipt only' : `Confirm and update ${selectedCount} record(s)`}
            </button>
          ) : (
            <button type="button" className={primary} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
