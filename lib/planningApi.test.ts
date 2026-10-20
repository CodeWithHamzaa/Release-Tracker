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
  $connect: async () => {},
};

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
