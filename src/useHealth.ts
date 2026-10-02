import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, apiErrorMessage } from './api';
import type { HealthReportMeta } from '@/lib/healthModel';

export interface UploadOutcome {
  label: string;
  ok: boolean;
  text: string;
}

// Latest health report per environment + role + kind (with parsed content),
// plus upload, history and raw-text access.
export function useHealth(enabled: boolean) {
  const [reports, setReports] = useState<HealthReportMeta[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/health-reports');
      if (!res.ok) {
        setWarning(await apiErrorMessage(res, 'Could not load health reports'));
        return;
      }
      const data = await res.json();
      setReports(data.reports || []);
      setWarning(data.dataSource === 'database' ? null : 'No database: health reports are unavailable.');
    } catch {
      setWarning('Could not reach the API to load health reports.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  // Uploads one text (a .snapshot file's content, or pasted status/doctor
  // output). Environment, role and kind are detected by the server.
  const upload = useCallback(async (text: string, label: string): Promise<UploadOutcome> => {
    try {
      const res = await apiFetch('/api/health-reports', { method: 'POST', body: JSON.stringify({ text }) });
      if (!res.ok) return { label, ok: false, text: await apiErrorMessage(res, 'Upload failed') };
      const { report, unchanged } = await res.json();
      const where = `${report.environment.toUpperCase()} / ${report.role}`;
      return { label, ok: true, text: unchanged ? `${report.kind} for ${where}: already uploaded` : `${report.kind} for ${where}: saved` };
    } catch {
      return { label, ok: false, text: 'Could not reach the API.' };
    }
  }, []);

  const history = useCallback(async (environment: string, role: string, kind: string) => {
    const q = new URLSearchParams({ environment, role, kind });
    const res = await apiFetch(`/api/health-reports/history?${q}`);
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not load history'));
    return (await res.json()).reports as Omit<HealthReportMeta, 'parsed'>[];
  }, []);

  const getReport = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/health-reports/${id}`);
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not load the report'));
    return (await res.json()).report as HealthReportMeta & { raw: string };
  }, []);

  return useMemo(
    () => ({ reports, warning, isLoading, reload, upload, history, getReport }),
    [reports, warning, isLoading, reload, upload, history, getReport]
  );
}

export type HealthApi = ReturnType<typeof useHealth>;
