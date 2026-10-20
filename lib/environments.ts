// The environments and server roles the tracker knows, in one place. Pages,
// API routes and the patch planner read these instead of keeping their own
// copies, so a new environment is added here once.

export const ENVIRONMENTS = ['SIT', 'UAT', 'Prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

// Server roles (ReleaseRecord.server, ServerNode.role, vault role).
export const ROLES = ['Bot-Builder', 'ChatBot / NLU', 'Database', 'Chat-Service'] as const;

// Order a promotion touches the servers in: data first, then the services
// that read it, then the UI.
export const EXECUTION_ORDER = ['Database', 'ChatBot / NLU', 'Chat-Service', 'Bot-Builder'] as const;

// Canonical environment name, or null. 'PROD' / 'prod' become 'Prod'.
export function canonicalEnvironment(value: unknown): Environment | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return ENVIRONMENTS.find((e) => e.toLowerCase() === v) ?? null;
}

export const sameEnvironment = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

// Upper-case label used in scripts and file names (SIT / UAT / PROD).
export const envLabel = (e: string) => e.trim().toUpperCase();

// The usual promotion paths. Any other pair of different environments is
// allowed (a backfill, a hotfix straight to Prod) but carries a warning.
export const PROMOTION_PATHS: ReadonlyArray<readonly [Environment, Environment]> = [
  ['SIT', 'UAT'],
  ['UAT', 'Prod'],
];

export type PairCheck = { ok: true; source: Environment; target: Environment; warning: string | null } | { ok: false; message: string };

export function checkPromotionPair(source: unknown, target: unknown): PairCheck {
  const s = canonicalEnvironment(source);
  const t = canonicalEnvironment(target);
  if (!s || !t) return { ok: false, message: `source and target must each be one of ${ENVIRONMENTS.join(', ')}.` };
  if (s === t) return { ok: false, message: 'source and target must be different environments.' };
  const usual = PROMOTION_PATHS.some(([a, b]) => a === s && b === t);
  const backwards = ENVIRONMENTS.indexOf(t) < ENVIRONMENTS.indexOf(s);
  const warning = usual
    ? null
    : backwards
      ? `${envLabel(s)} → ${envLabel(t)} goes backwards: check you are not overwriting newer ${envLabel(t)} builds.`
      : `${envLabel(s)} → ${envLabel(t)} skips ${ENVIRONMENTS.filter((e) => ENVIRONMENTS.indexOf(e) > ENVIRONMENTS.indexOf(s) && ENVIRONMENTS.indexOf(e) < ENVIRONMENTS.indexOf(t)).map(envLabel).join(', ')}: these builds were not tested there.`;
  return { ok: true, source: s, target: t, warning };
}
