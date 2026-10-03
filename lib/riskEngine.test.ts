import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSnapshots } from './toolkitCompare.js';
import { summarizeCompose } from './configDrift.js';
import type { ServerHealth } from './healthModel.js';
import { bandFor, compareVersions, evaluateRoleRisk, evaluateRollout, RoleRiskInput, RiskFinding } from './riskEngine.js';
import { classifyCompareItems } from './compareItems.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toolkit');
const fx = (n: string) => readFileSync(join(FX, n), 'utf8');
const NOW = new Date('2026-10-03T12:00:00Z');

const health = (over: Partial<ServerHealth['counts']> = {}, extra: Partial<ServerHealth> = {}): ServerHealth => ({
  containers: [], containersFrom: 'status', counts: { total: 5, up: 5, unhealthy: 0, starting: 0, restarting: 0, exited: 0, ...over },
  envFiles: [], masterKey: null, keyState: null, configMismatch: null, toolkitVersion: '2.6', doctorPassed: true, doctorProblems: [], newestAt: '2026-10-03T10:00:00Z', reports: {}, ...extra,
});

const SNAP = (env: string, images: string[], envLines = '') =>
  `# ALARA_RELEASE_SNAPSHOT\n# role: CHAT_BOT\n# environment: ${env}\n## IMAGES\n${images.join('\n')}\n## ENV:.env\n${envLines}\n`;

const base = (over: Partial<RoleRiskInput> = {}): RoleRiskInput => ({
  role: 'ChatBot / NLU', sourceEnv: 'SIT', targetEnv: 'UAT',
  compare: compareSnapshots(SNAP('SIT', ['memento=registry.local/memento:v1.1.9|Up']), SNAP('UAT', ['memento=registry.local/memento:v1.1.8|Up'])),
  sourceSnapshotAt: '2026-10-03T08:00:00Z', targetSnapshotAt: '2026-10-03T08:00:00Z',
  sourceCompose: null, targetCompose: null, targetHealth: health(), toolkitVersion: '2.6', pendingRecords: [], now: NOW, ...over,
});
const ids = (r: { findings: RiskFinding[] }) => r.findings.map((f) => f.id.split(':')[1]).sort();
const sev = (r: { findings: RiskFinding[] }, key: string) => r.findings.find((f) => f.id.endsWith(`:${key}`))?.severity;

test('a clean version bump on a healthy, up-to-date target is low risk', () => {
  const r = evaluateRoleRisk(base({ sourceCompose: summarizeCompose('services:\n  memento:\n    image: m:1\n'), targetCompose: summarizeCompose('services:\n  memento:\n    image: m:1\n') }));
  assert.deepEqual(ids(r), []);
  assert.deepEqual([r.band, r.score], ['low', 0]);
});

test('the real SIT -> UAT ChatBot checklist: new services, target-only service, sensitive and duplicate keys', () => {
  const compare = compareSnapshots(fx('chatbot_sit.snapshot'), fx('chatbot_uat.snapshot'));
  const r = evaluateRoleRisk(base({ compare, targetHealth: health({ unhealthy: 1, restarting: 1, exited: 1 }) }));
  assert.equal(sev(r, 'new-service'), 'high');
  assert.equal(sev(r, 'target-only-service'), 'medium');
  assert.equal(sev(r, 'secret-differs'), 'medium');
  assert.equal(sev(r, 'env-duplicate'), 'medium');
  assert.equal(sev(r, 'env-review'), 'medium');
  assert.equal(sev(r, 'target-unhealthy'), 'high');
  assert.equal(sev(r, 'target-exited'), 'medium');
  assert.equal(sev(r, 'compose-missing'), 'medium'); // no vault compose files given: said, not silently skipped
  assert.match(r.findings.find((f) => f.id.endsWith(':new-service'))!.detail, /litellm-db, litellm-service/);
  assert.equal(r.band, 'high');
});

test('floating tags, a changed repository and a same-tag rebuild', () => {
  const compare = compareSnapshots(
    SNAP('SIT', ['a=reg/a:latest|Up', 'b=reg/b-new:2.0|Up', 'c=reg/c:3.0@sha256:bbbb|Up']),
    SNAP('UAT', ['a=reg/a:1.0|Up', 'b=reg/b:1.0|Up', 'c=reg/c:3.0@sha256:aaaa|Up'])
  );
  const r = evaluateRoleRisk(base({ compare }));
  assert.equal(sev(r, 'floating-tag'), 'high');
  assert.match(r.findings.find((f) => f.id.endsWith(':floating-tag'))!.detail, /a \(reg\/a:latest\)/);
  assert.equal(sev(r, 'repo-changed'), 'high');
  assert.equal(sev(r, 'same-tag'), 'medium');
  // an untagged image counts as floating too
  const untagged = evaluateRoleRisk(base({ compare: compareSnapshots(SNAP('SIT', ['a=reg/a|Up']), SNAP('UAT', ['a=reg/a:1.0|Up'])) }));
  assert.equal(sev(untagged, 'floating-tag'), 'high');
});

test('a secret missing on the target is high; plain new keys are not a risk', () => {
  const secret = compareSnapshots(SNAP('SIT', ['a=reg/a:2|Up'], 'API_TOKEN=SHA256:abc\nFLAG=1'), SNAP('UAT', ['a=reg/a:1|Up'], 'OTHER=1'));
  const r = evaluateRoleRisk(base({ compare: secret }));
  assert.equal(sev(r, 'secret-missing'), 'high');
  assert.match(r.findings.find((f) => f.id.endsWith(':secret-missing'))!.detail, /\.env:API_TOKEN/);
  const plain = compareSnapshots(SNAP('SIT', ['a=reg/a:2|Up'], 'FLAG=1'), SNAP('UAT', ['a=reg/a:1|Up'], 'OTHER=1'));
  assert.equal(sev(evaluateRoleRisk(base({ compare: plain })), 'secret-missing'), undefined);
});

test('toolkit: older than v2.5 blocks, unknown is a warning, v2.10 is newer than v2.5', () => {
  assert.equal(evaluateRoleRisk(base({ toolkitVersion: '2.4' })).band, 'blocked');
  assert.equal(sev(evaluateRoleRisk(base({ toolkitVersion: '2.4' })), 'toolkit-old'), 'blocker');
  assert.equal(sev(evaluateRoleRisk(base({ toolkitVersion: null })), 'toolkit-unknown'), 'medium');
  assert.equal(sev(evaluateRoleRisk(base({ toolkitVersion: '2.10' })), 'toolkit-old'), undefined);
  assert.equal(compareVersions('2.10', '2.5'), 1);
  assert.equal(compareVersions('v2.5.0', '2.5'), 0);
});

test('no snapshot pair blocks an app role, but never Database; old snapshots are flagged', () => {
  const none = evaluateRoleRisk(base({ compare: null, targetSnapshotAt: null }));
  assert.equal(none.band, 'blocked');
  assert.match(none.findings.find((f) => f.id.endsWith(':no-snapshots'))!.detail, /UAT/);
  const db = evaluateRoleRisk(base({ role: 'Database', compare: null, sourceSnapshotAt: null, targetSnapshotAt: null, targetHealth: null }));
  assert.notEqual(db.band, 'blocked');
  assert.equal(sev(evaluateRoleRisk(base({ sourceSnapshotAt: '2026-09-20T00:00:00Z' })), 'snapshot-stale-SIT'), 'medium');
  assert.equal(sev(evaluateRoleRisk(base({ targetSnapshotAt: '2026-08-01T00:00:00Z' })), 'snapshot-old-UAT'), 'high');
});

test('compose: a new host port or volume is high, a changed port mapping is medium; unchanged is quiet', () => {
  const src = summarizeCompose('services:\n  memento:\n    image: m:2\n    ports:\n      - "8080:8080"\n      - "9443:9443"\n      - "7000:7001"\n    volumes:\n      - ./data:/var/data\n      - ./cfg:/etc/memento:ro\n');
  const tgt = summarizeCompose('services:\n  memento:\n    image: m:1\n    ports:\n      - "8080:8080"\n      - "7000:7000"\n    volumes:\n      - /opt/data:/var/data\n');
  const r = evaluateRoleRisk(base({ sourceCompose: src, targetCompose: tgt }));
  assert.equal(sev(r, 'new-ports'), 'high');
  assert.match(r.findings.find((f) => f.id.endsWith(':new-ports'))!.detail, /memento: 9443/);
  assert.equal(sev(r, 'new-volumes'), 'high');
  assert.match(r.findings.find((f) => f.id.endsWith(':new-volumes'))!.detail, /\/etc\/memento/); // container side only; the host path differing is normal
  assert.equal(sev(r, 'changed-ports'), 'medium');
  assert.equal(sev(evaluateRoleRisk(base({ sourceCompose: tgt, targetCompose: tgt })), 'new-volumes'), undefined);
});

test('the target as it is now: config pointing elsewhere and a failed doctor', () => {
  const r = evaluateRoleRisk(base({ targetHealth: health({}, { configMismatch: 'Config points to SIT', doctorPassed: false, doctorProblems: ['MISS alara_patch.sh'] }) }));
  assert.equal(sev(r, 'config-mismatch'), 'high');
  assert.equal(sev(r, 'doctor-failed'), 'medium');
  assert.equal(sev(evaluateRoleRisk(base({ targetHealth: null })), 'target-no-health'), 'medium');
});

test('a target whose doctor reports alara_patch.sh missing is blocked', () => {
  const r = evaluateRoleRisk(base({ targetHealth: health({}, { doctorPassed: false, doctorProblems: ['MISS alara_key.sh', 'MISS alara_patch.sh'] }) }));
  assert.equal(sev(r, 'patch-script-missing'), 'blocker');
  assert.equal(r.band, 'blocked');
  assert.equal(sev(evaluateRoleRisk(base({ targetHealth: health({}, { doctorPassed: false, doctorProblems: ['MISS alara_key.sh'] }) })), 'patch-script-missing'), undefined);
});

test('score and band: mediums add up slowly, highs quickly, any blocker is blocked', () => {
  const f = (severity: RiskFinding['severity']): RiskFinding => ({ id: 'x', severity, role: 'r', title: '', detail: '', source: 'compare' });
  assert.deepEqual(bandFor([]).band, 'low');
  assert.equal(bandFor([f('medium')]).band, 'low');
  assert.equal(bandFor([f('medium'), f('medium'), f('medium')]).band, 'medium'); // 24
  assert.equal(bandFor([f('high')]).band, 'medium'); // 25
  assert.equal(bandFor([f('high'), f('high')]).band, 'high'); // 50
  assert.equal(bandFor([f('blocker')]).band, 'blocked');
  assert.equal(bandFor(Array.from({ length: 20 }, () => f('high'))).score, 99);
});

test('rollout: a Database change bundled with app changes is flagged high on the Database', () => {
  const app = base({ role: 'ChatBot / NLU' });
  const db = base({ role: 'Database', compare: null, sourceSnapshotAt: null, targetSnapshotAt: null, targetHealth: health(), pendingRecords: [{ service: 'mongo-db', version: '7.0.2' }] });
  const r = evaluateRollout([app, db]);
  assert.equal(r.roles.Database.findings.some((x) => x.id === 'Database:bundled' && x.severity === 'high'), true);
  assert.match(r.roles.Database.findings.find((x) => x.id === 'Database:bundled')!.detail, /ChatBot \/ NLU/);
  assert.equal(r.overall.counts.high >= 1, true);
  // Database alone, or apps alone, is not "bundled"
  assert.equal(evaluateRollout([db]).roles.Database.findings.some((x) => x.id === 'Database:bundled'), false);
  assert.equal(evaluateRollout([app, { ...db, pendingRecords: [] }]).roles.Database.findings.some((x) => x.id === 'Database:bundled'), false);
});

test('classifyCompareItems reads every CRITICAL line of the real checklist', () => {
  const kinds = classifyCompareItems(compareSnapshots(fx('chatbot_sit.snapshot'), fx('chatbot_uat.snapshot'))).map((i) => i.kind);
  assert.deepEqual(kinds.filter((k) => k === 'image-update').length, 2);
  assert.ok(kinds.includes('image-deploy') && kinds.includes('image-target-only') && kinds.includes('env-add') && kinds.includes('env-secret-differs'));
  assert.equal(kinds.includes('other'), false);
});
