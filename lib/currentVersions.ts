// Current image version per service + environment. The vault compose file is
// the baseline; any later deployed release record (the audit log) wins, so the
// daily SIT builds logged as records move the version without re-uploading
// docker-compose.yml. A compose re-upload dated after the latest record wins
// again, and the losing value is reported as superseded.
//
// Pure and computed on read: editing, backdating or deleting a record changes
// the answer at once, and vault files are never rewritten.

import type { ReleaseRecord } from './types.js';
import type { ComposeServiceSummary } from './configDrift.js';
import { imageRepo } from './configDrift.js';
import { isEnvFileName } from './envFile.js';
import { isComposePath } from './composeSync.js';

// PENDING = deployed, waiting for the bank's test. FAILED never counts.
const DEPLOYED = new Set(['SUCCESS', 'PENDING']);
export const isDeployed = (status: unknown) => DEPLOYED.has(String(status).toUpperCase());

const norm = (v: string | null | undefined) => (v ?? '').trim().replace(/^v/i, '').toLowerCase();
const sameEnv = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const time = (v: string | Date) => new Date(v).getTime();

export type VersionRecord = Pick<
  ReleaseRecord,
  'id' | 'environment' | 'server' | 'service' | 'version' | 'status' | 'createdAt'
> &
  Partial<Pick<ReleaseRecord, 'isBuildUpdate' | 'isEnvUpdate' | 'isConfigUpdate'>>;

export interface Baseline {
  tag: string | null; // compose image tag
  at: string | Date; // createdAt of the vault version that set it
  version?: number | null; // vault version number, for display
}

export interface CurrentVersion {
  version: string | null;
  source: 'vault' | 'record' | 'none';
  at: string | null;
  recordId: string | null;
  status: string | null; // SUCCESS | PENDING when from a record
  vaultVersion: number | null; // the vault version used as the baseline
  superseded: { source: 'vault' | 'record'; version: string | null } | null; // the losing value, when it differs
}

// Records for one environment + role whose service is any of `names` (the
// catalog name, compose key, container name or image repository).
export function recordsFor<R extends VersionRecord>(records: R[], environment: string, role: string, names: (string | null | undefined)[]): R[] {
  const wanted = new Set(names.filter((n): n is string => !!n));
  return records.filter((r) => sameEnv(r.environment, environment) && r.server === role && wanted.has(r.service));
}

export function currentVersion(baseline: Baseline | null, records: VersionRecord[]): CurrentVersion {
  let latest: VersionRecord | null = null;
  for (const r of records) {
    // Only builds set an image version; a config- or env-only record's version
    // field says nothing about the image.
    if (!isDeployed(r.status) || r.isBuildUpdate === false) continue;
    if (!latest || time(r.createdAt) > time(latest.createdAt)) latest = r;
  }
  const vaultVersion = baseline?.version ?? null;
  if (!latest && !baseline) {
    return { version: null, source: 'none', at: null, recordId: null, status: null, vaultVersion, superseded: null };
  }
  // Same instant: the record wins (it is the more deliberate statement).
  const recordWins = !!latest && (!baseline || time(latest.createdAt) >= time(baseline.at));
  const differs = !!latest && !!baseline && norm(latest.version) !== norm(baseline.tag);
  if (recordWins) {
    return {
      version: latest!.version,
      source: 'record',
      at: new Date(latest!.createdAt).toISOString(),
      recordId: latest!.id,
      status: String(latest!.status).toUpperCase(),
      vaultVersion,
      superseded: differs ? { source: 'vault', version: baseline!.tag } : null,
    };
  }
  return {
    version: baseline!.tag,
    source: 'vault',
    at: new Date(baseline!.at).toISOString(),
    recordId: null,
    status: null,
    vaultVersion,
    superseded: differs ? { source: 'record', version: latest!.version } : null,
  };
}

// Replace the tag in "registry:5000/repo/name:tag" (a digest is dropped).
export function withTag(image: string | null, version: string): string | null {
  if (!image) return null;
  const at = image.indexOf('@');
  const base = at === -1 ? image : image.slice(0, at);
  const colon = base.lastIndexOf(':');
  const repo = colon > base.lastIndexOf('/') ? base.slice(0, colon) : base;
  return `${repo}:${version}`;
}

// The parsed vault compose file of one environment + role, with each
// service's tag and image replaced by its current version. Ports, volumes and
// env files stay as the vault file says: records carry none of them.
export function applyCurrentVersions(
  summaries: ComposeServiceSummary[],
  baseline: { at: string | Date; version?: number | null },
  environment: string,
  role: string,
  records: VersionRecord[]
): { summaries: ComposeServiceSummary[]; versions: Record<string, CurrentVersion> } {
  const versions: Record<string, CurrentVersion> = {};
  const out = summaries.map((s) => {
    const mine = recordsFor(records, environment, role, [s.name, s.containerName, imageRepo(s.image)]);
    const cur = currentVersion({ tag: s.tag, at: baseline.at, version: baseline.version }, mine);
    versions[s.name] = cur;
    if (cur.source !== 'record' || !cur.version) return s;
    return { ...s, tag: cur.version, image: withTag(s.image, cur.version) ?? s.image };
  });
  return { summaries: out, versions };
}

// ── Stale-vault flags ───────────────────────────────────────────────────────

export interface VaultFileTimes {
  environment: string;
  role: string;
  path: string;
  latestAt: string | Date | null; // createdAt of the newest version
  latestVersion?: number | null;
}

export interface StaleFlags {
  environment: string;
  role: string;
  composePath: string | null;
  composeVersion: number | null;
  buildsSince: number; // deployed build records newer than the compose file (expected, info only)
  configStale: string | null; // createdAt of a config-change record newer than the compose file
  envStale: string | null; // createdAt of an env-change record newer than the newest env file
}

// Per environment + role. Records don't say which env file changed, so env
// changes are compared with the newest env file of that role.
export function staleVaultFlags(files: VaultFileTimes[], records: VersionRecord[]): StaleFlags[] {
  const keys = new Map<string, { environment: string; role: string }>();
  for (const f of files) keys.set(`${f.environment.toUpperCase()}\u0000${f.role}`, { environment: f.environment, role: f.role });

  const out: StaleFlags[] = [];
  for (const { environment, role } of keys.values()) {
    const mine = files.filter((f) => sameEnv(f.environment, environment) && f.role === role && f.latestAt);
    const compose = mine
      .filter((f) => isComposePath(f.path))
      .sort((a, b) => (a.path === 'docker-compose.yml' ? -1 : b.path === 'docker-compose.yml' ? 1 : a.path.localeCompare(b.path)))[0];
    const envTimes = mine.filter((f) => isEnvFileName(f.path)).map((f) => time(f.latestAt!));
    const newestEnv = envTimes.length ? Math.max(...envTimes) : null;
    const recs = records.filter((r) => sameEnv(r.environment, environment) && r.server === role && isDeployed(r.status));

    const composeAt = compose ? time(compose.latestAt!) : null;
    const after = (t: number | null) => (r: VersionRecord) => t !== null && time(r.createdAt) > t;
    const newest = (list: VersionRecord[]) =>
      list.length ? new Date(Math.max(...list.map((r) => time(r.createdAt)))).toISOString() : null;

    out.push({
      environment,
      role,
      composePath: compose?.path ?? null,
      composeVersion: compose?.latestVersion ?? null,
      buildsSince: composeAt === null ? 0 : recs.filter((r) => r.isBuildUpdate !== false && after(composeAt)(r)).length,
      configStale: newest(recs.filter((r) => r.isConfigUpdate && after(composeAt)(r))),
      envStale: newest(recs.filter((r) => r.isEnvUpdate && after(newestEnv)(r))),
    });
  }
  return out;
}
