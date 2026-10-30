// /api/releases through the real Express app (lib/app.ts) with a fake
// database: access control, validation and what reaches the database.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, ApiHarness } from './apiTestHarness.js';

let calls: string[] = [];
let created: any = null;
let createdRecords: any[] = [];

function fakePrisma() {
  const rec = (name: string, value: unknown = {}) => async (args?: any) => {
    calls.push(name);
    return typeof value === 'function' ? (value as any)(args) : value;
  };
  const tx = {
    release: {
      create: rec('tx.release.create', (a: any) => { created = a.data; return { ...a.data, undoState: a.data.undoState ?? null }; }),
      findUnique: rec('tx.release.findUnique', null),
    },
    releaseRecord: { createMany: rec('tx.releaseRecord.createMany', (a: any) => { createdRecords = a.data; return { count: a.data.length }; }) },
  };
  return {
    release: { findMany: rec('release.findMany', [{ id: 'R1', title: 't', status: 'PLANNED', undoState: { kind: 'created' } }]), delete: rec('release.delete') },
    releaseRecord: { findMany: rec('releaseRecord.findMany', []) },
    $transaction: async (fn: any) => { calls.push('$transaction'); return fn(tx); },
    $connect: async () => {},
  };
}

let harness: ApiHarness;
before(async () => { harness = await startApi(fakePrisma(), { withSupabase: true }); });
after(() => harness.close());
beforeEach(() => { calls = []; created = null; createdRecords = []; });

const release = {
  title: 'Chat fixes',
  environment: 'SIT',
  note: 'Fixes the reconnect loop.',
  releasedAt: '2026-09-01T08:30:00Z',
  services: [
    { server: 'Chat-Service', service: 'chat-service', version: 'v2.1.1', developerName: 'Bilal' },
    { server: 'ChatBot / NLU', service: 'retriever_api_service', version: 'v1.4.3', developerName: 'Sannia' },
  ],
};

test('releases need a signed-in, allowed user', async () => {
  assert.equal((await harness.call('GET', '/api/releases')).status, 401);
  assert.equal((await harness.call('POST', '/api/releases', undefined, release)).status, 401);
  assert.equal((await harness.call('GET', '/api/releases', 'stranger-token')).status, 403);
  assert.deepEqual(calls, []);
});

test('GET hides the undo state and says whether Undo is offered', async () => {
  const res = await harness.call('GET', '/api/releases', 'operator-token');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.releases[0].undoState, undefined);
  assert.equal(body.releases[0].canUndo, true);
});

test('an operator logs a backdated release: one bundle, a record per service with its owner and date', async () => {
  const res = await harness.call('POST', '/api/releases', 'operator-token', release);
  assert.equal(res.status, 201);
  assert.equal(created.title, 'Chat fixes');
  assert.equal(created.createdBy, 'operator@x.com');
  assert.equal(new Date(created.releasedAt).toISOString(), '2026-09-01T08:30:00.000Z');
  assert.deepEqual(createdRecords.map((r) => [r.service, r.developerName, r.releaseId === created.id]), [
    ['chat-service', 'Bilal', true],
    ['retriever_api_service', 'Sannia', true],
  ]);
  assert.ok(createdRecords.every((r) => new Date(r.createdAt).toISOString() === '2026-09-01T08:30:00.000Z'));
});

test('bad input is 400 before the database', async () => {
  for (const bad of [{ ...release, title: '' }, { ...release, services: [] }, { ...release, releasedAt: '2999-01-01' }, { ...release, environment: 'DEV' }]) {
    assert.equal((await harness.call('POST', '/api/releases', 'operator-token', bad)).status, 400);
  }
  assert.equal((await harness.call('POST', '/api/releases/R1/promote', 'operator-token', { targetEnvironment: 'QA' })).status, 400);
  assert.deepEqual(calls, []);
});

test('deleting a release is admin-only', async () => {
  assert.equal((await harness.call('DELETE', '/api/releases/R1', 'operator-token')).status, 403);
  assert.equal((await harness.call('DELETE', '/api/releases/R1', 'admin-token')).status, 200);
});

test('promoting an unknown release is 404', async () => {
  assert.equal((await harness.call('POST', '/api/releases/NOPE/promote', 'operator-token', { targetEnvironment: 'UAT' })).status, 404);
});
