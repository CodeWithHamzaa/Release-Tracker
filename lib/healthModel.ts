// Turns the latest health reports (status / snapshot / doctor) of one server
// into what the Health page shows: container counts, encryption and key
// state, toolkit version, data age, and running-vs-recorded-vs-vault
// version checks.

import type { ParsedDoctor, ParsedSnapshot, ParsedStatus, ToolkitContainer, ToolkitKind } from './toolkitParse.js';
import { imageRepo, imageTag, versionOf, ComposeServiceSummary } from './configDrift.js';
import type { ParsedReceipt } from './receiptParse.js';
import type { ReleaseRecord } from './types.js';

// A deployment receipt's state.after is the newest word on what a server runs
// right after a patch, so it feeds the board and the Drift Matrix like a status.
export type HealthKind = ToolkitKind | 'receipt';

export interface HealthReportMeta {
  id: string;
  environment: string;
  role: string;
  kind: HealthKind;
  reportedAt: string;
  host: string | null;
  uploadedBy: string;
  createdAt: string;
  parsed: ParsedSnapshot | ParsedStatus | ParsedDoctor | ParsedReceipt;
}

export type AgeLevel = 'fresh' | 'stale' | 'old';

export function ageLevel(iso: string, now: Date = new Date()): AgeLevel {
  const days = (now.getTime() - new Date(iso).getTime()) / 86_400_000;
  return days > 30 ? 'old' : days > 7 ? 'stale' : 'fresh';
}

export function ageText(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface ServerHealth {
  containers: ToolkitContainer[];
  containersFrom: 'status' | 'snapshot' | 'receipt' | null;
  counts: { total: number; up: number; unhealthy: number; starting: number; restarting: number; exited: number };
  envFiles: ParsedStatus['envFiles'];
  masterKey: ParsedStatus['masterKey'];
  keyState: string | null;
  configMismatch: string | null; // "Config points: UAT" on a SIT server
  toolkitVersion: string | null;
  doctorPassed: boolean | null;
  doctorProblems: string[];
  newestAt: string | null;
  reports: Partial<Record<HealthKind, HealthReportMeta>>;
}

export function serverHealth(reports: HealthReportMeta[]): ServerHealth {
  const byKind: Partial<Record<HealthKind, HealthReportMeta>> = {};
  for (const r of reports) {
    const cur = byKind[r.kind];
    if (!cur || r.reportedAt > cur.reportedAt) byKind[r.kind] = r;
  }
  const status = byKind.status?.parsed as ParsedStatus | undefined;
  const snapshot = byKind.snapshot?.parsed as ParsedSnapshot | undefined;
  const doctor = byKind.doctor?.parsed as ParsedDoctor | undefined;
  const receipt = byKind.receipt?.parsed as ParsedReceipt | undefined;

  // Containers from whichever of status / snapshot / receipt is newest. A
  // receipt only counts when the toolkit recorded a run (it has state.after).
  const sources: { kind: 'status' | 'snapshot' | 'receipt'; at: string; containers: ToolkitContainer[] }[] = [];
  if (byKind.status && status) sources.push({ kind: 'status', at: byKind.status.reportedAt, containers: status.containers });
  if (byKind.snapshot && snapshot) sources.push({ kind: 'snapshot', at: byKind.snapshot.reportedAt, containers: snapshot.containers });
  if (byKind.receipt && receipt && receipt.containers.length > 0) sources.push({ kind: 'receipt', at: byKind.receipt.reportedAt, containers: receipt.containers });
  // Ties keep the order above: status, then snapshot, then receipt.
  const newest = sources.reduce<(typeof sources)[number] | null>((best, c) => (!best || c.at > best.at ? c : best), null);
  const containersFrom: ServerHealth['containersFrom'] = newest?.kind ?? null;
  const containers = newest?.containers ?? [];

  const counts = {
    total: containers.length,
    up: containers.filter((c) => c.state === 'running').length,
    unhealthy: containers.filter((c) => c.health === 'unhealthy').length,
    starting: containers.filter((c) => c.health === 'starting').length,
    restarting: containers.filter((c) => c.state === 'restarting').length,
    exited: containers.filter((c) => c.state === 'exited').length,
  };

  const env = reports[0]?.environment?.toUpperCase();
  const cp = status?.configPoints?.toUpperCase();
  const configMismatch = cp && env && cp !== env && cp !== 'UNDETERMINED' && cp !== 'UNKNOWN' ? `Config points to ${cp}` : null;

  const times = Object.values(byKind).map((r) => r!.reportedAt);
  return {
    containers,
    containersFrom,
    counts,
    envFiles: status?.envFiles ?? [],
    masterKey: status?.masterKey ?? null,
    keyState: status?.keyState ?? doctor?.keyState ?? null,
    configMismatch,
    toolkitVersion: doctor?.serverVersion ?? null,
    doctorPassed: doctor?.passed ?? null,
    doctorProblems: doctor ? doctor.checks.filter((c) => c.status !== 'ok').map((c) => `${c.status} ${c.item}`) : [],
    newestAt: times.length ? times.sort().at(-1)! : null,
    reports: byKind,
  };
}

// Versions are compared loosely: "v2.4.2" and "2.4.2" are the same.
export const sameVersion = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().replace(/^v/i, '').toLowerCase() === b.trim().replace(/^v/i, '').toLowerCase();

// A tracker service name matches a container by name, compose service label,
// or image repository (container names differ between environments).
export function containerFor(containers: ToolkitContainer[], service: string): ToolkitContainer | null {
  return (
    containers.find((c) => c.name === service) ||
    containers.find((c) => c.service === service) ||
    containers.find((c) => imageRepo(c.image) === service) ||
    null
  );
}

export interface VersionCheck {
  container: string;
  service: string; // tracker service name when matched, else the container name
  image: string;
  running: string | null;
  recorded: string | null; // latest SUCCESS release record
  vault: string | null; // latest stored compose file
  recordMismatch: boolean;
  vaultMismatch: boolean;
}

export function versionChecks(
  containers: ToolkitContainer[],
  records: ReleaseRecord[], // already filtered to this environment + role
  composeSummaries: ComposeServiceSummary[] | null
): VersionCheck[] {
  const latestSuccess = new Map<string, ReleaseRecord>();
  for (const r of records) {
    if (String(r.status).toUpperCase() !== 'SUCCESS') continue;
    const cur = latestSuccess.get(r.service);
    if (!cur || new Date(r.createdAt) > new Date(cur.createdAt)) latestSuccess.set(r.service, r);
  }
  const services = [...latestSuccess.keys()];
  return containers.map((c) => {
    const service =
      services.find((s) => s === c.name) || services.find((s) => s === c.service) || services.find((s) => s === imageRepo(c.image)) || c.name;
    const running = imageTag(c.image);
    const recorded = latestSuccess.get(service)?.version ?? null;
    const vaultEntry = composeSummaries
      ? versionOf(composeSummaries, c.service ?? c.name) || versionOf(composeSummaries, c.name) || versionOf(composeSummaries, imageRepo(c.image) ?? '')
      : null;
    const vault = vaultEntry?.tag ?? null;
    return {
      container: c.name,
      service,
      image: c.image,
      running,
      recorded,
      vault,
      recordMismatch: !!recorded && !sameVersion(running, recorded),
      vaultMismatch: !!vault && !sameVersion(running, vault),
    };
  });
}

// For the Drift Matrix: environment::role::service -> what the server runs,
// from the newest status/snapshot of that server.
export type RunningIndex = Record<string, { tag: string | null; at: string; container: string }>;

export function runningIndex(reports: HealthReportMeta[], records: ReleaseRecord[]): RunningIndex {
  const out: RunningIndex = {};
  const groups = new Map<string, HealthReportMeta[]>();
  for (const r of reports) {
    const key = `${r.environment}::${r.role}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, list] of groups) {
    const h = serverHealth(list);
    if (!h.containersFrom) continue;
    const at = h.reports[h.containersFrom]!.reportedAt;
    const [env, role] = key.split('::');
    const services = new Set(records.filter((r) => r.environment.toUpperCase() === env.toUpperCase() && r.server === role).map((r) => r.service));
    for (const service of services) {
      const c = containerFor(h.containers, service);
      if (c) out[`${env.toUpperCase()}::${role}::${service}`] = { tag: imageTag(c.image), at, container: c.name };
    }
  }
  return out;
}
