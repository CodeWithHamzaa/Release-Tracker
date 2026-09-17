import React, { useMemo } from 'react';
import { ReleaseRecord } from '@/lib/types';
import { Layers, CheckCircle2, Clock, XCircle } from 'lucide-react';

interface StatsBarProps {
  records: ReleaseRecord[];
}

const StatCard: React.FC<{
  label: string;
  value: number;
  hint: string;
  icon: React.ElementType;
  accent: string;
}> = ({ label, value, hint, icon: Icon, accent }) => (
  <div className="rounded-xl border border-white/5 bg-[#111111] p-4 transition-colors hover:border-white/20">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <Icon className={`h-4 w-4 ${accent}`} />
    </div>
    <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
    <p className="mt-0.5 text-xs text-zinc-600">{hint}</p>
  </div>
);

export const StatsBar: React.FC<StatsBarProps> = ({ records }) => {
  const { total, successCount, pendingCount, failedCount } = useMemo(() => {
    const normalized = records.map((r) => String(r.status || 'PENDING').toUpperCase());
    return {
      total: records.length,
      successCount: normalized.filter((s) => s === 'SUCCESS').length,
      pendingCount: normalized.filter((s) => s !== 'SUCCESS' && s !== 'FAILED').length,
      failedCount: normalized.filter((s) => s === 'FAILED').length,
    };
  }, [records]);

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Total"
        value={total}
        hint="Tracked releases"
        icon={Layers}
        accent="text-zinc-100"
      />
      <StatCard
        label="Success"
        value={successCount}
        hint="Live in environments"
        icon={CheckCircle2}
        accent="text-emerald-400"
      />
      <StatCard
        label="Pending"
        value={pendingCount}
        hint="Awaiting verification"
        icon={Clock}
        accent="text-amber-400"
      />
      <StatCard
        label="Failed"
        value={failedCount}
        hint="Investigation needed"
        icon={XCircle}
        accent="text-rose-400"
      />
    </div>
  );
};
