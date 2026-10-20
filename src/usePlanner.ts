// Patch planner data: environment comparison and plan previews from the API
// (lib/planningApi.ts). Nothing is cached in the browser: plans always reflect
// the database as it is now.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, apiErrorMessage } from './api';
import type { EnvironmentComparison } from '@/lib/envCompare';
import type { ResolvedScope, PatchScopeInput } from '@/lib/patchScope';
import type { PatchPlan } from '@/lib/patchPlan';
import type { InclusionResult, BuildRef } from '@/lib/changeMap';

export interface PlanningContext {
  services: Record<string, { builds: { version: string; firstSeen: string; environments: string[] }[]; changes: (InclusionResult & { key: string; title: string | null })[] }>;
  changes: { key: string; title: string | null; kind: string | null; introduced: BuildRef[] }[];
}

export interface CompareResponse {
  warning: string | null;
  changeMapping: boolean;
  comparison: EnvironmentComparison;
  context: PlanningContext;
}

export interface PreviewResponse {
  warning: string | null;
  scope: ResolvedScope;
  plan: PatchPlan;
  markdown: { steps: string; runbook: string };
}

export function useComparison(source: string, target: string, enabled = true) {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled || source === target) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/environments/compare?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`);
      if (mine !== seq.current) return;
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Could not compare the environments'));
        setData(null);
        return;
      }
      setData(await res.json());
    } catch {
      if (mine === seq.current) setError('Could not reach the API.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [source, target, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}

export async function previewPlan(body: {
  source: string;
  target: string;
  scope: PatchScopeInput;
  patchId?: string;
  tarDir?: string;
}): Promise<{ ok: true; data: PreviewResponse } | { ok: false; message: string }> {
  try {
    const res = await apiFetch('/api/patch-plans/preview', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, message: await apiErrorMessage(res, 'Could not build the plan') };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, message: 'Could not reach the API.' };
  }
}
