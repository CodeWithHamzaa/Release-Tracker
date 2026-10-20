import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareEnvironments, envTokens, PlanningData, PlanningDeployment, ServiceComparison } from './envCompare.js';
import type { HealthReportMeta } from './healthModel.js';
import { REDACTED } from './redact.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const ROLE = 'ChatBot / NLU';

const dep = (environment: string, service: string, image: string, extra: Partial<PlanningDeployment> = {}): PlanningDeployment => ({
  service,
  role: ROLE,
  environment,
  composeKey: service,
  containerName: service,
  image,
  tag: image.slice(image.lastIndexOf(':') + 1),
  composeFile: 'docker-compose.yml',
  vaultVersion: 1,
  vaultAt: '2026-10-01T00:00:00Z',
  ...extra,
});

const compose = (services: Record<string, string>, extra = '') =>
  'services:\n' + Object.entries(services).map(([n, img]) => `  ${n}:\n    image: ${img}\n    env_file: [.env_fbl]\n${extra}`).join('');

const status = (environment: string, reportedAt: string, containers: [string, string][]): HealthReportMeta => ({
  id: `h-${environment}-${reportedAt}`,
  environment,
  role: ROLE,
  kind: 'status',
  reportedAt,
  host: null,
  uploadedBy: 'a@x.com',
  createdAt: reportedAt,
  parsed: {
    kind: 'status', role: ROLE, environment, ip: null, configPoints: null, workdir: null, envFiles: [], masterKey: null, keyState: null,
    containers: containers.map(([name, image]) => ({ name, service: name, image, status: 'Up 1 hour', ports: null, state: 'running', health: null })),
  } as any,
});

function data(over: Partial<PlanningData> = {}): PlanningData {
  return {
    records: [],
    deployments: [
      dep('SIT', 'memento', 'registry.local/memento:v1.1.9'),
      dep('UAT', 'memento', 'registry.local/memento:v1.1.7'),
      dep('SIT', 'sent-lang', 'registry.local/sent-lang:1.2'),
      dep('UAT', 'sent-lang', 'registry.local/sent-lang:1.2'),
    ],
    reports: [],
    servers: [
      { environment: 'SIT', role: ROLE, ip: '10.1.1.5', domain: 'sit.bank.local', composePath: '/root/ISSM/chatbot', runAs: 'root', access: null, envFiles: ['.env_fbl'], toolkitVersion: '2.6' },
      { environment: 'UAT', role: ROLE, ip: '10.2.2.5', domain: 'uat.bank.local', composePath: '/srv/alara/chatbot_uat', runAs: 'chatbotuat', access: 'jump 10.200.200.20', envFiles: ['.env_fbl'], toolkitVersion: '2.6' },
    ],
    vaultFiles: [
      { environment: 'SIT', role: ROLE, path: 'docker-compose.yml', version: 3, createdAt: '2026-10-01T00:00:00Z', content: compose({ memento: 'registry.local/memento:v1.1.9', 'sent-lang': 'registry.local/sent-lang:1.2' }) },
      { environment: 'UAT', role: ROLE, path: 'docker-compose.yml', version: 2, createdAt: '2026-10-01T00:00:00Z', content: compose({ memento: 'registry.local/memento:v1.1.7', 'sent-lang': 'registry.local/sent-lang:1.2' }) },
    ],
    ...over,
  };
}

const run = (d: PlanningData, includeValues = true) => compareEnvironments(d, { sourceEnv: 'SIT', targetEnv: 'UAT', includeValues, now: NOW });
const svc = (d: PlanningData, name: string, includeValues = true): ServiceComparison =>
  run(d, includeValues).roles.find((r) => r.role === ROLE)!.services.find((s) => s.service === name)!;

test('a newer source build is an update; the same tag is unchanged', () => {
  const m = svc(data(), 'memento');
  assert.equal(m.status, 'update');
  assert.equal(m.desired!.tag, 'v1.1.9');
  assert.equal(m.desired!.image, 'registry.local/memento:v1.1.9');
  assert.equal(m.current!.tag, 'v1.1.7');
  assert.equal(m.desired!.basis, 'expected');
  assert.equal(svc(data(), 'sent-lang').status, 'unchanged');
  assert.deepEqual(run(data()).counts, { update: 1, unchanged: 1, missing: 0, 'target-only': 0, conflict: 0, unknown: 0 });
});

test('expected and observed are kept apart; a missing report is flagged unverified', () => {
  const m = svc(data(), 'memento');
  assert.equal(m.source.expected!.source, 'vault');
  assert.equal(m.source.observed, null);
  assert.ok(m.source.notes.some((n) => /No health report/.test(n) && /unverified/.test(n)));
});

test('a newer deployed build record moves the desired version and keeps the vault repository', () => {
  const d = data({
    records: [{ id: 'r1', environment: 'SIT', server: ROLE, service: 'memento', version: 'v1.2.0', status: 'PENDING', createdAt: '2026-10-10T00:00:00Z', isBuildUpdate: true }],
  });
  const m = svc(d, 'memento');
  assert.equal(m.desired!.tag, 'v1.2.0');
  assert.equal(m.desired!.image, 'registry.local/memento:v1.2.0');
  assert.equal(m.source.expected!.source, 'record');
  assert.equal(m.source.expected!.superseded, 'v1.1.9');
  assert.ok(m.source.notes.some((n) => /PENDING/.test(n)));
});

test('a source-only service is missing on the target; a target-only one is never removed', () => {
  const d = data();
  d.deployments.push(dep('SIT', 'retriever', 'registry.local/retriever:abc123'), dep('UAT', 'legacy', 'registry.local/legacy:1'));
  assert.equal(svc(d, 'retriever').status, 'missing');
  assert.match(svc(d, 'retriever').reasons.join(' '), /added to the target compose file by hand/);
  const legacy = svc(d, 'legacy');
  assert.equal(legacy.status, 'target-only');
  assert.match(legacy.reasons.join(' '), /never removed automatically/);
});

test('a fresh report contradicting the expected version is a conflict; a stale one is only a note', () => {
  const fresh = data({ reports: [status('UAT', '2026-10-19T00:00:00Z', [['memento', 'registry.local/memento:v1.1.6']])] });
  const m = svc(fresh, 'memento');
  assert.equal(m.status, 'conflict');
  assert.match(m.reasons.join(' '), /expects v1.1.7, a recent report shows v1.1.6/);

  const stale = data({ reports: [status('UAT', '2026-09-01T00:00:00Z', [['memento', 'registry.local/memento:v1.1.6']])] });
  const s = svc(stale, 'memento');
  assert.equal(s.status, 'update');
  assert.equal(s.target.observed!.freshness, 'old');
  assert.ok(s.target.notes.some((n) => /over 30 days/.test(n)));
  assert.ok(s.target.notes.some((n) => /reported v1.1.6 running but the tracker expects v1.1.7/.test(n)));
});

test('a floating tag cannot be planned: conflict until pinned', () => {
  const d = data();
  d.deployments[0] = dep('SIT', 'memento', 'registry.local/memento:latest');
  assert.equal(svc(d, 'memento').status, 'conflict');
  assert.match(svc(d, 'memento').reasons.join(' '), /no fixed tag/);
});

test('only a health report on the source: desired comes from it, marked unverified', () => {
  const d = data({ reports: [status('SIT', '2026-10-19T00:00:00Z', [['newsvc', 'registry.local/newsvc:2.0']])] });
  d.deployments.push(dep('UAT', 'newsvc', 'registry.local/newsvc:1.0'));
  const n = svc(d, 'newsvc');
  assert.equal(n.desired!.basis, 'observed');
  assert.equal(n.status, 'update');
  assert.match(n.reasons.join(' '), /health report only/);
});

test('a repository change is reported', () => {
  const d = data();
  d.deployments[0] = dep('SIT', 'memento', 'registry.local/team/memento:v1.1.9');
  const m = svc(d, 'memento');
  assert.equal(m.repoChanged, true);
  assert.match(m.reasons.join(' '), /repository changes/);
});

test('the image ID comes from a receipt only when its tag matches', () => {
  const receipt = (tag: string): HealthReportMeta => ({
    id: 'rc', environment: 'UAT', role: ROLE, kind: 'receipt', reportedAt: '2026-10-18T00:00:00Z', host: null, uploadedBy: 'a', createdAt: '2026-10-18T00:00:00Z',
    parsed: { kind: 'receipt', images: [{ service: 'memento', oldRef: 'memento:v1.1.6', newRef: `memento:${tag}`, oldId: null, newId: 'sha256:0385b610802c72773e7d4ba73628f1f8a3047e5717a2a51d72912fb5ae25f641' }], containers: [] } as any,
  });
  assert.match(svc(data({ reports: [receipt('v1.1.7')] }), 'memento').current!.imageId!, /^sha256:0385/);
  assert.equal(svc(data({ reports: [receipt('v1.1.5')] }), 'memento').current!.imageId, null);
});

test('config: added, removed, changed and env-specific keys; secrets redacted; IPs translated', () => {
  const d = data();
  d.vaultFiles.push(
    { environment: 'SIT', role: ROLE, path: '.env_fbl', version: 1, createdAt: '2026-10-01T00:00:00Z', content: [
      'DB_HOST=10.1.1.5', 'PUBLIC_URL=https://sit.bank.local/chat', 'NEW_FLAG=1', 'NEW_SVC_ADDR=10.1.1.5:9000', 'TIMEOUT=30',
      'DB_PASSWORD=hunter2', 'API_TOKEN=abc', 'MONGO_URI=mongodb://app:s3cret@10.1.1.5/db', 'NEW_SECRET_KEY=zzz',
    ].join('\n') },
    { environment: 'UAT', role: ROLE, path: '.env_fbl', version: 4, createdAt: '2026-10-02T00:00:00Z', content: [
      'DB_HOST=10.2.2.5', 'PUBLIC_URL=https://uat.bank.local/chat', 'TIMEOUT=60', 'DB_PASSWORD=other', 'API_TOKEN=abc',
      'MONGO_URI=mongodb://app:different@10.2.2.5/db', 'ONLY_UAT=1',
    ].join('\n') },
  );
  const role = run(d).roles.find((r) => r.role === ROLE)!;
  const file = role.config.find((f) => f.path === '.env_fbl')!;
  const k = (key: string) => file.keys.find((x) => x.key === key);

  assert.equal(k('DB_HOST')!.change, 'env-specific');
  assert.equal(k('DB_HOST')!.action, 'keep');
  assert.equal(k('PUBLIC_URL')!.change, 'env-specific');
  assert.equal(k('NEW_FLAG')!.change, 'added');
  assert.equal(k('NEW_FLAG')!.action, 'add');
  assert.equal(k('NEW_FLAG')!.proposedValue, '1');
  assert.equal(k('NEW_SVC_ADDR')!.proposedValue, '10.2.2.5:9000', 'SIT IP replaced by the UAT one');
  assert.equal(k('NEW_SVC_ADDR')!.environmentSpecific, true);
  assert.equal(k('TIMEOUT')!.change, 'changed');
  assert.equal(k('TIMEOUT')!.action, 'review');
  assert.equal(k('ONLY_UAT')!.change, 'removed');
  assert.equal(k('ONLY_UAT')!.action, 'keep');
  assert.equal(k('API_TOKEN'), undefined, 'same value: not a difference');

  for (const key of ['DB_PASSWORD', 'MONGO_URI', 'NEW_SECRET_KEY']) {
    const row = k(key)!;
    assert.equal(row.secret, true, key);
    assert.ok(row.sourceValue === null || row.sourceValue === REDACTED, key);
    assert.ok(row.targetValue === null || row.targetValue === REDACTED, key);
    assert.equal(row.proposedValue, null, key);
    assert.equal(row.action, 'review', key);
  }
  const json = JSON.stringify(run(d));
  for (const secret of ['hunter2', 'other', 's3cret', 'different', 'zzz']) assert.ok(!json.includes(secret), `${secret} leaked`);
});

test('config values are withheld entirely unless asked for', () => {
  const d = data();
  d.vaultFiles.push(
    { environment: 'SIT', role: ROLE, path: '.env', version: 1, createdAt: '2026-10-01T00:00:00Z', content: 'A=1\nB=2' },
    { environment: 'UAT', role: ROLE, path: '.env', version: 1, createdAt: '2026-10-01T00:00:00Z', content: 'A=9' },
  );
  const out = run(d, false);
  assert.equal(out.valuesIncluded, false);
  const keys = out.roles[0].config.find((f) => f.path === '.env')!.keys;
  assert.deepEqual(keys.map((x) => [x.key, x.change]), [['A', 'changed'], ['B', 'added']]);
  assert.ok(keys.every((x) => x.sourceValue === null && x.targetValue === null && x.proposedValue === null));
});

test('missing required compose variables and unknown target servers are reported', () => {
  const d = data({ servers: [] });
  d.vaultFiles[1] = { ...d.vaultFiles[1], content: 'services:\n  memento:\n    image: registry.local/memento:${MEMENTO_TAG}\n    environment:\n      - LEVEL=${LOG_LEVEL:-info}\n' };
  d.vaultFiles.push({ environment: 'UAT', role: ROLE, path: '.env', version: 1, createdAt: '2026-10-01T00:00:00Z', content: 'OTHER=1' });
  const role = run(d).roles.find((r) => r.role === ROLE)!;
  assert.deepEqual(role.missingRequired, ['MEMENTO_TAG']);
  assert.equal(role.targetServer.known, false);
  assert.ok(role.notes.some((n) => /No server registry entry for UAT/.test(n)));
});

test('compose field differences per service are listed', () => {
  const d = data();
  d.vaultFiles[0] = { ...d.vaultFiles[0], content: 'services:\n  memento:\n    image: registry.local/memento:v1.1.9\n    ports: ["8100:8100"]\n    depends_on: [redis]\n' };
  d.vaultFiles[1] = { ...d.vaultFiles[1], content: 'services:\n  memento:\n    image: registry.local/memento:v1.1.7\n    ports: ["8101:8100"]\n' };
  const m = svc(d, 'memento');
  assert.deepEqual(m.composeDiff.map((x) => x.field).sort(), ['dependsOn', 'ports']);
  assert.deepEqual(m.dependsOn, []);
});

test('roles come in execution order and env tokens cover each server', () => {
  const d = data();
  d.deployments.push({ ...dep('SIT', 'postgres', 'postgres:16.1'), role: 'Database' });
  assert.deepEqual(run(d).roles.map((r) => r.role), ['Database', ROLE]);
  assert.deepEqual(envTokens(d.servers).UAT, [
    { token: '10.2.2.5', placeholder: `<IP:${ROLE}>` },
    { token: 'uat.bank.local', placeholder: '<DOMAIN>' },
  ]);
});
