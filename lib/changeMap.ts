// Feature / fix to build mapping: which builds contain a change, and how sure
// the tracker is about it.
//
// Evidence, strongest first:
//   verified     a person marked a ChangeBuild row verified (with evidence).
//   recorded     a release record for exactly this service + version names
//                the change key in its note (the audit log; read on the fly,
//                never copied into the Change tables).
//   declared     a ChangeBuild row someone added by hand, not yet verified.
//   inferred     the build was first recorded AFTER the build that introduced
//                the change, for the same service. Likely, not proven: a
//                hotfix branch built later may still lack it.
//   not-included the build was first recorded BEFORE the introducing build.
//   unknown      nothing to go on (e.g. hash tags never logged).
// Only "verified" and "recorded" count as evidence; everything else is shown
// as unverified.

import { isDeployed } from './currentVersions.js';
import { sameVersion } from './healthModel.js';

export type Inclusion = 'verified' | 'recorded' | 'declared' | 'inferred' | 'not-included' | 'unknown';
export const PROVEN: ReadonlySet<Inclusion> = new Set(['verified', 'recorded']);

export interface ChangeRow {
  id: string;
  key: string;
  title: string;
  kind: string;
  notes?: string | null;
}

export interface ChangeBuildRow {
  id: string;
  changeId: string;
  role: string;
  service: string;
  version: string;
  relation: 'introduced' | 'included' | string;
  verified: boolean;
  evidence?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | Date | null;
}

export interface MappingRecord {
  id: string;
  environment: string;
  server: string; // role
  service: string;
  version: string;
  status: string;
  note?: string | null;
  createdAt: string | Date;
  isBuildUpdate?: boolean;
}

// JIRA-style keys: PROJ-123. Case-sensitive on purpose so prose like
// "covid-19" is not read as a key.
const KEY_IN_TEXT = /\b[A-Z][A-Z0-9]{1,9}-\d{1,7}\b/g;
export const CHANGE_KEY = /^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,7}$/;

export function extractChangeKeys(text: string | null | undefined): string[] {
  return text ? [...new Set(text.match(KEY_IN_TEXT) ?? [])] : [];
}

export interface BuildRef {
  role: string;
  service: string;
  version: string;
}

export interface ChangeEvidence extends BuildRef {
  source: 'record' | 'manual';
  relation: 'introduced' | 'included';
  verified: boolean;
  recordId: string | null;
  environment: string | null;
  at: string | null;
  evidence: string | null;
}

export interface ChangeInfo {
  key: string;
  title: string | null; // null: only seen in record notes
  kind: string | null;
  id: string | null;
  evidence: ChangeEvidence[];
  introduced: BuildRef[]; // earliest-recorded build per role + service
}

export interface ChangeIndex {
  changes: Map<string, ChangeInfo>;
  firstSeen: Map<string, number>; // role::service::version -> earliest record time
}

const buildKey = (role: string, service: string, version: string) => `${role}::${service}::${version.trim().replace(/^v/i, '').toLowerCase()}`;
const time = (v: string | Date) => new Date(v).getTime();

export function buildChangeIndex(input: { changes: ChangeRow[]; links: ChangeBuildRow[]; records: MappingRecord[] }): ChangeIndex {
  const changes = new Map<string, ChangeInfo>();
  const get = (key: string): ChangeInfo => {
    let c = changes.get(key);
    if (!c) {
      c = { key, title: null, kind: null, id: null, evidence: [], introduced: [] };
      changes.set(key, c);
    }
    return c;
  };
  const byId = new Map(input.changes.map((c) => [c.id, c]));
  for (const c of input.changes) Object.assign(get(c.key), { title: c.title, kind: c.kind, id: c.id });

  const firstSeen = new Map<string, number>();
  for (const r of input.records) {
    if (r.isBuildUpdate === false || String(r.status).toUpperCase() === 'FAILED') continue;
    const k = buildKey(r.server, r.service, r.version);
    const t = time(r.createdAt);
    if (!firstSeen.has(k) || t < firstSeen.get(k)!) firstSeen.set(k, t);
    for (const key of extractChangeKeys(r.note)) {
      get(key).evidence.push({
        role: r.server, service: r.service, version: r.version, source: 'record', relation: 'introduced', verified: false,
        recordId: r.id, environment: r.environment, at: new Date(r.createdAt).toISOString(), evidence: null,
      });
    }
  }
  for (const l of input.links) {
    const c = byId.get(l.changeId);
    if (!c) continue;
    get(c.key).evidence.push({
      role: l.role, service: l.service, version: l.version, source: 'manual', relation: l.relation === 'included' ? 'included' : 'introduced',
      verified: !!l.verified, recordId: null, environment: null, at: l.verifiedAt ? new Date(l.verifiedAt).toISOString() : null, evidence: l.evidence ?? null,
    });
  }

  // The introducing build per service: an explicit "introduced" link, else the
  // earliest-recorded build whose evidence names the change.
  for (const c of changes.values()) {
    const services = new Set(c.evidence.map((e) => `${e.role}::${e.service}`));
    for (const rs of services) {
      const [role, service] = rs.split('::');
      const mine = c.evidence.filter((e) => e.role === role && e.service === service);
      const explicit = mine.find((e) => e.source === 'manual' && e.relation === 'introduced');
      const pick =
        explicit ??
        mine
          .filter((e) => e.relation === 'introduced')
          .sort((a, b) => (firstSeen.get(buildKey(role, service, a.version)) ?? Infinity) - (firstSeen.get(buildKey(role, service, b.version)) ?? Infinity))[0];
      if (pick) c.introduced.push({ role, service, version: pick.version });
    }
  }
  return { changes, firstSeen };
}

export interface InclusionResult {
  inclusion: Inclusion;
  detail: string;
}

// Does build (role, service, version) contain change `key`?
export function inclusionOf(index: ChangeIndex, key: string, build: BuildRef): InclusionResult {
  const c = index.changes.get(key);
  if (!c) return { inclusion: 'unknown', detail: `${key} is not known to the tracker.` };
  const exact = c.evidence.filter((e) => e.role === build.role && e.service === build.service && sameVersion(e.version, build.version));
  if (exact.some((e) => e.source === 'manual' && e.verified)) return { inclusion: 'verified', detail: 'Verified by hand.' };
  const rec = exact.find((e) => e.source === 'record');
  if (rec) return { inclusion: 'recorded', detail: `Named in the ${rec.environment} release record of ${rec.version}.` };
  if (exact.length) return { inclusion: 'declared', detail: 'Mapped by hand, not verified yet.' };

  const intro = c.introduced.find((i) => i.role === build.role && i.service === build.service);
  if (!intro) return { inclusion: 'unknown', detail: `No build of ${build.service} is linked to ${key}.` };
  const tIntro = index.firstSeen.get(buildKey(intro.role, intro.service, intro.version));
  const tThis = index.firstSeen.get(buildKey(build.role, build.service, build.version));
  if (tIntro === undefined || tThis === undefined) {
    return { inclusion: 'unknown', detail: `Introduced in ${intro.version}; ${tThis === undefined ? build.version : intro.version} was never logged, so the order is unknown.` };
  }
  return tThis > tIntro
    ? { inclusion: 'inferred', detail: `Introduced in ${intro.version}; ${build.version} was logged later, so it probably contains it (unverified).` }
    : { inclusion: 'not-included', detail: `Introduced in ${intro.version}; ${build.version} was logged before it.` };
}

// Changes linked to any build of this service, with what a given build says.
export function changesForBuild(index: ChangeIndex, build: BuildRef): (InclusionResult & { key: string; title: string | null })[] {
  const out: (InclusionResult & { key: string; title: string | null })[] = [];
  for (const c of index.changes.values()) {
    if (!c.evidence.some((e) => e.role === build.role && e.service === build.service)) continue;
    out.push({ key: c.key, title: c.title, ...inclusionOf(index, c.key, build) });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// Builds of a service seen anywhere (records of any environment), newest
// first, for picking an exact build. FAILED and config-only records are not
// builds.
export function knownBuilds(records: MappingRecord[], role: string, service: string): { version: string; firstSeen: string; environments: string[] }[] {
  const byVersion = new Map<string, { version: string; first: number; envs: Set<string> }>();
  for (const r of records) {
    if (r.server !== role || r.service !== service || r.isBuildUpdate === false || !isDeployed(r.status)) continue;
    const k = r.version.trim().replace(/^v/i, '').toLowerCase();
    const cur = byVersion.get(k) ?? { version: r.version, first: Infinity, envs: new Set<string>() };
    cur.first = Math.min(cur.first, time(r.createdAt));
    cur.envs.add(r.environment);
    byVersion.set(k, cur);
  }
  return [...byVersion.values()]
    .sort((a, b) => b.first - a.first)
    .map((b) => ({ version: b.version, firstSeen: new Date(b.first).toISOString(), environments: [...b.envs].sort() }));
}
