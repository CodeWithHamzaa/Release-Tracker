// Patch planner API through the real app in strict mode (lib/apiTestHarness.ts).

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, ApiHarness } from './apiTestHarness.js';

let reads: string[] = [];
const rec = (name: string, value: unknown) => async () => { reads.push(name); return value; };
const ROLE = 'ChatBot / NLU';

const prisma = {
  releaseRecord: { findMany: rec('releaseRecord', []) },
  serviceDeployment: {
    findMany: rec('serviceDeployment', [
      { environment: 'SIT', role: ROLE, composeKey: 'memento', containerName: 'memento', image: 'r/memento:v2', tag: 'v2', service: { name: 'memento' }, sourceFile: { path: 'docker-compose.yml' }, sourceVersion: { version: 1, createdAt: new Date('2026-10-01') } },
      { environment: 'UAT', role: ROLE, composeKey: 'memento', containerName: 'memento', image: 'r/memento:v1', tag: 'v1', service: { name: 'memento' }, sourceFile: { path: 'docker-compose.yml' }, sourceVersion: { version: 1, createdAt: new Date('2026-10-01') } },
    ]),
  },
  serverNode: { findMany: rec('serverNode', []) },
  healthReport: { findMany: rec('healthReport', []) },
  configFile: {
    findMany: rec('configFile', [
      { environment: 'SIT', role: ROLE, path: '.env', versions: [{ version: 1, createdAt: new Date('2026-10-01'), content: 'DB_PASSWORD=hunter2\nLEVEL=debug\nNEW=1' }] },
      { environment: 'UAT', role: ROLE, path: '.env', versions: [{ version: 1, createdAt: new Date('2026-10-01'), content: 'DB_PASSWORD=swordfish\nLEVEL=info' }] },
    ]),
  },
  change: {
    findMany: rec('change.findMany', [{ id: 'c1', key: 'BANK-42', title: 'Login timeout', kind: 'fix' }]),
    upsert: async (a: any) => { reads.push('change.upsert'); lastWrite = a; return { id: 'c1', ...a.create }; },
    delete: rec('change.delete', {}),
  },
  changeBuild: {
    findMany: rec('changeBuild.findMany', [{ id: 'l1', changeId: 'c1', role: ROLE, service: 'memento', version: 'v2', relation: 'introduced', verified: false }]),
    create: async (a: any) => { reads.push('changeBuild.create'); lastWrite = a; return { id: 'l2', ...a.data }; },
    update: async (a: any) => { reads.push('changeBuild.update'); lastWrite = a; return { id: a.where.id, ...a.data }; },
    delete: rec('changeBuild.delete', {}),
  },
  $connect: async () => {},
};
let lastWrite: any = null;

let h: ApiHarness;
before(async () => { h = await startApi(prisma, { withSupabase: true }); });
after(() => h.close());

const PATH = '/api/environments/compare?source=SIT&target=UAT';

test('compare needs a signed-in, allowed user and never reads the database otherwise', async () => {
  reads = [];
  assert.equal((await h.call('GET', PATH)).status, 401);
  assert.equal((await h.call('GET', PATH, 'forged')).status, 401);
  assert.equal((await h.call('GET', PATH, 'stranger-token')).status, 403);
  assert.deepEqual(reads, []);
});

test('bad environment pairs are 400', async () => {
  assert.equal((await h.call('GET', '/api/environments/compare?source=UAT&target=UAT', 'admin-token')).status, 400);
  assert.equal((await h.call('GET', '/api/environments/compare?source=SIT&target=Staging', 'admin-token')).status, 400);
});

test('admins get redacted values; secrets never appear in the response', async () => {
  const res = await h.call('GET', PATH, 'admin-token');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.doesNotMatch(text, /hunter2|swordfish/);
  const { comparison, warning } = JSON.parse(text);
  assert.equal(warning, null);
  assert.equal(comparison.valuesIncluded, true);
  const role = comparison.roles.find((r: any) => r.role === ROLE);
  assert.equal(role.services[0].status, 'update');
  const keys = role.config[0].keys;
  assert.equal(keys.find((k: any) => k.key === 'LEVEL').sourceValue, 'debug');
  assert.equal(keys.find((k: any) => k.key === 'DB_PASSWORD').sourceValue, '[redacted]');
});

test('operators see which keys differ, without any values', async () => {
  const res = await h.call('GET', PATH, 'operator-token');
  assert.equal(res.status, 200);
  const { comparison } = await res.json();
  assert.equal(comparison.valuesIncluded, false);
  const keys = comparison.roles[0].config[0].keys;
  assert.deepEqual(keys.map((k: any) => k.key).sort(), ['DB_PASSWORD', 'LEVEL', 'NEW']);
  assert.ok(keys.every((k: any) => k.sourceValue === null && k.targetValue === null && k.proposedValue === null));
});

test('an unusual path is allowed with a warning', async () => {
  const res = await h.call('GET', '/api/environments/compare?source=SIT&target=Prod', 'admin-token');
  assert.equal(res.status, 200);
  assert.match((await res.json()).warning, /skips UAT/);
});

test('compare carries build choices and change mapping per service', async () => {
  const { context, changeMapping } = await (await h.call('GET', PATH, 'operator-token')).json();
  assert.equal(changeMapping, true);
  assert.deepEqual(context.services[`${ROLE}::memento`].changes.map((c: any) => [c.key, c.inclusion]), [['BANK-42', 'declared']]);
  assert.deepEqual(context.changes.map((c: any) => c.key), ['BANK-42']);
});

test('changes: allowed users read and write; writes are validated and stamped; deletes are admin-only', async () => {
  reads = [];
  assert.equal((await h.call('GET', '/api/changes')).status, 401);
  assert.equal((await h.call('POST', '/api/changes', 'stranger-token', { key: 'X-1', title: 't' })).status, 403);
  assert.deepEqual(reads, []);

  const list = await (await h.call('GET', '/api/changes', 'operator-token')).json();
  assert.equal(list.changes[0].key, 'BANK-42');
  assert.equal(list.changes[0].evidence[0].linkId, 'l1');

  for (const bad of [{ key: 'not a key', title: 't' }, { key: 'BANK-1' }, { key: 'BANK-1', title: 't', kind: 'epic' }]) {
    assert.equal((await h.call('POST', '/api/changes', 'operator-token', bad)).status, 400, JSON.stringify(bad));
  }
  const created = await h.call('POST', '/api/changes', 'operator-token', { key: 'bank-7', title: ' Fix ', kind: 'feature', createdBy: 'Mallory' });
  assert.equal(created.status, 201);
  assert.equal(lastWrite.create.key, 'BANK-7');
  assert.equal(lastWrite.create.title, 'Fix');
  assert.equal(lastWrite.create.createdBy, 'operator@x.com');

  assert.equal((await h.call('POST', '/api/changes/c1/builds', 'operator-token', { role: ROLE, service: 'memento', version: 'v2', verified: true })).status, 201);
  assert.equal(lastWrite.data.verified, false, 'a new mapping always starts unverified');
  assert.equal((await h.call('POST', '/api/changes/c1/builds', 'operator-token', { role: ROLE, service: 'memento', version: 'v2', relation: 'maybe' })).status, 400);

  assert.equal((await h.call('PATCH', '/api/changes/builds/l1', 'operator-token', { verified: true })).status, 400, 'verifying needs evidence');
  assert.equal((await h.call('PATCH', '/api/changes/builds/l1', 'operator-token', { verified: true, evidence: 'git log v2 shows the commit' })).status, 200);
  assert.equal(lastWrite.data.verifiedBy, 'operator@x.com');

  assert.equal((await h.call('DELETE', '/api/changes/builds/l1', 'operator-token')).status, 403);
  assert.equal((await h.call('DELETE', '/api/changes/c1', 'operator-token')).status, 403);
  assert.equal((await h.call('DELETE', '/api/changes/c1', 'admin-token')).status, 200);
});

test('plan preview: auth, validation, both outputs, no secrets', async () => {
  const body = { source: 'SIT', target: 'UAT', scope: { mode: 'builds', selections: [{ key: `${ROLE}::memento` }] } };
  reads = [];
  assert.equal((await h.call('POST', '/api/patch-plans/preview', undefined, body)).status, 401);
  assert.equal((await h.call('POST', '/api/patch-plans/preview', 'stranger-token', body)).status, 403);
  assert.deepEqual(reads, []);
  assert.equal((await h.call('POST', '/api/patch-plans/preview', 'admin-token', { ...body, scope: { mode: 'everything' } })).status, 400);
  assert.equal((await h.call('POST', '/api/patch-plans/preview', 'admin-token', { ...body, target: 'SIT' })).status, 400);
  assert.equal((await h.call('POST', '/api/patch-plans/preview', 'admin-token', { ...body, patchId: 42 })).status, 400);

  const res = await h.call('POST', '/api/patch-plans/preview', 'admin-token', { ...body, patchId: 'P-1' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /hunter2|swordfish/);
  const out = JSON.parse(text);
  assert.equal(out.plan.patchId, 'P-1');
  assert.deepEqual(out.scope.items.map((i: any) => [i.service, i.to.tag]), [['memento', 'v2']]);
  assert.ok(out.plan.steps.some((s: any) => s.commands.some((c: string) => c.startsWith('docker load -i '))));
  assert.match(out.markdown.steps, /^# Deployment steps: P-1/);
  assert.match(out.markdown.runbook, /## 10\. Unknowns, assumptions and risks/);
  assert.ok(out.plan.unknowns.some((u: string) => /Compose folder on UAT/.test(u)), 'empty server registry -> unknown folder');

  const op = await (await h.call('POST', '/api/patch-plans/preview', 'operator-token', body)).json();
  assert.ok(op.plan.steps.filter((s: any) => s.phase === 'config').every((s: any) => s.manual));
});
