// Groups the audit log into release bundles for the feed: one row per release
// event, never one row per service. Records logged before bundles existed (no
// releaseId) each become a one-service bundle, so older history still shows.
// Pure: used by the feed and its tests.

import type { Release, ReleaseRecord } from './types.js';
import { EXECUTION_ORDER } from './environments.js';

export interface ReleaseBundle {
  key: string; // release id, or `record:<id>` for a legacy record
  release: Release | null; // null: a legacy record with no bundle row
  title: string;
  environment: string;
  status: string; // the bundle's own status (legacy: the record's)
  releasedAt: string;
  hasConfigChange: boolean;
  configDetails: string | null;
  note: string | null;
  records: ReleaseRecord[];
  servers: string[]; // target server roles, in execution order
  owners: string[];
  recordStatuses: Record<string, number>; // service-record status -> count
}

const upper = (s: unknown) => String(s ?? '').trim().toUpperCase();
const iso = (d: string | Date) => new Date(d).toISOString();

function roleRank(role: string): number {
  const i = (EXECUTION_ORDER as readonly string[]).indexOf(role);
  return i === -1 ? EXECUTION_ORDER.length : i;
}

// Server roles in deployment order (Database first, Bot-Builder last).
export function serverOrder(roles: Iterable<string>): string[] {
  return [...new Set(roles)].sort((a, b) => roleRank(a) - roleRank(b) || a.localeCompare(b));
}

function summarize(records: ReleaseRecord[]) {
  const recordStatuses: Record<string, number> = {};
  for (const r of records) recordStatuses[upper(r.status) || 'PENDING'] = (recordStatuses[upper(r.status) || 'PENDING'] ?? 0) + 1;
  return {
    servers: serverOrder(records.map((r) => r.server)),
    owners: [...new Set(records.map((r) => r.developerName).filter(Boolean))],
    recordStatuses,
  };
}

export function buildBundles(releases: Release[], records: ReleaseRecord[]): ReleaseBundle[] {
  const byRelease = new Map<string, ReleaseRecord[]>();
  const legacy: ReleaseRecord[] = [];
  const known = new Set(releases.map((r) => r.id));
  for (const r of records) {
    if (r.releaseId && known.has(r.releaseId)) byRelease.set(r.releaseId, [...(byRelease.get(r.releaseId) ?? []), r]);
    else legacy.push(r);
  }

  const bundles: ReleaseBundle[] = releases.map((rel) => {
    const recs = (byRelease.get(rel.id) ?? []).sort((a, b) => roleRank(a.server) - roleRank(b.server) || a.server.localeCompare(b.server) || a.service.localeCompare(b.service));
    return {
      key: rel.id,
      release: rel,
      title: rel.title,
      environment: rel.environment,
      status: upper(rel.status) || 'PENDING',
      releasedAt: iso(rel.releasedAt),
      hasConfigChange: !!rel.hasConfigChange,
      configDetails: rel.configDetails ?? null,
      note: rel.note ?? null,
      records: recs,
      ...summarize(recs),
    };
  });

  for (const r of legacy) {
    bundles.push({
      key: `record:${r.id}`,
      release: null,
      title: firstLine(r.note) || `${r.service} ${r.version}`,
      environment: r.environment,
      status: upper(r.status) || 'PENDING',
      releasedAt: iso(r.createdAt),
      hasConfigChange: !!(r.isConfigUpdate || r.isEnvUpdate),
      configDetails: r.configDetails ?? null,
      note: r.note ?? null,
      records: [r],
      ...summarize([r]),
    });
  }

  return bundles.sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime());
}

function firstLine(text?: string | null): string {
  const line = (text ?? '').trim().split('\n')[0].trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

// The statuses of the service records that disagree with the bundle's own.
export function mismatchedRecords(bundle: ReleaseBundle): ReleaseRecord[] {
  return bundle.records.filter((r) => upper(r.status) !== bundle.status);
}

// The environment a release is normally promoted to next (SIT -> UAT -> Prod).
export function nextEnvironment(env: string): string | null {
  const e = upper(env);
  return e === 'SIT' ? 'UAT' : e === 'UAT' ? 'Prod' : null;
}
