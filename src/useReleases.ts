import { useCallback, useEffect, useState } from 'react';
import type { Release, ReleaseRecord } from '@/lib/types';
import type { ReleaseBundle } from '@/lib/releaseFeed';
import { apiFetch, apiErrorMessage } from './api';

// Changes to the audit log that a release action caused, merged by App.
export interface RecordChanges {
  upsert?: ReleaseRecord[];
  removeIds?: string[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
  release?: Release | null;
}

// Release bundles from /api/releases, plus the actions on them. Records stay
// owned by App (they feed every other page); each action hands back the
// records it created, changed or removed through onRecords.
export function useReleases(enabled: boolean, onRecords: (changes: RecordChanges) => void) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch('/api/releases');
      if (!res.ok) {
        setWarning(await apiErrorMessage(res, 'Could not load release bundles'));
        return;
      }
      const data = await res.json();
      setReleases(Array.isArray(data.releases) ? data.releases : []);
      setWarning(null);
    } catch {
      setWarning('Could not reach the release API.');
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const upsertRelease = (r: Release) => setReleases((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);

  const added = useCallback((release: Release | null) => {
    if (release) upsertRelease(release);
  }, []);

  const call = useCallback(
    async (path: string, method: string, body: unknown, fallback: string) => {
      const res = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) return { ok: false as const, message: await apiErrorMessage(res, fallback) };
      return { ok: true as const, data: await res.json() };
    },
    []
  );

  // The collapsed row's toggle. A bundle changes only its own status; a
  // legacy one-record bundle has no bundle row, so its record changes.
  const setStatus = useCallback(
    async (bundle: ReleaseBundle, status: string): Promise<ActionResult> => {
      if (!bundle.release) {
        const r = await call(`/api/records/${encodeURIComponent(bundle.records[0].id)}`, 'PATCH', { status }, 'Status update failed');
        if (!r.ok) return r;
        onRecords({ upsert: [r.data.record] });
        return { ok: true, message: `Status set to ${status}.` };
      }
      const r = await call(`/api/releases/${encodeURIComponent(bundle.release.id)}`, 'PATCH', { status }, 'Status update failed');
      if (!r.ok) return r;
      upsertRelease(r.data.release);
      return { ok: true, message: `Release status set to ${status}.` };
    },
    [call, onRecords]
  );

  // Explicit, separate action: copy the bundle status onto every service.
  const applyStatusToRecords = useCallback(
    async (bundle: ReleaseBundle): Promise<ActionResult> => {
      if (!bundle.release) return { ok: false, message: 'Not a release bundle.' };
      const r = await call(`/api/releases/${encodeURIComponent(bundle.release.id)}`, 'PATCH', { status: bundle.status, applyStatusToRecords: true }, 'Update failed');
      if (!r.ok) return r;
      upsertRelease(r.data.release);
      onRecords({ upsert: r.data.records });
      return { ok: true, message: `Every service set to ${bundle.status}.` };
    },
    [call, onRecords]
  );

  const promote = useCallback(
    async (bundle: ReleaseBundle, targetEnvironment: string): Promise<ActionResult> => {
      if (!bundle.release) return { ok: false, message: 'Only release bundles can be promoted.' };
      const r = await call(`/api/releases/${encodeURIComponent(bundle.release.id)}/promote`, 'POST', { targetEnvironment }, 'Promotion failed');
      if (!r.ok) return r;
      const release: Release = r.data.release;
      upsertRelease(release);
      // Refreshing a planned copy replaces its records.
      onRecords({ removeIds: r.data.removedRecordIds, upsert: r.data.records });
      return {
        ok: true,
        release,
        message: `${r.data.action === 'updated' ? 'Updated the planned' : 'Created a planned'} ${release.environment} entry with ${r.data.records.length} service${r.data.records.length === 1 ? '' : 's'} (PLANNED: not counted as deployed).`,
      };
    },
    [call, onRecords]
  );

  const undo = useCallback(
    async (releaseId: string): Promise<ActionResult> => {
      const r = await call(`/api/releases/${encodeURIComponent(releaseId)}/revert`, 'POST', undefined, 'Undo failed');
      if (!r.ok) return r;
      if (r.data.release) upsertRelease(r.data.release);
      else setReleases((prev) => prev.filter((x) => x.id !== releaseId));
      onRecords({ removeIds: r.data.removedRecordIds, upsert: r.data.records });
      return { ok: true, message: r.data.action === 'deleted' ? 'Promotion undone: the planned entry was removed.' : 'Promotion undone: the planned entry was restored.' };
    },
    [call, onRecords]
  );

  return { releases, warning, reload, added, setStatus, applyStatusToRecords, promote, undo };
}
