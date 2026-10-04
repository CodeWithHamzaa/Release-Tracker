// Pre-flight risk analysis for promoting one environment to the next, run
// BEFORE the promotion scripts are generated so a wasted bank session (UAT and
// PROD are limited sessions) is caught at the desk, not on the server.
//
// Deterministic rules over data the tracker already holds; nothing here is
// statistical and every finding says why. Inputs: the release checklist
// (lib/toolkitCompare.ts, read through lib/compareItems.ts), the compose files
// in the config vault, the target's latest health reports, and the PENDING
// release records. Database has no snapshot tool, so its risk comes from its
// records and from how it is bundled with the app changes.

import { classifyCompareItems } from './compareItems.js';
import type { CompareResult } from './toolkitCompare.js';
import { imageRepo, imageTag, versionOf, ComposeServiceSummary } from './configDrift.js';
import type { ServerHealth } from './healthModel.js';

export type RiskSeverity = 'blocker' | 'high' | 'medium';
export type RiskBand = 'low' | 'medium' | 'high' | 'blocked';

export interface RiskFinding {
  id: string; // stable, e.g. "ChatBot / NLU:floating-tag"
  severity: RiskSeverity;
  role: string;
  title: string;
  detail: string;
  source: 'compare' | 'compose' | 'health' | 'records' | 'rollout';
}

export interface RiskReport {
  findings: RiskFinding[];
  score: number; // 0 (nothing found) to 100
  band: RiskBand;
  counts: Record<RiskSeverity, number>;
}

export interface RoleRiskInput {
  role: string;
  sourceEnv: string;
  targetEnv: string;
  compare: CompareResult | null; // null: no snapshot pair (always null for Database)
  sourceSnapshotAt: string | null;
  targetSnapshotAt: string | null;
  sourceCompose: ComposeServiceSummary[] | null; // from the config vault
  targetCompose: ComposeServiceSummary[] | null;
  targetHealth: ServerHealth | null;
  toolkitVersion: string | null; // alara_server.sh on the target
  pendingRecords: { service: string; version: string }[]; // PENDING records for the target env on this role
  // Config/env changes logged in the audit log after the vault file was
  // uploaded, on the source or target environment (lib/currentVersions.ts).
  vaultStale?: { env: string; file: 'compose' | 'env'; at: string }[];
  now?: Date;
}

export const MIN_PATCH_TOOLKIT = '2.5'; // alara_server.sh version that has `patch`
const DAY = 86_400_000;

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function bandFor(findings: RiskFinding[]): { score: number; band: RiskBand; counts: Record<RiskSeverity, number> } {
  const counts = { blocker: 0, high: 0, medium: 0 };
  for (const f of findings) counts[f.severity] += 1;
  if (counts.blocker > 0) return { score: 100, band: 'blocked', counts };
  const score = Math.min(99, counts.high * 25 + counts.medium * 8);
  return { score, band: score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low', counts };
}

export const report = (findings: RiskFinding[]): RiskReport => ({ findings, ...bandFor(findings) });

const names = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));

// "80→80, 443→443/udp" -> host -> container
function portMap(ports: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of ports.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)→(\d+)(\/\w+)?$/.exec(p);
    if (m) out.set(`${m[1]}${m[3] ?? ''}`, `${m[2]}${m[3] ?? ''}`);
  }
  return out;
}

// Container-side path of each volume ("./data:/var/lib/x:ro" -> "/var/lib/x").
// Host paths and named volumes legitimately differ per environment; what the
// image expects inside the container is what must exist on both.
function volumeTargets(volumes: string): Set<string> {
  const out = new Set<string>();
  for (const v of volumes.split(',').map((x) => x.trim()).filter(Boolean)) {
    const parts = v.split(':');
    out.add(parts.length === 1 ? parts[0] : parts[1]);
  }
  return out;
}

export function evaluateRoleRisk(input: RoleRiskInput): RiskReport {
  const { role } = input;
  const now = input.now ?? new Date();
  const findings: RiskFinding[] = [];
  const add = (key: string, severity: RiskSeverity, title: string, detail: string, source: RiskFinding['source']) =>
    findings.push({ id: `${role}:${key}`, severity, role, title, detail, source });
  const isDb = role === 'Database';

  // ── Toolkit on the target ──
  if (!input.toolkitVersion) {
    add('toolkit-unknown', 'medium', 'Toolkit version on the target is unknown', 'Upload a doctor report or fill the version in the server registry: `patch` needs alara_server.sh v2.5 or newer (unverified).', 'health');
  } else if (compareVersions(input.toolkitVersion, MIN_PATCH_TOOLKIT) < 0) {
    add('toolkit-old', 'blocker', `Target toolkit v${input.toolkitVersion} has no patch command`, `The generated scripts call ./alara_server.sh patch (v${MIN_PATCH_TOOLKIT}+). Roll the toolkit out to ${input.targetEnv} first.`, 'health');
  }

  // ── Snapshots ──
  if (!isDb) {
    if (!input.compare) {
      const missing = [!input.sourceSnapshotAt && input.sourceEnv, !input.targetSnapshotAt && input.targetEnv].filter(Boolean).join(' and ');
      add('no-snapshots', 'blocker', 'Nothing to compare: snapshot missing', `No snapshot for ${missing || 'this pair'}. Run ./alara_server.sh snapshot on the server and upload it on the Health page.`, 'compare');
    }
    for (const [env, at] of [[input.sourceEnv, input.sourceSnapshotAt], [input.targetEnv, input.targetSnapshotAt]] as const) {
      if (!at) continue;
      const days = (now.getTime() - new Date(at).getTime()) / DAY;
      if (days > 30) add(`snapshot-old-${env}`, 'high', `${env} snapshot is ${Math.round(days)} days old`, 'The comparison may no longer describe what runs there. Take a fresh snapshot.', 'compare');
      else if (days > 7) add(`snapshot-stale-${env}`, 'medium', `${env} snapshot is ${Math.round(days)} days old`, 'Consider a fresh snapshot before the session.', 'compare');
    }
  }

  // ── Release checklist ──
  const items = input.compare ? classifyCompareItems(input.compare) : [];
  const updates = items.filter((i) => i.kind === 'image-update');
  const deploys = items.filter((i) => i.kind === 'image-deploy');

  const floating = [...updates, ...deploys].filter((i) => {
    const tag = imageTag(i.image);
    return !tag || tag === 'latest';
  });
  if (floating.length) {
    add('floating-tag', 'high', 'Floating image tag (:latest or no tag)', `${names(floating.map((i) => `${i.container} (${i.image})`))}. The same tag can mean different content later, so a rollback by tag is not reliable. Ask the developer for a versioned tag.`, 'compare');
  }
  const repoChanged = updates.filter((i) => i.kind === 'image-update' && imageRepo(i.previous) !== imageRepo(i.image));
  if (repoChanged.length) {
    add('repo-changed', 'high', 'Image repository changed', `${names(repoChanged.map((i) => i.container))}. alara patch matches images by repository, so these need the image: line edited by hand.`, 'compare');
  }
  // Tag text without a digest: "repo:3.0@sha256:x" and "repo:3.0@sha256:y" are the same tag.
  const plainTag = (ref: string) => imageTag(ref.split('@')[0]);
  const sameTag = updates.filter((i) => i.kind === 'image-update' && imageRepo(i.previous) === imageRepo(i.image) && plainTag(i.previous) === plainTag(i.image));
  if (sameTag.length) {
    add('same-tag', 'medium', 'Same tag, different build', `${names(sameTag.map((i) => i.container))}. The tag did not change but the image reference did (digest). patch protects the old image for rollback.`, 'compare');
  }
  if (deploys.length) {
    add('new-service', 'high', 'New service to add by hand', `${names(deploys.map((i) => i.container))}. alara patch only updates existing image: lines, so add the service to docker-compose.yml first.`, 'compare');
  }
  const targetOnly = items.filter((i) => i.kind === 'image-target-only');
  if (targetOnly.length) {
    add('target-only-service', 'medium', 'Services running on the target only', `${names(targetOnly.map((i) => i.container))}. Confirm these are intentional and not leftovers.`, 'compare');
  }

  const adds = items.filter((i) => i.kind === 'env-add');
  const secrets = adds.filter((i) => i.kind === 'env-add' && i.value.startsWith('SHA256:'));
  if (secrets.length) {
    add('secret-missing', 'high', 'Secret missing on the target', `${names(secrets.map((i) => (i.kind === 'env-add' ? `${i.file}:${i.key}` : '')))}. The snapshot holds only a hash, so the value must be added by hand on ${input.targetEnv}, then ./alara_server.sh encrypt. The new image may not start without it.`, 'compare');
  }
  const multiline = adds.filter((i) => i.kind === 'env-add' && i.value.includes('\n'));
  const dup = items.filter((i) => i.kind === 'env-duplicate');
  if (multiline.length || dup.length) {
    add('env-duplicate', 'medium', 'Env keys defined more than once', `${names([...multiline, ...dup].map((i) => (i.kind === 'env-add' || i.kind === 'env-duplicate' ? `${i.file}:${i.key}` : '')))}. The last line wins at runtime: clean up before releasing.`, 'compare');
  }
  const secretDiff = items.filter((i) => i.kind === 'env-secret-differs');
  if (secretDiff.length) {
    add('secret-differs', 'medium', 'Sensitive values differ between environments', `${names(secretDiff.map((i) => (i.kind === 'env-secret-differs' ? `${i.file}:${i.key}` : '')))}. Confirm each environment's own secret is intentional.`, 'compare');
  }
  const envOnlyTarget = items.filter((i) => i.kind === 'env-target-only');
  const envDiffers = items.filter((i) => i.kind === 'env-differs');
  if (envOnlyTarget.length || envDiffers.length) {
    add('env-review', 'medium', 'Env values to review', `${envDiffers.length} value(s) differ and ${envOnlyTarget.length} key(s) exist only on ${input.targetEnv}: ${names([...envDiffers, ...envOnlyTarget].map((i) => (i.kind === 'env-differs' || i.kind === 'env-target-only' ? `${i.file}:${i.key}` : '')))}.`, 'compare');
  }

  // ── Ports and volumes for the services that change ──
  if (updates.length + deploys.length > 0) {
    if (!input.sourceCompose || !input.targetCompose) {
      const missing = [!input.sourceCompose && input.sourceEnv, !input.targetCompose && input.targetEnv].filter(Boolean).join(' and ');
      add('compose-missing', 'medium', 'Port and volume checks skipped', `No docker-compose.yml for ${missing} in the Configs vault, so ports and volumes were not compared (unverified). Upload it on the Configs page.`, 'compose');
    } else {
      const newPorts: string[] = [];
      const changedPorts: string[] = [];
      const newVolumes: string[] = [];
      for (const item of [...updates, ...deploys]) {
        const src = versionOf(input.sourceCompose, item.container);
        const tgt = versionOf(input.targetCompose, item.container);
        if (!src || !tgt) continue; // a new service has nothing to compare with
        const sp = portMap(src.ports);
        const tp = portMap(tgt.ports);
        for (const [host, container] of sp) {
          if (!tp.has(host)) newPorts.push(`${item.container}: ${host}`);
          else if (tp.get(host) !== container) changedPorts.push(`${item.container}: ${host}→${container} (target ${host}→${tp.get(host)})`);
        }
        const tv = volumeTargets(tgt.volumes);
        for (const v of volumeTargets(src.volumes)) if (!tv.has(v)) newVolumes.push(`${item.container}: ${v}`);
      }
      if (newPorts.length) add('new-ports', 'high', 'New published host port', `${names(newPorts)}. ${input.sourceEnv} publishes it, ${input.targetEnv} does not: check the firewall and the target compose file.`, 'compose');
      if (newVolumes.length) add('new-volumes', 'high', 'New volume path', `${names(newVolumes)}. ${input.sourceEnv} mounts it, ${input.targetEnv} does not: the new image may expect it. Create the path and add it to the target compose file.`, 'compose');
      if (changedPorts.length) add('changed-ports', 'medium', 'Port mapping differs', `${names(changedPorts)}.`, 'compose');
    }
  }

  // ── Vault files older than the audit log ──
  // Image versions follow the records on their own; config and env changes
  // don't, so the vault copy the checks above read may be out of date.
  for (const env of [input.sourceEnv, input.targetEnv]) {
    const stale = (input.vaultStale ?? []).filter((v) => v.env.toUpperCase() === env.toUpperCase());
    if (!stale.length) continue;
    const what = stale.map((v) => `${v.file === 'compose' ? 'docker-compose.yml' : 'env files'} (change logged ${v.at.slice(0, 10)})`).join(', ');
    add(`vault-stale-${env.toUpperCase()}`, 'medium', `Vault may be stale for ${env}`, `${what} is newer in the audit log than in the Configs vault. Re-upload it before generating scripts.`, 'records');
  }

  // ── The target as it is now ──
  const h = input.targetHealth;
  if (h) {
    const bad = h.counts.unhealthy + h.counts.restarting;
    if (bad > 0) {
      add('target-unhealthy', 'high', `${bad} container(s) unhealthy or restarting on ${input.targetEnv}`, `patch's health gate needs every service that was running to be running and healthy afterwards, so it would fail on these. Fix them first.`, 'health');
    }
    if (h.counts.exited > 0) add('target-exited', 'medium', `${h.counts.exited} exited container(s) on ${input.targetEnv}`, 'Confirm they are meant to be stopped.', 'health');
    if (h.configMismatch) add('config-mismatch', 'high', h.configMismatch, `The ${input.targetEnv} env files point at another environment. Resolve this before promoting anything.`, 'health');
    if (h.doctorProblems.some((p) => /^MISS\s+alara_patch\.sh/.test(p))) {
      add('patch-script-missing', 'blocker', 'alara_patch.sh is missing on the target', `Doctor reports it missing on ${input.targetEnv}, so ./alara_server.sh patch cannot run. Install the toolkit update there first.`, 'health');
    }
    if (h.doctorPassed === false) add('doctor-failed', 'medium', 'Doctor reported problems on the target', h.doctorProblems.slice(0, 4).join('; ') || 'See the Health page.', 'health');
  } else if (!isDb) {
    add('target-no-health', 'medium', `No status or snapshot for ${input.targetEnv}`, 'The tracker cannot tell whether the target is healthy right now. Upload ./alara_server.sh status.', 'health');
  }

  // ── Database has no snapshot tool: its risk is in its records ──
  if (isDb && input.pendingRecords.length > 0) {
    add('db-records', 'medium', 'Database changes are tracked by records only', `${input.pendingRecords.map((r) => `${r.service} ${r.version}`).join(', ')}. There is no snapshot compare for Database, so check the images, env and DR replication by hand.`, 'records');
  }

  return report(findings);
}

export interface RolloutRisk {
  roles: Record<string, RiskReport>;
  overall: RiskReport;
}

// All four roles together, plus what only shows across roles.
export function evaluateRollout(inputs: RoleRiskInput[]): RolloutRisk {
  const roles: Record<string, RiskReport> = {};
  for (const i of inputs) roles[i.role] = evaluateRoleRisk(i);
  const cross: RiskFinding[] = [];

  const db = inputs.find((i) => i.role === 'Database');
  const appRoles = inputs.filter((i) => i.role !== 'Database' && i.compare && classifyCompareItems(i.compare).some((x) => x.kind === 'image-update' || x.kind === 'image-deploy'));
  if (db && db.pendingRecords.length > 0 && appRoles.length > 0) {
    cross.push({
      id: 'Database:bundled',
      severity: 'high',
      role: 'Database',
      title: 'Database change bundled with app changes',
      detail: `Database (${db.pendingRecords.map((r) => `${r.service} ${r.version}`).join(', ')}) and ${appRoles.map((a) => a.role).join(', ')} change in the same release. Apply the Database first and verify it, including DR replication, before touching the apps. A failure after the apps are changed is much harder to undo.`,
      source: 'rollout',
    });
    roles.Database = report([...roles.Database.findings, cross[0]]);
  }

  const all = [...Object.values(roles).flatMap((r) => r.findings)];
  return { roles, overall: report(all) };
}

export const SEVERITY_ORDER: Record<RiskSeverity, number> = { blocker: 0, high: 1, medium: 2 };
export const sortFindings = (f: RiskFinding[]) => [...f].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
