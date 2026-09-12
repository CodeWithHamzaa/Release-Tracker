import React from 'react';
import { ReleaseRecord } from '@/lib/types';
import { Layers, CheckCircle2, Clock, XCircle } from 'lucide-react';

interface StatsBarProps {
  records: ReleaseRecord[];
}

export const StatsBar: React.FC<StatsBarProps> = ({ records }) => {
  const total = records.length;
  const successCount = records.filter(
    (r) => (r.status || '').toLowerCase() === 'success'
  ).length;
  const pendingCount = records.filter(
    (r) => !r.status || (r.status || '').toLowerCase() === 'pending'
  ).length;
  const failedCount = records.filter(
    (r) => (r.status || '').toLowerCase() === 'failed'
  ).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
      {/* Total Card */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-slate-500">
          <span className="text-xs font-semibold uppercase tracking-wider">Total Builds</span>
          <Layers className="w-4 h-4 text-blue-600" />
        </div>
        <p className="mt-2 text-2xl font-bold text-slate-900">{total}</p>
        <p className="mt-0.5 text-xs text-slate-500">Active tracked releases</p>
      </div>

      {/* Success Card */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-emerald-700">
          <span className="text-xs font-semibold uppercase tracking-wider">Success</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        </div>
        <p className="mt-2 text-2xl font-bold text-emerald-700">{successCount}</p>
        <p className="mt-0.5 text-xs text-slate-500">Successfully deployed</p>
      </div>

      {/* Pending Card */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-amber-700">
          <span className="text-xs font-semibold uppercase tracking-wider">Pending</span>
          <Clock className="w-4 h-4 text-amber-600" />
        </div>
        <p className="mt-2 text-2xl font-bold text-amber-700">{pendingCount}</p>
        <p className="mt-0.5 text-xs text-slate-500">Awaiting verification</p>
      </div>

      {/* Failed Card */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between text-rose-700">
          <span className="text-xs font-semibold uppercase tracking-wider">Failed</span>
          <XCircle className="w-4 h-4 text-rose-600" />
        </div>
        <p className="mt-2 text-2xl font-bold text-rose-700">{failedCount}</p>
        <p className="mt-0.5 text-xs text-slate-500">Requires investigation</p>
      </div>
    </div>
  );
};
