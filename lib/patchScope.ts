// What a patch will change: the operator's scope choice turned into exactly
// one target image per service, from an environment comparison
// (lib/envCompare.ts) and the change mapping (lib/changeMap.ts).
//
// Modes:
//   builds     only the services picked, each at the build picked (default:
//              what the source runs).
//   full-sync  every service whose source build differs from the target, plus
//              services the target lacks. Conflicts are left out unless also
//              picked by hand, so unclear data is never promoted silently.
// Either mode can add change keys (JIRA-123): the services those changes live
// in join the scope at the source build, which must contain the change.
//
// One image per service, always the final one: builds logged between the
// target's current build and the chosen one are listed for information only
// and never loaded one by one.

import type { EnvironmentComparison, ServiceComparison, ServiceStatus } from './envCompare.js';
import { changesForBuild, inclusionOf, knownBuilds, ChangeIndex, InclusionResult, MappingRecord, PROVEN } from './changeMap.js';
import { sameVersion } from './healthModel.js';
import { withTag } from './currentVersions.js';
import { envLabel } from './environments.js';

export type ScopeMode = 'builds' | 'full-sync';

export interface ScopeSelection {
  key: string; // role::service, from the comparison
  version?: string | null; // a specific build; default: the source build
}

export interface PatchScopeInput {
  mode: ScopeMode;
  selections: ScopeSelection[];
  changeKeys: string[];
  includeConfig: boolean;
}

export interface ScopeImage {
  image: string | null;
  tag: string | null;
  imageId: string | null;
}

export interface ScopeItem {
  key: string;
  role: string;
  service: string;
  status: ServiceStatus;
  from: ScopeImage | null; // what the target runs now (rollback point)
  to: ScopeImage; // the one image to load and deploy
  chosen: 'source' | 'specific-build';
  why: string[]; // "selected", "sync", "change JIRA-123"
  newService: boolean; // not in the target compose yet
  changes: (InclusionResult & { key: string; title: string | null })[];
  skippedBuilds: string[]; // intermediate builds that are NOT loaded
  warnings: string[];
  blocking: string[]; // must be resolved by hand before deploying
}

export interface ResolvedScope {
  mode: ScopeMode;
  items: ScopeItem[];
  skipped: { key: string; reason: string }[];
  configRoles: string[]; // roles whose config differences go into the plan
  warnings: string[];
  errors: string[];
}

const VERSION_TEXT = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const ROLE_SERVICE_KEY = /^[^:]{1,100}::[^:]{1,100}$/;

export type ScopeCheck = { ok: true; scope: PatchScopeInput } | { ok: false; message: string };

// Validate the client's scope body (POST /api/patch-plans/preview).
export function parseScopeInput(body: unknown): ScopeCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Send the scope as an object.' };
  const b = body as any;
  if (b.mode !== 'builds' && b.mode !== 'full-sync') return { ok: false, message: "mode must be 'builds' or 'full-sync'." };
  const sel = b.selections ?? [];
  if (!Array.isArray(sel) || sel.length > 300) return { ok: false, message: 'selections must be a list (at most 300).' };
  const selections: ScopeSelection[] = [];
  for (const s of sel) {
    if (!s || typeof s.key !== 'string' || !ROLE_SERVICE_KEY.test(s.key)) return { ok: false, message: 'Each selection needs a key like "Bot-Builder::ldap-connector".' };
    if (s.version !== undefined && s.version !== null && (typeof s.version !== 'string' || !VERSION_TEXT.test(s.version.trim()))) {
      return { ok: false, message: `Build "${String(s.version).slice(0, 40)}" is not a valid image tag.` };
    }
    selections.push({ key: s.key, version: s.version ? s.version.trim() : null });
  }
  const keys = b.changeKeys ?? [];
  if (!Array.isArray(keys) || keys.length > 100 || keys.some((k: unknown) => typeof k !== 'string' || !/^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,7}$/.test(k))) {
    return { ok: false, message: 'changeKeys must be a list of keys like JIRA-123.' };
  }
  if (b.includeConfig !== undefined && typeof b.includeConfig !== 'boolean') return { ok: false, message: 'includeConfig must be true or false.' };
  return { ok: true, scope: { mode: b.mode, selections, changeKeys: keys.map((k: string) => k.toUpperCase()), includeConfig: b.includeConfig ?? true } };
}

function item(row: ServiceComparison, version: string | null, why: string, index: ChangeIndex, records: MappingRecord[], comparison: EnvironmentComparison): ScopeItem {
  const S = envLabel(comparison.sourceEnv);
  const T = envLabel(comparison.targetEnv);
  const warnings: string[] = [];
  const blocking: string[] = [];
  const desired = row.desired;
  const tag = version ?? desired?.tag ?? null;
  const repoImage = desired?.image ?? row.current?.image ?? null;
  const specific = !!version && !sameVersion(version, desired?.tag);
  const to: ScopeImage = {
    image: tag ? (specific || !desired?.image ? withTag(repoImage, tag) : desired.image) : null,
    tag,
    imageId: !specific ? desired?.imageId ?? null : null,
  };
  if (!tag) blocking.push(`No ${S} build is known for ${row.service}: pick a build.`);
  if (tag && !to.image) blocking.push(`Image repository for ${row.service} is unknown (no compose file lists it): add it to the vault first.`);
  if (row.status === 'conflict') blocking.push(...row.reasons.filter((r) => /expects|no fixed tag/.test(r)));
  if (row.status === 'missing') blocking.push(`${row.service} is not in the ${T} compose file: add its service definition by hand (ports, env_file, volumes) before deploying.`);
  if (desired?.basis === 'observed' && !specific) warnings.push(`${S} build comes from a health report only (unverified).`);

  const builds = knownBuilds(records, row.role, row.service);
  if (specific) {
    if (!builds.some((b) => sameVersion(b.version, version))) warnings.push(`Build ${version} was never logged in any environment (unverified build).`);
    else warnings.push(`Build ${version} is not what ${S} runs (${desired?.tag ?? 'unknown'}).`);
    if (row.current && sameVersion(version, row.current.tag)) warnings.push(`${T} already runs ${version}.`);
  }
  if (row.repoChanged) warnings.push(`Image repository changes: update the whole image: line, not just the tag.`);

  // Builds logged after the target's build and before the chosen one: not loaded.
  const first = (v: string | null | undefined) => (v ? builds.find((b) => sameVersion(b.version, v))?.firstSeen ?? null : null);
  const lo = first(row.current?.tag);
  const hi = first(tag);
  const skippedBuilds = lo && hi ? builds.filter((b) => b.firstSeen > lo && b.firstSeen < hi).map((b) => b.version).reverse() : [];

  return {
    key: row.key,
    role: row.role,
    service: row.service,
    status: row.status,
    from: row.current ? { image: row.current.image, tag: row.current.tag, imageId: row.current.imageId } : null,
    to,
    chosen: specific ? 'specific-build' : 'source',
    why: [why],
    newService: row.status === 'missing',
    changes: tag ? changesForBuild(index, { role: row.role, service: row.service, version: tag }) : [],
    skippedBuilds,
    warnings,
    blocking,
  };
}

export function resolveScope(comparison: EnvironmentComparison, input: PatchScopeInput, index: ChangeIndex, records: MappingRecord[]): ResolvedScope {
  const rows = new Map(comparison.roles.flatMap((r) => r.services).map((s) => [s.key, s]));
  const items = new Map<string, ScopeItem>();
  const skipped: ResolvedScope['skipped'] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const T = envLabel(comparison.targetEnv);
  const S = envLabel(comparison.sourceEnv);

  // Explicit picks first: they decide the build. A second pick of the same
  // service replaces the first (one image per service).
  const picked = new Map<string, ScopeSelection>();
  for (const s of input.selections) {
    if (picked.has(s.key)) warnings.push(`${s.key.split('::')[1]} was picked twice; only ${s.version || 'the source build'} is used (one image per service).`);
    picked.set(s.key, s);
  }
  for (const [key, s] of picked) {
    const row = rows.get(key);
    if (!row) {
      errors.push(`${key.replace('::', ' / ')} is not in the comparison.`);
      continue;
    }
    if (!s.version && row.status === 'unchanged') {
      skipped.push({ key, reason: `${T} already runs ${row.current?.tag}.` });
      continue;
    }
    if (row.status === 'target-only' && !s.version) {
      skipped.push({ key, reason: `Only ${T} has it: nothing to promote.` });
      continue;
    }
    items.set(key, item(row, s.version ?? null, 'selected', index, records, comparison));
  }

  if (input.mode === 'full-sync') {
    for (const row of rows.values()) {
      if (items.has(row.key)) continue;
      if (row.status === 'update' || row.status === 'missing') items.set(row.key, item(row, null, 'sync', index, records, comparison));
      else if (row.status === 'conflict') skipped.push({ key: row.key, reason: `Conflicting data: ${row.reasons.join(' ')} Pick it by hand once resolved.` });
      else if (row.status === 'unknown') skipped.push({ key: row.key, reason: 'No version evidence on either side.' });
    }
  }

  for (const key of input.changeKeys) {
    const info = index.changes.get(key);
    if (!info) {
      errors.push(`${key} is not known: add it on the Changes page or name it in a release record note.`);
      continue;
    }
    const services = [...new Set(info.evidence.map((e) => `${e.role}::${e.service}`))].filter((k) => rows.has(k));
    if (!services.length) {
      errors.push(`${key} is not linked to any service in this comparison.`);
      continue;
    }
    for (const k of services) {
      const row = rows.get(k)!;
      const existing = items.get(k);
      const tag = existing?.to.tag ?? row.desired?.tag ?? null;
      const inc = tag ? inclusionOf(index, key, { role: row.role, service: row.service, version: tag }) : { inclusion: 'unknown' as const, detail: 'No build.' };
      if (inc.inclusion === 'not-included') {
        errors.push(`${key}: ${row.service} ${tag} does not contain it (${inc.detail}) Pick a newer build.`);
        continue;
      }
      if (!PROVEN.has(inc.inclusion)) warnings.push(`${key} in ${row.service} ${tag}: ${inc.detail}`);
      const current = row.current?.tag;
      if (current && tag && sameVersion(current, tag) && !existing) {
        const there = inclusionOf(index, key, { role: row.role, service: row.service, version: current });
        skipped.push({ key: k, reason: `${key}: ${T} already runs ${current} (${there.inclusion}).` });
        continue;
      }
      if (existing) existing.why.push(`change ${key}`);
      else items.set(k, item(row, null, `change ${key}`, index, records, comparison));
    }
  }

  if (!items.size && !errors.length) warnings.push(`Nothing to promote from ${S} to ${T} for this scope.`);
  const ordered = [...items.values()];
  const roleOrder = comparison.roles.map((r) => r.role);
  ordered.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.service.localeCompare(b.service));
  const touched = [...new Set(ordered.map((i) => i.role))];
  const configRoles = !input.includeConfig
    ? []
    : input.mode === 'full-sync'
      ? comparison.roles.filter((r) => touched.includes(r.role) || r.config.some((f) => f.keys.length || f.presence !== 'both')).map((r) => r.role)
      : touched;
  return { mode: input.mode, items: ordered, skipped, configRoles, warnings, errors };
}
