import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRolloutPlan, rolloutPlanMarkdown, EXECUTION_ORDER, RolloutRoleInput } from './rolloutPlan.js';
import { report, RiskFinding } from './riskEngine.js';

const f = (severity: RiskFinding['severity']): RiskFinding => ({ id: 'x', severity, role: 'r', title: '', detail: '', source: 'compare' });
const SHORT: Record<string, string> = { 'Bot-Builder': 'BB', 'ChatBot / NLU': 'CHATBOT', Database: 'DB', 'Chat-Service': 'CHATSVC' };
const role = (name: string, over: Partial<RolloutRoleInput> = {}): RolloutRoleInput => ({
  role: name, patchId: `PROMO-${SHORT[name]}-SIT-UAT`, images: 1, manualImages: 0, envAdds: 0, manualItems: 0, risk: report([]), composePath: `/srv/${name.slice(0, 3).toLowerCase()}`, runAs: 'chatbotuat', ...over,
});
const four = (over: Record<string, Partial<RolloutRoleInput>> = {}) =>
  ['Bot-Builder', 'ChatBot / NLU', 'Database', 'Chat-Service'].map((n) => role(n, over[n]));
const plan = (roles: RolloutRoleInput[], tgt = 'UAT') => buildRolloutPlan({ sourceEnv: 'SIT', targetEnv: tgt, roles, overall: report([]) });
const stepTitles = (p: ReturnType<typeof plan>, session: RegExp) => p.sessions.find((s) => session.test(s.title))!.steps.map((s) => s.title);

test('execution order is Database, ChatBot, Chat-Service, Bot-Builder whatever order the roles come in', () => {
  assert.deepEqual([...EXECUTION_ORDER], ['Database', 'ChatBot / NLU', 'Chat-Service', 'Bot-Builder']);
  const p = plan(four());
  const apply = p.sessions.find((s) => /apply on UAT/.test(s.title))!;
  assert.match(apply.title, /Database → ChatBot \/ NLU → Chat-Service → Bot-Builder/);
  assert.deepEqual(apply.steps.filter((s) => /^\d\./.test(s.title)).map((s) => s.title.replace(/^\d\. ([^:]+).*/, '$1')), [...EXECUTION_ORDER]);
});

test('one export session, one transfer list, one apply session, one wrap-up', () => {
  const p = plan(four());
  assert.deepEqual(p.sessions.map((s) => s.title.split(':')[0]), ['Session 1', 'Transfer (WinSCP)', 'Session 2', 'After the session']);
  const part1 = stepTitles(p, /export on SIT/);
  assert.equal(part1.length, 4);
  assert.match(JSON.stringify(p.sessions[0]), /--env SIT --dry-run/);
  assert.match(JSON.stringify(p.sessions[2]), /_part2_target_import\.sh --env UAT --dry-run/);
  assert.match(JSON.stringify(p.sessions[1]), /export\/PROMO-DB-SIT-UAT\/ {2}-> {2}UAT/);
});

test('a checkpoint follows the Database, before any app server', () => {
  const titles = stepTitles(plan(four()), /apply on UAT/);
  const db = titles.findIndex((t) => /^\d\. Database/.test(t));
  const checkpoint = titles.findIndex((t) => /Database checkpoint/.test(t));
  const chatbot = titles.findIndex((t) => /^\d\. ChatBot/.test(t));
  assert.ok(db < checkpoint && checkpoint < chatbot, titles.join(' | '));
});

test('roles with nothing to change are skipped and listed', () => {
  const p = plan(four({ Database: { images: 0 }, 'Chat-Service': { images: 0 } }));
  assert.deepEqual(p.skipped, ['Database', 'Chat-Service']);
  assert.equal(stepTitles(p, /export on SIT/).length, 2);
  assert.doesNotMatch(JSON.stringify(p.sessions), /Database checkpoint/);
  assert.match(rolloutPlanMarkdown(p), /Skipped \(nothing to change\): Database, Chat-Service/);
});

test('env-only roles are applied but have nothing to export or transfer', () => {
  const p = plan([role('Chat-Service', { images: 0, envAdds: 2 })]);
  assert.deepEqual(p.sessions.map((s) => s.title.split(':')[0]), ['Session 2', 'After the session']);
  assert.match(JSON.stringify(p.sessions[0]), /2 env key/);
});

test('warnings: blocked roles, high risk, and the bank session; PROD asks for the word PROD', () => {
  const p = plan(four({ 'ChatBot / NLU': { risk: report([f('blocker')]) }, 'Chat-Service': { risk: report([f('high'), f('high')]) } }), 'Prod');
  assert.ok(p.warnings.some((w) => /Blocked: ChatBot \/ NLU/.test(w)));
  assert.ok(p.warnings.some((w) => /High risk: Chat-Service/.test(w)));
  assert.ok(p.warnings.some((w) => /bank session without root/.test(w)));
  assert.match(JSON.stringify(p), /type PROD/);
  assert.doesNotMatch(JSON.stringify(p).replace(/No --yes/g, ''), /--yes/); // only ever mentioned as a prohibition
  const sit = buildRolloutPlan({ sourceEnv: 'UAT', targetEnv: 'SIT', roles: four(), overall: report([]) });
  assert.ok(!sit.warnings.some((w) => /bank session/.test(w)));
  assert.match(sit.sessions[0].title, /export on UAT/);
});

test('nothing to promote says so; markdown carries every command', () => {
  const none = plan(four({ Database: { images: 0 }, 'ChatBot / NLU': { images: 0 }, 'Chat-Service': { images: 0 }, 'Bot-Builder': { images: 0 } }));
  assert.ok(none.warnings.some((w) => /Nothing to promote/.test(w)));
  assert.deepEqual(none.sessions, []);
  const md = rolloutPlanMarkdown(plan(four()));
  assert.match(md, /^# Promotion plan SIT → UAT/);
  assert.match(md, /```bash/);
  assert.match(md, /Health > Add reports/);
});

test('defaultPatchId is a valid folder name, per role, with the environments and the date', async () => {
  const { defaultPatchId } = await import('./rolloutPlan.js');
  const { PATCH_ID_PATTERN } = await import('./runbook.js');
  const d = new Date('2026-10-03T12:00:00Z');
  assert.equal(defaultPatchId('ChatBot / NLU', 'SIT', 'UAT', d), 'PROMO-CHATBOT-SIT-UAT-20261003');
  assert.equal(defaultPatchId('Database', 'UAT', 'Prod', d), 'PROMO-DB-UAT-PROD-20261003');
  for (const r of ['Bot-Builder', 'ChatBot / NLU', 'Database', 'Chat-Service', 'Something else']) assert.ok(PATCH_ID_PATTERN.test(defaultPatchId(r, 'SIT', 'UAT', d)), r);
});
