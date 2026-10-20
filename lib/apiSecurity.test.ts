// End-to-end checks of the real Express app (lib/app.ts) in strict/production
// mode, through lib/apiTestHarness.ts (nothing leaves the process).

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, ApiHarness } from './apiTestHarness.js';

const SECRET = 'DB_PASSWORD=hunter2';

let calls: string[] = [];
let lastCreate: any[] = [];
let lastUpdate: any = null;

function fakePrisma() {
  const rec = (name: string, value: unknown = {}) => async (args?: any) => {
    calls.push(name);
    return typeof value === 'function' ? (value as any)(args) : value;
  };
  const tx = {
    configFile: { upsert: rec('tx.configFile.upsert', { id: 'f1' }) },
    configFileVersion: {
      findFirst: rec('tx.configFileVersion.findFirst', null),
      create: rec('tx.configFileVersion.create', (a: any) => ({ id: 'v1', version: a.data.version })),
    },
  };
  return {
    releaseRecord: {
      findMany: rec('releaseRecord.findMany', []),
      createMany: rec('releaseRecord.createMany', (a: any) => { lastCreate = a.data; return { count: a.data.length }; }),
      update: rec('releaseRecord.update', (a: any) => { lastUpdate = a; return { id: a.where.id }; }),
      delete: rec('releaseRecord.delete'),
    },
    configFile: { findMany: rec('configFile.findMany', []), delete: rec('configFile.delete') },
    configFileVersion: {
      findUnique: rec('configFileVersion.findUnique', { id: 'v9', version: 1, content: SECRET, file: { id: 'f1', environment: 'Prod', role: 'Database', path: '.env' } }),
    },
    healthReport: { delete: rec('healthReport.delete') },
    service: { delete: rec('service.delete') },
    serviceDeployment: { count: rec('serviceDeployment.count', 0) },
    $transaction: async (fn: any) => { calls.push('$transaction'); return fn(tx); },
    $connect: async () => {},
  };
}

let harness: ApiHarness;

before(async () => {
  // The first test runs without SUPABASE_URL to prove strict mode fails closed.
  harness = await startApi(fakePrisma());
});

after(() => harness.close());

beforeEach(() => {
  calls = [];
  lastCreate = [];
  lastUpdate = null;
  process.env.ALLOWED_EMAILS = 'operator@x.com';
  process.env.ADMIN_EMAILS = 'admin@x.com';
});

const call = (...args: Parameters<ApiHarness['call']>) => harness.call(...args);

const record = { environment: 'SIT', server: 'Bot-Builder', service: 'api', version: 'v1.2.3', note: 'Released.' };

test('strict mode without Supabase settings fails closed (503), even with a token', async () => {
  const res = await call('GET', '/api/records', 'admin-token');
  assert.equal(res.status, 503);
  assert.deepEqual(calls, []);
  process.env.SUPABASE_URL = harness.supabaseUrl;
});

test('strict mode with no ALLOWED_EMAILS / ADMIN_EMAILS fails closed (503) for everyone', async () => {
  process.env.ALLOWED_EMAILS = '';
  process.env.ADMIN_EMAILS = '';
  for (const token of ['admin-token', 'operator-token', 'stranger-token']) {
    const res = await call('GET', '/api/configs/versions/v9', token);
    assert.equal(res.status, 503, token);
  }
  assert.deepEqual(calls, []);
});

test('unauthenticated and invalid-token requests are 401 and never reach the database', async () => {
  for (const [method, path] of [['GET', '/api/records'], ['POST', '/api/records'], ['DELETE', '/api/records/r1'], ['GET', '/api/configs/versions/v9'], ['POST', '/api/configs'], ['DELETE', '/api/configs/f1']]) {
    assert.equal((await call(method, path)).status, 401, `${method} ${path} without a token`);
    assert.equal((await call(method, path, 'forged-token')).status, 401, `${method} ${path} with a bad token`);
  }
  assert.deepEqual(calls, []);
});

test('/api/health stays open', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('a valid account that is not on either list gets 403 everywhere', async () => {
  for (const [method, path] of [['GET', '/api/records'], ['POST', '/api/records'], ['GET', '/api/configs/versions/v9'], ['DELETE', '/api/records/r1']]) {
    const res = await call(method, path, 'stranger-token', method === 'POST' ? record : undefined);
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.deepEqual(calls, []);
});

test('operators: normal work allowed; vault contents and destructive actions are 403', async () => {
  assert.equal((await call('GET', '/api/records', 'operator-token')).status, 200);
  assert.equal((await call('GET', '/api/configs', 'operator-token')).status, 200); // metadata only
  assert.equal((await call('POST', '/api/records', 'operator-token', record)).status, 201);
  calls = [];

  const denied: [string, string, unknown?][] = [
    ['GET', '/api/configs/versions/v9'],
    ['POST', '/api/configs', { environment: 'Prod', role: 'Database', path: '.env', content: 'A=1' }],
    ['POST', '/api/configs/sync', {}],
    ['DELETE', '/api/configs/f1'],
    ['DELETE', '/api/records/r1'],
    ['DELETE', '/api/catalog/services/s1'],
    ['DELETE', '/api/health-reports/h1'],
  ];
  for (const [method, path, body] of denied) {
    const res = await call(method, path, 'operator-token', body);
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.doesNotMatch(await res.text(), /hunter2/);
  }
  assert.deepEqual(calls, [], 'no denied request may touch the database');
});

test('admins can read vault contents (uncached) and delete', async () => {
  const res = await call('GET', '/api/configs/versions/v9', 'admin-token');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).version.content, SECRET);
  assert.equal((await call('DELETE', '/api/records/r1', 'admin-token')).status, 200);
  assert.ok(calls.includes('releaseRecord.delete'));
});

test('without ADMIN_EMAILS, ALLOWED_EMAILS users keep admin rights (lock-out guard)', async () => {
  process.env.ADMIN_EMAILS = '';
  assert.equal((await call('GET', '/api/configs/versions/v9', 'operator-token')).status, 200);
  assert.equal((await call('GET', '/api/configs/versions/v9', 'stranger-token')).status, 403);
});

test('POST /api/records ignores client id, timestamps and added_by', async () => {
  const res = await call('POST', '/api/records', 'operator-token', { ...record, id: 'evil', createdAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z', added_by: 'Mallory' });
  assert.equal(res.status, 201);
  const [r] = (await res.json()).records;
  assert.notEqual(r.id, 'evil');
  assert.match(r.id, /^rel-/);
  assert.equal(r.added_by, 'operator@x.com');
  assert.ok(Date.now() - new Date(r.createdAt).getTime() < 60_000);
  assert.equal(lastCreate[0].added_by, 'operator@x.com');
  assert.notEqual(lastCreate[0].id, 'evil');
});

test('POST /api/records rejects bad input on all three body shapes', async () => {
  const bodies: unknown[] = [
    { ...record, environment: 'Staging' },
    [{ ...record, status: 'HACKED' }],
    { ...record, services: [{ server: 'S', service: 'x', version: '1', status: 'HACKED' }] },
    { ...record, isEnvUpdate: 'false' },
    { ...record, note: '' },
  ];
  for (const body of bodies) {
    const res = await call('POST', '/api/records', 'operator-token', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(calls, []);
});

test('PATCH /api/records/:id validates input and cannot change added_by', async () => {
  assert.equal((await call('PATCH', '/api/records/r1', 'operator-token', { status: 'HACKED' })).status, 400);
  assert.equal((await call('PATCH', '/api/records/r1', 'operator-token', { added_by: 'Mallory', id: 'x', status: 'success' })).status, 200);
  assert.deepEqual(Object.keys(lastUpdate.data).sort(), ['status', 'updatedAt']);
  assert.equal(lastUpdate.data.status, 'SUCCESS');
});

test('body limits: small JSON routes 413, file routes accept a full 1 MB file, huge bodies 413', async () => {
  const big = await call('POST', '/api/records', 'operator-token', { ...record, note: 'x'.repeat(300_000) });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error, 'Payload Too Large');

  // A 1 MB config full of quotes is ~2 MB once JSON-escaped: must still be accepted.
  const quoted = '"'.repeat(1_000_000);
  const okFile = await call('POST', '/api/configs', 'admin-token', { environment: 'Prod', role: 'Database', path: 'app.conf', content: quoted });
  assert.equal(okFile.status, 201);

  const over = await call('POST', '/api/configs', 'admin-token', { environment: 'Prod', role: 'Database', path: 'app.conf', content: 'a'.repeat(1_000_001) });
  assert.equal(over.status, 413);

  const huge = await call('POST', '/api/configs', 'admin-token', { environment: 'Prod', role: 'Database', path: 'app.conf', content: 'a'.repeat(3_500_000) });
  assert.equal(huge.status, 413);
  assert.equal((await huge.json()).error, 'Payload Too Large');

  const malformed = await call('POST', '/api/records', 'operator-token', undefined, '{not json');
  assert.equal(malformed.status, 400);
});
