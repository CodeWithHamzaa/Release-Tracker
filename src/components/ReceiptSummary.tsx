// Deployment receipts linked to one release record (uploaded on the Health
// page), shown in the expanded release bundle.

import React, { useEffect, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { apiFetch } from '../api';

interface ReceiptSummaryData {
  id: string;
  reportedAt: string;
  host: string | null;
  uploadedBy: string;
  parsed: {
    verdict: 'success' | 'failed' | 'pending';
    result: string | null;
    outcome: string;
    exitCode: number;
    recordId: string | null;
    reason: string;
    images: { service: string; oldRef: string; newRef: string }[];
    envAdded: string[];
  };
}

const RECEIPT_TONE = {
  success: 'border-emerald-500/30 bg-emerald-500/5',
  failed: 'border-rose-500/30 bg-rose-500/5',
  pending: 'border-amber-500/30 bg-amber-500/5',
} as const;

/**
 * Deployment receipts linked to this record (uploaded on the Health page).
 * Fetched once, when the card is first expanded.
 */
export const ReceiptSummary: React.FC<{ recordId: string; open: boolean }> = ({ recordId, open }) => {
  const [receipts, setReceipts] = useState<ReceiptSummaryData[] | null>(null);
  useEffect(() => {
    if (!open || receipts !== null) return;
    let cancelled = false;
    apiFetch(`/api/receipts?recordId=${encodeURIComponent(recordId)}`)
      .then((res) => (res.ok ? res.json() : { receipts: [] }))
      .then((d) => !cancelled && setReceipts(d.receipts || []))
      .catch(() => !cancelled && setReceipts([]));
    return () => {
      cancelled = true;
    };
  }, [open, recordId, receipts]);
  if (!receipts || receipts.length === 0) return null;
  return (
    <div className="mt-4 space-y-2" aria-label="Deployment receipts">
      {receipts.map((r) => (
        <div key={r.id} className={`rounded-lg border p-3 ${RECEIPT_TONE[r.parsed.verdict]}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ReceiptText className="h-3.5 w-3.5 text-zinc-300" />
            <span className="font-semibold text-zinc-100">Deployment receipt</span>
            <span className="font-mono text-zinc-200">{r.parsed.result ?? r.parsed.outcome}</span>
            <span className="text-zinc-400">exit {r.parsed.exitCode}</span>
            {r.host && <span className="text-zinc-400">on {r.host}</span>}
            <span className="text-zinc-400">{new Date(r.reportedAt).toLocaleString()}</span>
            <span className="flex-1" />
            <span className="text-zinc-400">uploaded by {r.uploadedBy}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-300">{r.parsed.reason}</p>
          {r.parsed.images.length > 0 && (
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-200">
              {r.parsed.images.map((i) => (
                <li key={i.service}>
                  {i.service}: {i.oldRef} → {i.newRef}
                </li>
              ))}
            </ul>
          )}
          {r.parsed.recordId && <p className="mt-1 font-mono text-[11px] text-zinc-400">toolkit record {r.parsed.recordId}</p>}
        </div>
      ))}
    </div>
  );
};
