import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToolkitOutput } from './toolkitParse.js';
import type { HealthReportMeta } from './healthModel.js';
import { summarizeCompose } from './configDrift.js';
import { buildRoleRiskInput, canProceed } from './riskInputs.js';
import { evaluateRoleRisk } from './riskEngine.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toolkit');
const rep = (file: string, reportedAt: string): HealthReportMeta => {
  const parsed = parseToolkitOutput(readFileSync(join(FX, file), 'utf8'));
  return { id: file, environment: parsed.environment, role: parsed.role, kind: parsed.kind, reportedAt, host: null, uploadedBy: 'x', createdAt: reportedAt, parsed };
};
const NOW = new Date('2026-10-03T12:00:00Z');
const reports = [rep('chatbot_sit.snapshot', '2026-10-03T08:00:00Z'), rep('chatbot_uat.snapshot', '2026-10-02T08:00:00Z'), rep('chatbot_uat.status.txt', '2026-10-03T09:00:00Z'), rep('chatbot_uat.doctor.txt', '2026-10-03T09:30:00Z')];
const args = (over = {}) => ({
  role: 'ChatBot / NLU', sourceEnv: 'SIT', targetEnv: 'Prod' as string, reports, servers: [{ environment: 'UAT', role: 'ChatBot / NLU', toolkitVersion: '2.4' }],
  compose: {}, records: [], now: NOW, ...over,
});

test('builds the input for SIT -> UAT from the latest snapshots, the target status and doctor', () => {
  const i = buildRoleRiskInput(args({ targetEnv: 'UAT' }));
  assert.ok(i.compare);
  assert.deepEqual([i.sourceEnv, i.targetEnv], ['SIT', 'UAT']);
  assert.equal(i.sourceSnapshotAt, '2026-10-03T08:00:00Z');
  assert.equal(i.toolkitVersion, '2.6'); // the doctor report beats the registry's stale 2.4
  assert.equal(i.targetHealth?.counts.total, 5); // UAT status fixture
});

test('no snapshot pair for the target means no compare (and the engine then blocks)', () => {
  const i = buildRoleRiskInput(args()); // no PROD snapshot
  assert.equal(i.compare, null);
  assert.equal(i.targetSnapshotAt, null);
  assert.equal(evaluateRoleRisk(i).band, 'blocked');
});

test('the registry supplies the toolkit version when there is no doctor report; vault compose and PENDING records are picked up', () => {
  const only = [rep('chatbot_sit.snapshot', '2026-10-03T08:00:00Z'), rep('chatbot_uat.snapshot', '2026-10-03T08:00:00Z')];
  const compose = { 'ChatBot / NLU': { SIT: { summaries: summarizeCompose('services:\n  memento:\n    image: m:2\n') }, UAT: { summaries: summarizeCompose('services:\n  memento:\n    image: m:1\n') } } };
  const records = [
    { environment: 'UAT', server: 'ChatBot / NLU', service: 'memento', version: 'v2', status: 'PENDING' },
    { environment: 'UAT', server: 'ChatBot / NLU', service: 'old', version: 'v1', status: 'SUCCESS' },
    { environment: 'Prod', server: 'ChatBot / NLU', service: 'other-env', version: 'v1', status: 'PENDING' },
    { environment: 'UAT', server: 'Database', service: 'other-role', version: 'v1', status: 'PENDING' },
  ];
  const i = buildRoleRiskInput(args({ targetEnv: 'UAT', reports: only, compose, records }));
  assert.equal(i.toolkitVersion, '2.4');
  assert.equal(i.sourceCompose?.[0].name, 'memento');
  assert.equal(i.targetCompose?.[0].tag, '1');
  assert.deepEqual(i.pendingRecords, [{ service: 'memento', version: 'v2' }]);
  assert.equal(evaluateRoleRisk(i).findings.some((f) => f.id.endsWith(':toolkit-old')), true); // 2.4 is older than the patch command
});

test('the Database role never gets a compare', () => {
  const i = buildRoleRiskInput(args({ role: 'Database', targetEnv: 'UAT' }));
  assert.equal(i.compare, null);
});

test('canProceed: blockers stop everything, high findings need a tick, medium never does', () => {
  const f = (id: string, severity: string) => ({ id, severity });
  assert.equal(canProceed([], new Set()).ok, true);
  assert.equal(canProceed([f('a', 'medium')], new Set()).ok, true);
  assert.match(canProceed([f('a', 'blocker'), f('b', 'high')], new Set(['b'])).reason!, /1 blocker/);
  assert.match(canProceed([f('a', 'high'), f('b', 'high')], new Set(['a'])).reason!, /1 high-risk/);
  assert.equal(canProceed([f('a', 'high')], new Set(['a'])).ok, true);
});

test('stale-vault flags for the source and target reach the risk input', () => {
  const stale = [
    { environment: 'SIT', role: 'ChatBot / NLU', composePath: 'docker-compose.yml', composeVersion: 2, buildsSince: 3, configStale: '2026-10-02T09:00:00.000Z', envStale: null },
    { environment: 'UAT', role: 'ChatBot / NLU', composePath: 'docker-compose.yml', composeVersion: 1, buildsSince: 0, configStale: null, envStale: '2026-10-01T09:00:00.000Z' },
    { environment: 'UAT', role: 'Bot-Builder', composePath: null, composeVersion: null, buildsSince: 0, configStale: '2026-10-01T09:00:00.000Z', envStale: null },
  ];
  const i = buildRoleRiskInput(args({ targetEnv: 'UAT', stale }));
  assert.deepEqual(i.vaultStale, [
    { env: 'SIT', file: 'compose', at: '2026-10-02T09:00:00.000Z' },
    { env: 'UAT', file: 'env', at: '2026-10-01T09:00:00.000Z' },
  ]);
  // Build records newer than the compose file are normal now: no finding.
  assert.ok(!evaluateRoleRisk(buildRoleRiskInput(args({ targetEnv: 'UAT' }))).findings.some((f) => f.id.includes('vault-stale')));
});
