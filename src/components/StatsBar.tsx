import React from 'react';
import { ReleaseRecord } from '@/lib/types';
import { Layers, CheckCircle2, Clock, XCircle } from 'lucide-react';

interface StatsBarProps {
  records: ReleaseRecord[];
}

export const StatsBar: React.FC<StatsBarProps> = ({ records }) => {
  const total = records.length;
  const successCount = records.filter(
    (r) => String(r.status || '').toUpperCase() === 'SUCCESS'
  ).length;
  const pendingCount = records.filter(
    (r) => !r.status || String(r.status || '').toUpperCase() === 'PENDING'
  ).length;
  const failedCount = records.filter(
    (r) => String(r.status || '').toUpperCase() === 'FAILED'
  ).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
      {/* Total Card */}
      <div className="bg-[#111111] p-4 rounded-xl border border-zinc-800/90 shadow-lg">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Total Builds</span>
          <Layers className="w-4 h-4 text-emerald-400" />
        </div>
        <p className="mt-2 text-2xl font-bold text-white">{total}</p>
        <p className="mt-0.5 text-xs text-zinc-500">Tracked releases</p>
      </div>

      {/* Success Card */}
      <div className="bg-[#111111] p-4 rounded-xl border border-zinc-800/90 shadow-lg">
        <div className="flex items-center justify-between text-emerald-400">
          <span className="text-xs font-semibold uppercase tracking-wider">SUCCESS</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
        <p className="mt-2 text-2xl font-bold text-emerald-400">{successCount}</p>
        <p className="mt-0.5 text-xs text-zinc-500">Live in environments</p>
      </div>

      {/* Pending Card */}
      <div className="bg-[#111111] p-4 rounded-xl border border-zinc-800/90 shadow-lg">
        <div className="flex items-center justify-between text-amber-400">
          <span className="text-xs font-semibold uppercase tracking-wider">PENDING</span>
          <Clock className="w-4 h-4 text-amber-400" />
        </div>
        <p className="mt-2 text-2xl font-bold text-amber-400">{pendingCount}</p>
        <p className="mt-0.5 text-xs text-zinc-500">Awaiting verification</p>
      </div>

      {/* Failed Card */}
      <div className="bg-[#111111] p-4 rounded-xl border border-zinc-800/90 shadow-lg">
        <div className="flex items-center justify-between text-rose-400">
          <span className="text-xs font-semibold uppercase tracking-wider">FAILED</span>
          <XCircle className="w-4 h-4 text-rose-400" />
        </div>
        <p className="mt-2 text-2xl font-bold text-rose-400">{failedCount}</p>
        <p className="mt-0.5 text-xs text-zinc-500">Investigation needed</p>
      </div>
    </div>
  );
};
