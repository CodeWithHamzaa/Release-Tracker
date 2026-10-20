// Environment comparison for the patch planner: for every service of every
// role, what the SOURCE environment runs (the build to promote) against what
// the TARGET runs now, plus the config differences between their vault files.
//
// Three kinds of evidence are kept apart and never merged:
//   expected  what the tracker says should run: the vault compose tag, or a
//             newer deployed build record (lib/currentVersions.ts).
//   observed  what a server reported running: the newest status / snapshot /
//             receipt (lib/healthModel.ts), with its age.
//   imageId   the immutable image ID, only where a deployment receipt
//             recorded it (docker save/load keeps the image ID, not a
//             registry digest).
// A side with no evidence is "unknown", never guessed. A fresh observation
// that disagrees with the expected version makes the row a "conflict".
//
// Pure: the API (lib/planningApi.ts) loads the data, this decides. Config
// values go through lib/redact.ts before they leave this module.

import type { ReleaseRecord } from './types.js';
import { currentVersion, recordsFor, withTag, VersionRecord } from './currentVersions.js';
import { envDrift, imageRepo, imageTag, summarizeCompose, ComposeServiceSummary, EnvTokens } from './configDrift.js';
import { ageLevel, sameVersion, serverHealth, AgeLevel, HealthReportMeta } from './healthModel.js';
import type { ParsedReceipt } from './receiptParse.js';
import type { ToolkitContainer } from './toolkitParse.js';
import { isEnvFileName, parseEnvFile } from './envFile.js';
import { isComposePath, primaryComposePath } from './composeSync.js';
import { EXECUTION_ORDER, ROLES, envLabel, sameEnvironment } from './environments.js';
import { isSecret, redactValue, REDACTED } from './redact.js';

// ── Inputs ──────────────────────────────────────────────────────────────────

export type PlanningRecord = VersionRecord & Partial<Pick<ReleaseRecord, 'note' | 'developerName'>>;

export interface PlanningDeployment {
  service: string; // catalog name
  role: string;
  environment: string;
  composeKey: string; // key under services:
  containerName: string | null;
  image: string | null;
  tag: string | null;
  composeFile: string | null; // vault file it came from, e.g. docker-compose.yml
  vaultVersion: number | null;
  vaultAt: string | null; // createdAt of that vault version
}

export interface PlanningServer {
  environment: string;
  role: string;
  ip: string | null;
  domain: string | null;
  composePath: string | null; // folder holding the compose file
  runAs: string | null;
  access: string | null;
  envFiles: string[];
  toolkitVersion: string | null;
}

export interface PlanningVaultFile {
  environment: string;
  role: string;
  path: string;
  version: number;
  createdAt: string;
  content: string;
}

export interface PlanningData {
  records: PlanningRecord[];
  deployments: PlanningDeployment[];
  reports: HealthReportMeta[]; // latest per environment + role + kind
  servers: PlanningServer[];
  vaultFiles: PlanningVaultFile[]; // latest version of each file
}

// ── Output ──────────────────────────────────────────────────────────────────

export interface ExpectedVersion {
  image: string | null;
  tag: string | null;
  source: 'vault' | 'record';
  at: string | null;
  recordId: string | null;
  recordStatus: string | null; // SUCCESS | PENDING when from a record
  vaultVersion: number | null;
  superseded: string | null; // the other source's version when it disagrees
}

export interface ObservedVersion {
  image: string;
  tag: string | null;
  container: string;
  state: string;
  health: string | null;
  at: string;
  from: 'status' | 'snapshot' | 'receipt';
  freshness: AgeLevel;
}

export interface ServiceSide {
  environment: string;
  inCompose: boolean; // the vault compose file of this environment has it
  composeKey: string | null;
  containerName: string | null;
  composeFile: string | null;
  expected: ExpectedVersion | null;
  observed: ObservedVersion | null;
  imageId: string | null; // from a receipt, when its image matches
  notes: string[]; // stale / missing / differing evidence, in plain words
}

export type ServiceStatus = 'update' | 'unchanged' | 'missing' | 'target-only' | 'conflict' | 'unknown';

export interface ComposeFieldDiff {
  field: 'ports' | 'envFiles' | 'volumes' | 'dependsOn' | 'networks' | 'environmentKeys';
  source: string;
  target: string;
}

export interface VersionRef {
  image: string | null;
  tag: string | null;
  imageId: string | null;
  basis: 'expected' | 'observed';
}

export interface ServiceComparison {
  key: string; // role::service, stable across requests
  role: string;
  service: string;
  status: ServiceStatus;
  desired: VersionRef | null; // what the target should run after the patch
  current: VersionRef | null; // what the target runs now
  repoChanged: boolean;
  reasons: string[];
  source: ServiceSide;
  target: ServiceSide;
  composeDiff: ComposeFieldDiff[];
  dependsOn: string[]; // compose keys this service starts after (target, else source)
}

export type ConfigChange = 'added' | 'removed' | 'changed' | 'env-specific';
export type ConfigAction = 'add' | 'review' | 'keep';

export interface ConfigKeyDiff {
  file: string;
  key: string;
  change: ConfigChange;
  secret: boolean;
  sourceValue: string | null; // redacted; null when hidden or absent
  targetValue: string | null;
  proposedValue: string | null; // for 'add': the source value with target IPs/domain; null = decide by hand
  environmentSpecific: boolean;
  action: ConfigAction;
  reason: string;
}

export interface ConfigFileDiff {
  path: string;
  presence: 'both' | 'source-only' | 'target-only';
  source: { version: number; at: string } | null;
  target: { version: number; at: string } | null;
  keys: ConfigKeyDiff[]; // differences only
  duplicates: { source: string[]; target: string[] };
}

export interface ServerRef {
  environment: string;
  role: string;
  ip: string | null;
  domain: string | null;
  composePath: string | null;
  runAs: string | null;
  access: string | null;
  envFiles: string[];
  toolkitVersion: string | null;
  known: boolean; // a registry row exists
}

export interface RoleComparison {
  role: string;
  sourceServer: ServerRef;
  targetServer: ServerRef;
  composeFile: { source: { path: string; version: number; at: string } | null; target: { path: string; version: number; at: string } | null };
  observedAt: { source: string | null; target: string | null };
  services: ServiceComparison[];
  config: ConfigFileDiff[];
  missingRequired: string[]; // ${VARS} the target compose needs that its .env lacks
  notes: string[];
}

export interface EnvironmentComparison {
  sourceEnv: string;
  targetEnv: string;
  generatedAt: string;
  valuesIncluded: boolean; // false: config values were withheld (not an admin)
  roles: RoleComparison[];
  counts: Record<ServiceStatus, number>;
}

export interface CompareOptions {
  sourceEnv: string;
  targetEnv: string;
  includeValues?: boolean; // config values (always redacted); default false
  now?: Date;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const repoOf = (image: string | null) => (image ? image.split('@')[0].replace(/:[^/:]+$/, '') : null);
const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);

function serverRef(servers: PlanningServer[], environment: string, role: string): ServerRef {
  const s = servers.find((x) => sameEnvironment(x.environment, environment) && x.role === role);
  return {
    environment,
    role,
    ip: s?.ip ?? null,
    domain: s?.domain ?? null,
    composePath: s?.composePath ?? null,
    runAs: s?.runAs ?? null,
    access: s?.access ?? null,
    envFiles: s?.envFiles ?? [],
    toolkitVersion: s?.toolkitVersion ?? null,
    known: !!s,
  };
}

// Per environment: each server IP and the domain become a neutral placeholder,
// so "10.1.1.5" on SIT and "10.2.2.5" on UAT compare as the same value.
export function envTokens(servers: PlanningServer[]): EnvTokens {
  const out: EnvTokens = {};
  for (const s of servers) {
    const env = envLabel(s.environment);
    const list = (out[env] ??= []);
    if (s.ip && !list.some((t) => t.token === s.ip)) list.push({ token: s.ip, placeholder: `<IP:${s.role}>` });
    if (s.domain && !list.some((t) => t.token === s.domain)) list.push({ token: s.domain, placeholder: '<DOMAIN>' });
  }
  return out;
}

// Replace placeholders with the target's own tokens. null when a placeholder
// has no target value (that server's IP is not in the registry).
function fillPlaceholders(value: string, tokens: { token: string; placeholder: string }[]): string | null {
  let out = value;
  for (const { token, placeholder } of tokens) out = out.split(placeholder).join(token);
  return /<IP:[^>]+>|<DOMAIN>/.test(out) ? null : out;
}

function normalize(value: string, tokens: { token: string; placeholder: string }[]): string {
  let out = value;
  for (const { token, placeholder } of [...tokens].sort((a, b) => b.token.length - a.token.length)) {
    if (!token) continue;
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\w.-])${esc}(?![\\w-]|\\.\\w)`, 'g'), placeholder);
  }
  return out;
}

// Same patterns alara_release_compare.sh treats as routinely per-environment.
const PER_ENV_KEY = /(_URL|_ENDPOINT|_DOMAIN|_HOST|_URI|_PORT|_REGION)/i;

function latestReceipt(reports: HealthReportMeta[]): ParsedReceipt | null {
  const r = reports.filter((x) => x.kind === 'receipt').sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1))[0];
  return r ? (r.parsed as ParsedReceipt) : null;
}

const refRepoName = (ref: string) => {
  const last = ref.split('@')[0].split('/').pop() ?? ref;
  return last.includes(':') ? last.slice(0, last.lastIndexOf(':')) : last;
};

// Image ID recorded by the newest receipt for this service, if its tag matches.
function receiptImageId(receipt: ParsedReceipt | null, names: string[], tag: string | null): string | null {
  if (!receipt || !tag) return null;
  const img = receipt.images.find((i) => (names.includes(i.service) || names.includes(refRepoName(i.newRef))) && sameVersion(imageTag(i.newRef), tag));
  return img?.newId && /^sha256:[0-9a-f]{12,64}$/.test(img.newId) ? img.newId : null;
}

function matchContainer(containers: ToolkitContainer[], names: string[], repo: string | null): ToolkitContainer | null {
  return (
    containers.find((c) => c.service && names.includes(c.service)) ||
    containers.find((c) => names.includes(c.name)) ||
    (repo ? containers.find((c) => imageRepo(c.image) === repo) : null) ||
    null
  );
}

// ── Sides ───────────────────────────────────────────────────────────────────

interface EnvRoleView {
  environment: string;
  deployments: PlanningDeployment[];
  records: PlanningRecord[];
  containers: ToolkitContainer[];
  containersFrom: ObservedVersion['from'] | null;
  observedAt: string | null;
  receipt: ParsedReceipt | null;
  compose: ComposeServiceSummary[];
  composeMeta: { path: string; version: number; at: string } | null;
  composeText: string | null;
}

function envRoleView(data: PlanningData, environment: string, role: string): EnvRoleView {
  const reports = data.reports.filter((r) => sameEnvironment(r.environment, environment) && r.role === role);
  const health = reports.length ? serverHealth(reports) : null;
  const files = data.vaultFiles.filter((f) => sameEnvironment(f.environment, environment) && f.role === role);
  const composePath = primaryComposePath(files.map((f) => f.path));
  const composeFile = composePath ? files.find((f) => f.path === composePath) ?? null : null;
  let compose: ComposeServiceSummary[] = [];
  if (composeFile) {
    try {
      compose = summarizeCompose(composeFile.content);
    } catch {
      compose = [];
    }
  }
  return {
    environment,
    deployments: data.deployments.filter((d) => sameEnvironment(d.environment, environment) && d.role === role),
    records: data.records.filter((r) => sameEnvironment(r.environment, environment) && r.server === role),
    containers: health?.containers ?? [],
    containersFrom: health?.containersFrom ?? null,
    observedAt: health?.containersFrom ? health.reports[health.containersFrom]!.reportedAt : null,
    receipt: latestReceipt(reports),
    compose,
    composeMeta: composeFile ? { path: composeFile.path, version: composeFile.version, at: iso(composeFile.createdAt)! } : null,
    composeText: composeFile?.content ?? null,
  };
}

function side(view: EnvRoleView, role: string, service: string, now: Date, claimed: Set<ToolkitContainer>): ServiceSide {
  const dep = view.deployments.find((d) => d.service === service) ?? null;
  const summary = dep ? view.compose.find((s) => s.name === dep.composeKey) ?? null : null;
  const repo = imageRepo(dep?.image ?? null);
  const names = [service, dep?.composeKey, dep?.containerName, repo].filter((n): n is string => !!n);
  const notes: string[] = [];

  const recs = recordsFor(view.records, view.environment, role, names);
  const baseline = dep ? { tag: dep.tag, at: dep.vaultAt ?? new Date(0).toISOString(), version: dep.vaultVersion } : null;
  const cur = currentVersion(baseline, recs);
  let expected: ExpectedVersion | null = null;
  if (cur.source !== 'none' && cur.version) {
    expected = {
      image: cur.source === 'record' ? withTag(dep?.image ?? null, cur.version) : dep?.image ?? null,
      tag: cur.version,
      source: cur.source,
      at: cur.at,
      recordId: cur.recordId,
      recordStatus: cur.status,
      vaultVersion: cur.vaultVersion,
      superseded: cur.superseded?.version ?? null,
    };
    if (cur.status === 'PENDING') notes.push(`${envLabel(view.environment)} build ${cur.version} is PENDING (deployed, not yet confirmed).`);
  }

  const c = matchContainer(view.containers.filter((x) => !claimed.has(x)), names, repo);
  let observed: ObservedVersion | null = null;
  if (c && view.observedAt && view.containersFrom) {
    claimed.add(c);
    observed = {
      image: c.image,
      tag: imageTag(c.image),
      container: c.name,
      state: c.state,
      health: c.health,
      at: view.observedAt,
      from: view.containersFrom,
      freshness: ageLevel(view.observedAt, now),
    };
    if (observed.freshness !== 'fresh') notes.push(`Running version on ${envLabel(view.environment)} was last reported ${observed.freshness === 'old' ? 'over 30 days' : 'over 7 days'} ago.`);
    if (expected && !sameVersion(observed.tag, expected.tag)) {
      notes.push(`${envLabel(view.environment)} reported ${observed.tag ?? '?'} running but the tracker expects ${expected.tag}.`);
    }
  } else if (expected) {
    notes.push(`No health report shows this service running on ${envLabel(view.environment)} (unverified).`);
  }

  const tag = expected?.tag ?? observed?.tag ?? null;
  return {
    environment: view.environment,
    inCompose: !!summary,
    composeKey: dep?.composeKey ?? null,
    containerName: dep?.containerName ?? null,
    composeFile: dep?.composeFile ?? view.composeMeta?.path ?? null,
    expected,
    observed,
    imageId: receiptImageId(view.receipt, names, tag),
    notes,
  };
}

function composeDiff(source: ComposeServiceSummary | null, target: ComposeServiceSummary | null): ComposeFieldDiff[] {
  if (!source || !target) return [];
  const fields: ComposeFieldDiff['field'][] = ['ports', 'envFiles', 'volumes', 'dependsOn', 'networks', 'environmentKeys'];
  const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
  return fields
    .map((field) => ({ field, source: text(source[field]), target: text(target[field]) }))
    .filter((d) => d.source !== d.target);
}

function decide(src: ServiceSide, tgt: ServiceSide): Pick<ServiceComparison, 'status' | 'desired' | 'current' | 'repoChanged' | 'reasons'> {
  const reasons: string[] = [];
  const ref = (s: ServiceSide): VersionRef | null =>
    s.expected
      ? { image: s.expected.image, tag: s.expected.tag, imageId: s.imageId, basis: 'expected' }
      : s.observed
        ? { image: s.observed.image, tag: s.observed.tag, imageId: s.imageId, basis: 'observed' }
        : null;
  const desired = ref(src);
  const current = ref(tgt);
  const repoChanged = !!desired?.image && !!current?.image && repoOf(desired.image) !== repoOf(current.image);

  if (!desired) {
    return { status: current ? 'target-only' : 'unknown', desired, current, repoChanged, reasons: current ? [`Only ${envLabel(tgt.environment)} has this service. Confirm it should stay; it is never removed automatically.`] : ['No evidence on either side.'] };
  }
  if (desired.basis === 'observed') reasons.push(`${envLabel(src.environment)} version comes from a health report only: no vault file or build record (unverified).`);
  if (!current) {
    reasons.push(`${envLabel(tgt.environment)} has no such service: it must be added to the target compose file by hand.`);
    return { status: 'missing', desired, current, repoChanged, reasons };
  }

  const conflicts: string[] = [];
  for (const s of [src, tgt]) {
    if (s.expected && s.observed && s.observed.freshness === 'fresh' && !sameVersion(s.observed.tag, s.expected.tag)) {
      conflicts.push(`${envLabel(s.environment)}: tracker expects ${s.expected.tag}, a recent report shows ${s.observed.tag ?? '?'} running.`);
    }
  }
  if (!desired.tag || desired.tag === 'latest') conflicts.push(`${envLabel(src.environment)} image has no fixed tag (${desired.image ?? 'unknown'}): pin a version first.`);
  if (conflicts.length) return { status: 'conflict', desired, current, repoChanged, reasons: [...reasons, ...conflicts] };

  if (sameVersion(desired.tag, current.tag) && !repoChanged) return { status: 'unchanged', desired, current, repoChanged, reasons };
  if (repoChanged) reasons.push(`Image repository changes (${repoOf(current.image)} → ${repoOf(desired.image)}).`);
  return { status: 'update', desired, current, repoChanged, reasons };
}

// ── Config ──────────────────────────────────────────────────────────────────

function configDiffs(
  data: PlanningData,
  role: string,
  sourceEnv: string,
  targetEnv: string,
  includeValues: boolean
): { files: ConfigFileDiff[]; missingRequired: string[] } {
  const files = (env: string) =>
    data.vaultFiles.filter((f) => sameEnvironment(f.environment, env) && f.role === role && isEnvFileName(f.path) && !isComposePath(f.path));
  const src = files(sourceEnv);
  const tgt = files(targetEnv);
  const tokens = envTokens(data.servers);
  const srcTokens = tokens[envLabel(sourceEnv)] ?? [];
  const tgtTokens = tokens[envLabel(targetEnv)] ?? [];
  const show = (key: string, v: string | null | undefined) => (includeValues && v != null ? redactValue(key, v) : null);
  const S = envLabel(sourceEnv);
  const T = envLabel(targetEnv);

  const paths = [...new Set([...src, ...tgt].map((f) => f.path))].sort();
  const out: ConfigFileDiff[] = [];
  for (const path of paths) {
    const a = src.find((f) => f.path === path) ?? null;
    const b = tgt.find((f) => f.path === path) ?? null;
    const presence: ConfigFileDiff['presence'] = a && b ? 'both' : a ? 'source-only' : 'target-only';
    const keys: ConfigKeyDiff[] = [];
    if (a && b) {
      const rows = envDrift({ [S]: a.content, [T]: b.content }, { [S]: srcTokens, [T]: tgtTokens });
      for (const row of rows) {
        const sv = row.values[S];
        const tv = row.values[T];
        if (row.label === 'same' || (sv?.encrypted && tv?.encrypted)) continue;
        const secret = isSecret(row.key, sv?.value) || isSecret(row.key, tv?.value);
        const perEnv = PER_ENV_KEY.test(row.key);
        const base = { file: path, key: row.key, secret, sourceValue: show(row.key, sv?.value), targetValue: show(row.key, tv?.value) };
        if (sv && !tv) {
          const proposed = secret ? null : fillPlaceholders(normalize(sv.value, srcTokens), tgtTokens);
          const envSpecific = perEnv || normalize(sv.value, srcTokens) !== sv.value;
          keys.push({
            ...base,
            change: 'added',
            proposedValue: includeValues ? proposed : null,
            environmentSpecific: envSpecific,
            action: !secret && proposed !== null && !perEnv ? 'add' : 'review',
            reason: secret
              ? `Secret: set ${T}'s own value by hand (never copied from ${S}).`
              : proposed === null
                ? `Holds a ${S} address with no known ${T} equivalent: decide the ${T} value.`
                : perEnv
                  ? `Per-environment key: confirm the ${T} value before adding.`
                  : `Missing on ${T}.`,
          });
        } else if (!sv && tv) {
          keys.push({ ...base, change: 'removed', proposedValue: null, environmentSpecific: perEnv, action: 'keep', reason: `Only on ${T}: kept. Keys are never deleted automatically; remove by hand only if it is obsolete.` });
        } else if (row.label === 'expected') {
          keys.push({ ...base, change: 'env-specific', proposedValue: null, environmentSpecific: true, action: 'keep', reason: `Differs only by server IP/domain: ${T} keeps its own value.` });
        } else {
          keys.push({
            ...base,
            change: 'changed',
            proposedValue: null,
            environmentSpecific: perEnv,
            action: 'review',
            reason: secret
              ? `Secret differs: confirm ${T}'s own value is intended. Never copy ${S}'s.`
              : perEnv
                ? `Per-environment key: probably correct for ${T}; check.`
                : `Values differ: decide whether ${T} should match ${S}.`,
          });
        }
      }
    }
    out.push({
      path,
      presence,
      source: a ? { version: a.version, at: iso(a.createdAt)! } : null,
      target: b ? { version: b.version, at: iso(b.createdAt)! } : null,
      keys,
      duplicates: { source: a ? parseEnvFile(a.content).duplicates : [], target: b ? parseEnvFile(b.content).duplicates : [] },
    });
  }

  // ${VAR} in the target compose with no default must come from its .env.
  const targetAll = data.vaultFiles.filter((f) => sameEnvironment(f.environment, targetEnv) && f.role === role);
  const composePathT = primaryComposePath(targetAll.map((f) => f.path));
  const composeT = composePathT ? targetAll.find((f) => f.path === composePathT) : null;
  const missingRequired: string[] = [];
  if (composeT) {
    const dotEnv = tgt.find((f) => f.path === '.env');
    const have = new Set(dotEnv ? parseEnvFile(dotEnv.content).entries.map((e) => e.key) : []);
    for (const m of composeT.content.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-?][^}]*)?\}/g)) {
      const hasDefault = /:?-/.test(m[0].slice(2 + m[1].length));
      if (!hasDefault && !have.has(m[1]) && !missingRequired.includes(m[1])) missingRequired.push(m[1]);
    }
  }
  return { files: out, missingRequired };
}

// ── Entry point ─────────────────────────────────────────────────────────────

const ROLE_ORDER = [...EXECUTION_ORDER, ...ROLES.filter((r) => !(EXECUTION_ORDER as readonly string[]).includes(r))];

export function compareEnvironments(data: PlanningData, opts: CompareOptions): EnvironmentComparison {
  const now = opts.now ?? new Date();
  const includeValues = !!opts.includeValues;
  const roles: RoleComparison[] = [];
  const counts: Record<ServiceStatus, number> = { update: 0, unchanged: 0, missing: 0, 'target-only': 0, conflict: 0, unknown: 0 };

  const knownRoles = new Set<string>([
    ...ROLE_ORDER,
    ...data.deployments.map((d) => d.role),
    ...data.servers.map((s) => s.role),
  ]);
  for (const role of [...ROLE_ORDER, ...[...knownRoles].filter((r) => !ROLE_ORDER.includes(r as any)).sort()]) {
    const sv = envRoleView(data, opts.sourceEnv, role);
    const tv = envRoleView(data, opts.targetEnv, role);

    // Services: the catalog's deployments on either side, then build records
    // for services no compose file lists, then containers nobody claimed.
    const names = [...new Set([...sv.deployments, ...tv.deployments].map((d) => d.service))];
    const known = new Set(names.flatMap((n) => [n, ...[...sv.deployments, ...tv.deployments].filter((d) => d.service === n).flatMap((d) => [d.composeKey, d.containerName, imageRepo(d.image)])]));
    for (const r of [...sv.records, ...tv.records]) {
      if (r.isBuildUpdate !== false && !known.has(r.service)) {
        names.push(r.service);
        known.add(r.service);
      }
    }
    names.sort();

    const claimedS = new Set<ToolkitContainer>();
    const claimedT = new Set<ToolkitContainer>();
    const services: ServiceComparison[] = names.map((service) => {
      const s = side(sv, role, service, now, claimedS);
      const t = side(tv, role, service, now, claimedT);
      const sumS = s.composeKey ? sv.compose.find((x) => x.name === s.composeKey) ?? null : null;
      const sumT = t.composeKey ? tv.compose.find((x) => x.name === t.composeKey) ?? null : null;
      return {
        key: `${role}::${service}`,
        role,
        service,
        ...decide(s, t),
        source: s,
        target: t,
        composeDiff: composeDiff(sumS, sumT),
        dependsOn: (sumT ?? sumS)?.dependsOn ?? [],
      };
    });

    // Containers no catalog service claimed: reported, never acted on.
    for (const [view, claimed] of [[sv, claimedS], [tv, claimedT]] as const) {
      for (const c of view.containers.filter((x) => !claimed.has(x))) {
        const name = c.service || c.name;
        if (services.some((x) => x.service === name)) continue;
        const s = side(sv, role, name, now, claimedS);
        const t = side(tv, role, name, now, claimedT);
        services.push({ key: `${role}::${name}`, role, service: name, ...decide(s, t), source: s, target: t, composeDiff: [], dependsOn: [] });
      }
    }

    const config = configDiffs(data, role, opts.sourceEnv, opts.targetEnv, includeValues);
    const notes: string[] = [];
    const targetServer = serverRef(data.servers, opts.targetEnv, role);
    if (!targetServer.known) notes.push(`No server registry entry for ${envLabel(opts.targetEnv)} / ${role}: server, folder and account are unknown.`);
    if (!tv.composeMeta && services.length) notes.push(`No ${envLabel(opts.targetEnv)} compose file in the vault for ${role}: compose path and service names are unverified.`);
    if (!sv.observedAt && services.length) notes.push(`No health report for ${envLabel(opts.sourceEnv)} / ${role}: running versions there are unknown.`);
    if (!tv.observedAt && services.length) notes.push(`No health report for ${envLabel(opts.targetEnv)} / ${role}: running versions there are unknown.`);

    if (!services.length && !config.files.length) continue;
    for (const s of services) counts[s.status]++;
    roles.push({
      role,
      sourceServer: serverRef(data.servers, opts.sourceEnv, role),
      targetServer,
      composeFile: { source: sv.composeMeta, target: tv.composeMeta },
      observedAt: { source: sv.observedAt, target: tv.observedAt },
      services,
      config: config.files,
      missingRequired: config.missingRequired,
      notes,
    });
  }

  return {
    sourceEnv: opts.sourceEnv,
    targetEnv: opts.targetEnv,
    generatedAt: now.toISOString(),
    valuesIncluded: includeValues,
    roles,
    counts,
  };
}

export { REDACTED };
