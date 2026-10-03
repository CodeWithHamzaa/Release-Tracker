// Gathers what the risk engine needs for one role and one promotion from what
// the tracker already stores: the latest snapshots and health reports (Health
// page), the compose files in the config vault, the server registry and the
// release records. No new data is collected anywhere.

import { compareSnapshots, parseIgnoreKeys } from './toolkitCompare.js';
import type { ParsedSnapshot } from './toolkitParse.js';
import { serverHealth, HealthReportMeta } from './healthModel.js';
import type { ComposeServiceSummary } from './configDrift.js';
import type { RoleRiskInput } from './riskEngine.js';
import type { ReleaseRecord } from './types.js';

// role -> environment -> parsed compose services (src/useConfigs.ts ComposeIndex fits this).
export type ComposeLookup = Record<string, Record<string, { summaries: ComposeServiceSummary[] }>>;

const sameEnv = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function buildRoleRiskInput(args: {
  role: string;
  sourceEnv: string;
  targetEnv: string;
  reports: HealthReportMeta[];
  servers: { environment: string; role: string; toolkitVersion: string | null }[];
  compose: ComposeLookup;
  records: Pick<ReleaseRecord, 'environment' | 'server' | 'service' | 'version' | 'status'>[];
  ignoreKeys?: string;
  now?: Date;
}): RoleRiskInput {
  const { role, sourceEnv, targetEnv } = args;
  const at = (env: string) => args.reports.filter((r) => r.role === role && sameEnv(r.environment, env));
  const latest = (env: string, kind: 'snapshot') => {
    const list = at(env).filter((r) => r.kind === kind);
    return list.length ? list.reduce((a, b) => (b.reportedAt > a.reportedAt ? b : a)) : null;
  };
  const src = latest(sourceEnv, 'snapshot');
  const tgt = latest(targetEnv, 'snapshot');

  let compare = null;
  if (role !== 'Database' && src && tgt) {
    try {
      compare = compareSnapshots(src.parsed as ParsedSnapshot, tgt.parsed as ParsedSnapshot, parseIgnoreKeys(args.ignoreKeys ?? ''));
    } catch {
      compare = null; // mismatched roles: the checklist panel already shows why
    }
  }

  const targetReports = at(targetEnv);
  const health = targetReports.length ? serverHealth(targetReports) : null;
  const registry = args.servers.find((s) => s.role === role && sameEnv(s.environment, targetEnv));
  const composeAt = (env: string) => {
    const hit = Object.entries(args.compose[role] ?? {}).find(([e]) => sameEnv(e, env));
    return hit ? hit[1].summaries : null;
  };

  return {
    role,
    sourceEnv: sourceEnv.toUpperCase(),
    targetEnv: targetEnv.toUpperCase(),
    compare,
    sourceSnapshotAt: src?.reportedAt ?? null,
    targetSnapshotAt: tgt?.reportedAt ?? null,
    sourceCompose: composeAt(sourceEnv),
    targetCompose: composeAt(targetEnv),
    targetHealth: health,
    toolkitVersion: health?.toolkitVersion ?? registry?.toolkitVersion ?? null,
    pendingRecords: args.records
      .filter((r) => r.server === role && sameEnv(r.environment, targetEnv) && String(r.status).toUpperCase() === 'PENDING')
      .map((r) => ({ service: r.service, version: r.version })),
    now: args.now,
  };
}

// Whether the scripts may be shown/downloaded: no blocker, and every high
// finding has been reviewed (ticked) by the person generating them.
export function canProceed(findings: { id: string; severity: string }[], reviewed: ReadonlySet<string>): { ok: boolean; reason: string | null } {
  const blockers = findings.filter((f) => f.severity === 'blocker').length;
  if (blockers) return { ok: false, reason: `${blockers} blocker(s) must be resolved first.` };
  const open = findings.filter((f) => f.severity === 'high' && !reviewed.has(f.id)).length;
  if (open) return { ok: false, reason: `Tick "reviewed" on ${open} high-risk finding(s) to continue.` };
  return { ok: true, reason: null };
}
