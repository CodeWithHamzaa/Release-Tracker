// The two outputs of a patch plan (lib/patchPlan.ts), as Markdown:
//   Deployment Steps  a short numbered checklist, one entry per step.
//   Runbook           the full reusable document (10 sections).
// Both walk the same plan.steps in the same order with the same numbering,
// so a step, command or expected result can never differ between them.

import type { PatchPlan, PlanStep } from './patchPlan.js';

const INCLUSION_LABEL: Record<string, string> = {
  verified: 'verified',
  recorded: 'recorded in a release note',
  declared: 'mapped by hand, unverified',
  inferred: 'inferred from build order, unverified',
  'not-included': 'NOT included',
  unknown: 'unknown',
};

const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fence = (commands: string[]) => (commands.length ? ['```bash', ...commands, '```'] : []);
const execSteps = (plan: PatchPlan) => plan.steps.filter((s) => s.phase !== 'rollback');
const rollbackSteps = (plan: PatchPlan) => plan.steps.filter((s) => s.phase === 'rollback');

// Step numbers shared by both outputs: execution steps 1..n, rollback R1..Rn.
export function stepNumbers(plan: PatchPlan): Map<string, string> {
  const n = new Map<string, string>();
  execSteps(plan).forEach((s, i) => n.set(s.id, String(i + 1)));
  rollbackSteps(plan).forEach((s, i) => n.set(s.id, `R${i + 1}`));
  return n;
}

function stepBlock(s: PlanStep, num: string, heading: string): string[] {
  const out = [`${heading} [ ] ${num}. ${s.title}`, '', `- **Server:** ${s.server}`];
  if (s.file) out.push(`- **File:** \`${s.file}\``);
  if (s.setting) out.push(`- **Setting:** \`${s.setting}\``);
  if (s.manual) out.push('- **Manual:** a person decides or edits; no single command does it.');
  if (s.commands.length) out.push('', ...fence(s.commands));
  out.push('', `- **Expected:** ${s.expected}`, `- **If it fails:** ${s.onFailure}`);
  if (s.unknowns.length) out.push(`- **Unknown (fill in before running):** ${s.unknowns.join('; ')}`);
  out.push('');
  return out;
}

function header(plan: PatchPlan, kind: string): string[] {
  const out = [`# ${kind}: ${plan.title}`, '', `Generated ${plan.generatedAt} by Release Tracker. Instructions only: nothing has been run, and ticking a box is not proof of a deployment.`, ''];
  if (plan.errors.length) out.push('> **Do not use this plan yet:**', ...plan.errors.map((e) => `> - ${e}`), '');
  return out;
}

// Mode A: concise checklist.
export function renderSteps(plan: PatchPlan): string {
  const nums = stepNumbers(plan);
  const out = header(plan, 'Deployment steps');
  out.push(`Target: **${plan.targetEnv}**. The image tars are already on the target servers; this list starts there.`, '');
  if (plan.unknowns.length) out.push(`> ${plan.unknowns.length} unknown(s) must be filled in first — see the runbook, section 10.`, '');
  for (const s of execSteps(plan)) out.push(...stepBlock(s, nums.get(s.id)!, '###'));
  if (rollbackSteps(plan).length) {
    out.push('## If verification fails: rollback', '');
    for (const s of rollbackSteps(plan)) out.push(...stepBlock(s, nums.get(s.id)!, '###'));
  }
  return out.join('\n');
}

// Mode B: full runbook.
export function renderRunbook(plan: PatchPlan): string {
  const nums = stepNumbers(plan);
  const out = header(plan, 'Deployment runbook');
  const services = plan.servers.flatMap((sv) => sv.services.map((s) => ({ role: sv.role, ...s })));

  out.push('## 1. Patch', '', '| | |', '|---|---|',
    `| Patch ID | \`${plan.patchId}\` |`, `| Source | ${plan.sourceEnv} |`, `| Target | ${plan.targetEnv} |`,
    `| Scope | ${plan.mode === 'full-sync' ? 'Full environment sync' : 'Selected builds'} |`,
    `| Servers | ${plan.servers.map((s) => s.label).join(', ') || 'none'} |`, '');

  out.push('## 2. Services and target images', '');
  if (services.length) {
    out.push('| Role | Service | Current on target | Deploy | Image ID | Tar file |', '|---|---|---|---|---|---|');
    for (const s of services) {
      out.push(`| ${md(s.role)} | ${md(s.service)}${s.newService ? ' (new)' : ''} | ${md(s.from?.image ?? '—')} | ${md(s.to.image ?? 'unknown')} | ${s.to.imageId ? `\`${s.to.imageId}\`` : 'not recorded'} | \`${md(s.tarFile)}\` |`);
    }
    const skippedBuilds = services.filter((s) => s.skippedBuilds.length);
    if (skippedBuilds.length) out.push('', ...skippedBuilds.map((s) => `- ${s.service}: intermediate builds ${s.skippedBuilds.join(', ')} are not loaded; only the final image is needed.`));
  } else out.push('No image changes (configuration only).');
  out.push('');

  out.push('## 3. Features and fixes', '');
  if (plan.changes.length) {
    out.push('| Change | Title | Service build | Evidence |', '|---|---|---|---|');
    for (const c of plan.changes) for (const s of c.services) out.push(`| ${c.key} | ${md(c.title ?? '—')} | ${md(s.service)} ${md(s.tag ?? '')} | ${INCLUSION_LABEL[s.inclusion] ?? s.inclusion}: ${md(s.detail)} |`);
  } else out.push('No feature/fix mapping for these builds. Add it on the Changes page or name the key (e.g. JIRA-123) in the release record note.');
  out.push('');

  out.push('## 4. Current versus target', '');
  for (const s of services) out.push(`- **${s.service}**: ${s.from?.tag ?? 'not deployed'} → ${s.to.tag ?? 'unknown'}${s.warnings.length ? ` — ${s.warnings.join(' ')}` : ''}`);
  for (const k of plan.skipped) out.push(`- Not in this patch: ${k.key.replace('::', ' / ')} — ${k.reason}`);
  if (!services.length && !plan.skipped.length) out.push('- No service differences in scope.');
  out.push('');

  out.push('## 5. Configuration changes (secrets redacted)', '');
  const cfg = plan.servers.flatMap((sv) => [...sv.config.map((c) => ({ ...c, step: true, role: sv.role })), ...sv.reviewOnly.map((c) => ({ ...c, step: false, role: sv.role }))]);
  if (cfg.length) {
    out.push('| Role | File | Key | Change | Proposed target value | Action |', '|---|---|---|---|---|---|');
    for (const c of cfg) {
      out.push(`| ${md(c.role)} | \`${md(c.path)}\` | ${md(c.key)} | ${c.change} | ${c.secret ? 'secret — set by hand' : c.value !== null ? `\`${md(c.value)}\`` : 'decide by hand'} | ${c.step ? 'step below' : c.action === 'keep' ? 'kept as is' : 'review only'}: ${md(c.reason)} |`);
    }
    out.push('', 'Keys only on the target are kept; nothing is deleted and no file is overwritten.');
  } else out.push('No configuration changes in scope.');
  out.push('');

  out.push('## 6. Deployment steps (target servers, in order)', '', 'The image tars are already on the target servers. Run each server\'s steps in order; servers are ordered Database → ChatBot → Chat-Service → Bot-Builder.', '');
  for (const s of execSteps(plan)) out.push(...stepBlock(s, nums.get(s.id)!, '###'));

  out.push('## 7. Pre-checks and post-deployment verification', '', '| Step | Server | Check | Expected |', '|---|---|---|---|');
  for (const s of execSteps(plan).filter((x) => x.phase === 'precheck' || x.phase === 'verify')) out.push(`| ${nums.get(s.id)} | ${md(s.server)} | ${s.phase === 'precheck' ? 'Pre-check' : 'Verify'} | ${md(s.expected)} |`);
  out.push('');

  out.push('## 8. Rollback', '', 'Only if verification fails. Each server rolls back on its own.', '');
  for (const s of rollbackSteps(plan)) out.push(...stepBlock(s, nums.get(s.id)!, '###'));
  if (!rollbackSteps(plan).length) out.push('Nothing to roll back.', '');

  out.push('## 9. Execution checklist and evidence', '', 'Fill in while you work. Paste real output; leave a row empty if the step was not done.', '',
    '| Done | Step | Time | Result / evidence (image ID, status line, log excerpt) |', '|---|---|---|---|');
  for (const s of plan.steps) out.push(`| [ ] | ${nums.get(s.id)}. ${md(s.title)} | | |`);
  out.push('');

  out.push('## 10. Unknowns, assumptions and risks', '');
  out.push('**Unknowns (supply these before running):**', '', ...(plan.unknowns.length ? plan.unknowns.map((u) => `- ${u}`) : ['- None.']), '');
  out.push('**Assumptions:**', '', ...plan.assumptions.map((a) => `- ${a}`), '');
  out.push('**Risks:**', '', ...(plan.risks.length ? plan.risks.map((r) => `- ${r}`) : ['- None found.']), '');
  return out.join('\n');
}
