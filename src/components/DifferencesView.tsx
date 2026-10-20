// Differences: what separates two environments, service by service and key
// by key. Read-only; "Plan a patch" carries the pair into the Patch Planner.

import React, { useState } from 'react';
import { GitCompareArrows, Loader2, RefreshCw, Route } from 'lucide-react';
import { useComparison } from '../usePlanner';
import { ComparisonTable } from './planner/ComparisonTable';
import { ConfigDiffTable } from './planner/ConfigDiffTable';
import { btn, card, EnvironmentPairPicker, Message, PageHeader, primaryBtn, SERVICE_STATUS, StatusBadge } from './ui';

export const DifferencesView: React.FC<{
  source: string;
  target: string;
  onPair: (source: string, target: string) => void;
  onPlan: (source: string, target: string) => void;
}> = ({ source, target, onPair, onPlan }) => {
  const { data, error, loading, reload } = useComparison(source, target);
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const counts = data?.comparison.counts;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={GitCompareArrows}
        title="Differences"
        subtitle="Expected (vault and build records), observed (health reports) and image IDs, kept apart. Nothing here connects to a server."
        actions={
          <>
            <button type="button" className={btn} onClick={reload} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </button>
            <button type="button" className={primaryBtn} onClick={() => onPlan(source, target)} disabled={source === target}>
              <Route className="h-4 w-4" /> Plan a patch
            </button>
          </>
        }
      />

      <div className={`${card} flex flex-wrap items-end justify-between gap-4`}>
        <EnvironmentPairPicker source={source} target={target} onChange={onPair} />
        {counts && (
          <div className="flex flex-wrap gap-2" aria-label="Summary">
            {(Object.keys(SERVICE_STATUS) as (keyof typeof counts)[]).filter((k) => counts[k]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                <StatusBadge status={k} /> {counts[k]}
              </span>
            ))}
          </div>
        )}
      </div>

      {source === target && <Message kind="warn">Pick two different environments.</Message>}
      {error && <Message kind="error">{error}</Message>}
      {data?.warning && <Message kind="warn">{data.warning}</Message>}

      {data && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Services</h2>
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
              <input type="checkbox" checked={hideUnchanged} onChange={(e) => setHideUnchanged(e.target.checked)} className="accent-emerald-500" />
              Hide services that match
            </label>
          </div>
          {data.comparison.roles.length ? (
            <ComparisonTable comparison={data.comparison} context={data.context} hideUnchanged={hideUnchanged} />
          ) : (
            <Message kind="info">No services known for {source.toUpperCase()} or {target.toUpperCase()}. Upload compose files to the Configuration vault, or add release records.</Message>
          )}
          <h2 className="pt-2 text-sm font-semibold text-white">Configuration</h2>
          <ConfigDiffTable comparison={data.comparison} />
        </>
      )}
      {!data && loading && <p className="flex items-center gap-2 text-sm text-zinc-300"><Loader2 className="h-4 w-4 animate-spin" /> Comparing…</p>}
    </div>
  );
};
