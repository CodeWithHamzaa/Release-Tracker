// One execution plan for promoting an environment to the next across all four
// servers, so a single limited bank session (UAT and PROD) covers everything
// in the right order: Database -> ChatBot -> Chat-Service -> Bot-Builder.
// Pure text from data the tracker already computed (per-role promotion plan
// and risk); it never reaches a server.

import type { RiskReport } from './riskEngine.js';

export const EXECUTION_ORDER = ['Database', 'ChatBot / NLU', 'Chat-Service', 'Bot-Builder'] as const;

export interface RolloutRoleInput {
  role: string;
  patchId: string;
  images: number; // image changes patch can apply
  manualImages: number; // new services or repository changes (by hand)
  envAdds: number; // plain env keys the script appends
  manualItems: number; // everything else left for a person
  risk: RiskReport;
  composePath: string | null; // target server
  runAs: string | null; // target server
}

export interface RolloutPlanInput {
  sourceEnv: string; // SIT | UAT | Prod
  targetEnv: string;
  roles: RolloutRoleInput[];
  overall: RiskReport;
}

export interface PlanStep {
  title: string;
  commands: string[];
  notes: string[];
}

export interface PlanSession {
  title: string;
  intro: string[];
  steps: PlanStep[];
}

export interface RolloutPlan {
  title: string;
  warnings: string[];
  sessions: PlanSession[];
  skipped: string[]; // roles with nothing to do
}

const label = (e: string) => (e.toUpperCase() === 'PROD' ? 'PROD' : e.toUpperCase());
const ROLE_SHORT: Record<string, string> = { 'Bot-Builder': 'BB', 'ChatBot / NLU': 'CHATBOT', Database: 'DB', 'Chat-Service': 'CHATSVC' };

// The PATCH_ID the promotion window starts with (a folder name under
// alara/patches/); the same one is used for every role of a rollout, per role.
export function defaultPatchId(role: string, sourceEnv: string, targetEnv: string, date: Date = new Date()): string {
  return `PROMO-${ROLE_SHORT[role] ?? 'ROLE'}-${label(sourceEnv)}-${label(targetEnv)}-${date.toISOString().slice(0, 10).replace(/-/g, '')}`;
}

export const scriptFiles = (patchId: string, src: string, tgt: string) => ({
  part1: `${patchId}_${src}-${tgt}_part1_source_export.sh`,
  part2: `${patchId}_${src}-${tgt}_part2_target_import.sh`,
});

export function buildRolloutPlan(input: RolloutPlanInput): RolloutPlan {
  const src = label(input.sourceEnv);
  const tgt = label(input.targetEnv);
  const bankSession = tgt !== 'SIT';
  const ordered = EXECUTION_ORDER.map((r) => input.roles.find((x) => x.role === r)).filter((x): x is RolloutRoleInput => !!x);
  const active = ordered.filter((r) => r.images + r.envAdds + r.manualImages + r.manualItems > 0);
  const skipped = ordered.filter((r) => !active.includes(r)).map((r) => r.role);
  const exporting = active.filter((r) => r.images > 0);
  const warnings: string[] = [];

  const blocked = active.filter((r) => r.risk.band === 'blocked');
  if (blocked.length) warnings.push(`Blocked: ${blocked.map((r) => r.role).join(', ')}. Resolve the blockers in the risk panel before the session; the scripts must not be used for these roles.`);
  const high = active.filter((r) => r.risk.band === 'high');
  if (high.length) warnings.push(`High risk: ${high.map((r) => r.role).join(', ')}. Review each finding first.`);
  if (bankSession) warnings.push(`${tgt} is reached through a bank session without root. Run each script as the account that owns the compose folder, and plan the whole list below to fit one session.`);
  if (active.length === 0) warnings.push('Nothing to promote: no image or env changes between these snapshots.');

  const sessions: PlanSession[] = [];

  if (exporting.length) {
    sessions.push({
      title: `Session 1: export on ${src} (all four servers, any order)`,
      intro: ['Run the dry run first on each server, then the live run. Part 1 only reads images and writes a folder; it changes nothing running.'],
      steps: exporting.map((r) => {
        const f = scriptFiles(r.patchId, src, tgt);
        return {
          title: `${r.role}: export ${r.images} image(s)`,
          commands: [`bash ${f.part1} --env ${src} --dry-run`, `bash ${f.part1} --env ${src}`],
          notes: [`Writes alara/patches/export/${r.patchId}/ with the tars and SHA256SUMS.`],
        };
      }),
    });
    sessions.push({
      title: 'Transfer (WinSCP)',
      intro: ['Copy each export folder to the same role on the target. Nothing is applied by copying.'],
      steps: exporting.map((r) => ({
        title: r.role,
        commands: [`${src} <compose folder>/alara/patches/export/${r.patchId}/  ->  ${tgt} <compose folder>/alara/patches/incoming/${r.patchId}/`],
        notes: [],
      })),
    });
  }

  const steps: PlanStep[] = [];
  active.forEach((r, idx) => {
    const f = scriptFiles(r.patchId, src, tgt);
    const parts = [r.images ? `${r.images} image(s)` : '', r.envAdds ? `${r.envAdds} env key(s)` : ''].filter(Boolean).join(' and ');
    steps.push({
      title: `${idx + 1}. ${r.role}${parts ? `: ${parts}` : ''}`,
      commands: [`cd ${r.composePath ? `'${r.composePath}'` : '<compose folder>'}`, `bash ${f.part2} --env ${tgt} --dry-run`, `bash ${f.part2} --env ${tgt}`],
      notes: [
        r.runAs ? `Run as ${r.runAs}.` : 'Run as the account that owns the compose folder.',
        tgt === 'PROD' ? 'alara_server.sh asks you to type PROD. No --yes.' : 'Type yes or apply when asked.',
        'Stop here if the exit code is not 0: 1 means the health gate failed and it rolled back, 2 means refused, 3 means act by hand. Do not start the next server.',
        ...(r.manualImages + r.manualItems > 0 ? [`${r.manualImages + r.manualItems} item(s) the script leaves for you (new services, repository changes, secrets, changed values). The script lists them at the end.`] : []),
        ...(r.risk.band !== 'low' ? [`Risk: ${r.risk.band} (${r.risk.counts.high} high, ${r.risk.counts.medium} medium).`] : []),
      ],
    });
    steps.push({
      title: `${r.role}: check`,
      commands: ['./alara_server.sh status'],
      notes: ['Every service running or healthy, nothing under "Exited Containers". The script also wrote a receipt in alara/receipts/: keep it for step "After the session".'],
    });
    if (r.role === 'Database') {
      steps.push({
        title: 'Database checkpoint before any app server',
        commands: [],
        notes: ['Confirm the Database is healthy and the apps can reach it. On the DR server: SHOW REPLICA STATUS\\G (IO and SQL = Yes) and rs.status() (DR = SECONDARY). Unverified until a real restart: it should catch up by itself within about 10 minutes. Do not continue if it does not.'],
      });
    }
  });
  if (steps.length) {
    sessions.push({
      title: `${bankSession ? 'Session 2' : 'Session'}: apply on ${tgt} (${active.map((r) => r.role).join(' → ')})`,
      intro: [bankSession ? 'One bank session. Order matters: a server later in the list can depend on the earlier ones.' : 'Order matters: a server later in the list can depend on the earlier ones.'],
      steps,
    });
  }

  if (active.length) {
    sessions.push({
      title: 'After the session',
      intro: [],
      steps: [
        {
          title: 'Bring the evidence back and close the records',
          commands: [`WinSCP: copy alara/receipts/*.json from each ${tgt} server`],
          notes: [
            'Release Tracker: Health > Add reports > drop the receipt files. Review the matched records and confirm.',
            `Also upload a fresh status (and snapshot) for each ${tgt} server, then check the Drift Matrix shows the new versions as running.`,
            'Handle the manual items (secrets, new services, changed values). Then run ./alara_server.sh encrypt wherever you added secrets.',
          ],
        },
      ],
    });
  }

  return { title: `Promotion plan ${src} → ${tgt}`, warnings, sessions, skipped };
}

export function rolloutPlanMarkdown(plan: RolloutPlan): string {
  const lines = [`# ${plan.title}`, ''];
  for (const w of plan.warnings) lines.push(`> ⚠ ${w}`);
  if (plan.warnings.length) lines.push('');
  for (const s of plan.sessions) {
    lines.push(`## ${s.title}`, '', ...s.intro.map((i) => `${i}`), s.intro.length ? '' : '');
    s.steps.forEach((step) => {
      lines.push(`### ${step.title}`, '');
      if (step.commands.length) lines.push('```bash', ...step.commands, '```', '');
      for (const n of step.notes) lines.push(`- ${n}`);
      if (step.notes.length) lines.push('');
    });
  }
  if (plan.skipped.length) lines.push(`Skipped (nothing to change): ${plan.skipped.join(', ')}`, '');
  return lines.join('\n');
}
