import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBundles, mismatchedRecords, nextEnvironment } from './releaseFeed.js';
import type { Release, ReleaseRecord } from './types.js';

const rec = (id: string, extra: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
  id, environment: 'SIT', server: 'Bot-Builder', service: id, version: 'v1', developerName: 'Dev', status: 'PENDING',
  isBuildUpdate: true, isEnvUpdate: false, isConfigUpdate: false, hasCommands: false, note: 'n', added_by: 'a',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...extra,
});
const rel = (id: string, extra: Partial<Release> = {}): Release => ({
  id, title: `Release ${id}`, environment: 'SIT', status: 'PENDING', releasedAt: '2026-10-05T00:00:00Z',
  hasConfigChange: false, createdBy: 'a', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', ...extra,
});

test('records of one release form one bundle; servers in deployment order; owners per service', () => {
  const bundles = buildBundles(
    [rel('R1', { hasConfigChange: true })],
    [
      rec('ui', { releaseId: 'R1', developerName: 'Sannia' }),
      rec('redis', { releaseId: 'R1', server: 'Database', developerName: 'Ali' }),
      rec('chat', { releaseId: 'R1', server: 'Chat-Service', developerName: 'Bilal' }),
    ]
  );
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].records.length, 3);
  assert.deepEqual(bundles[0].servers, ['Database', 'Chat-Service', 'Bot-Builder']);
  assert.deepEqual(bundles[0].records.map((r) => r.service), ['redis', 'chat', 'ui']);
  assert.deepEqual(new Set(bundles[0].owners), new Set(['Sannia', 'Ali', 'Bilal']));
  assert.equal(bundles[0].hasConfigChange, true);
});

test('legacy records (no release, or an unknown one) become one-service bundles, newest first', () => {
  const bundles = buildBundles([rel('R1')], [
    rec('old', { createdAt: '2026-09-01T00:00:00Z', note: 'Old fix\nmore', isEnvUpdate: true }),
    rec('orphan', { releaseId: 'GONE', createdAt: '2026-10-09T00:00:00Z' }),
  ]);
  assert.deepEqual(bundles.map((b) => b.key), ['record:orphan', 'R1', 'record:old']);
  const old = bundles[2];
  assert.equal(old.title, 'Old fix');
  assert.equal(old.hasConfigChange, true);
});

test('bundle status is its own; mismatched records are reported', () => {
  const [b] = buildBundles([rel('R1', { status: 'SUCCESS' })], [rec('a', { releaseId: 'R1', status: 'success' }), rec('b', { releaseId: 'R1', status: 'PLANNED' })]);
  assert.equal(b.status, 'SUCCESS');
  assert.deepEqual(b.recordStatuses, { SUCCESS: 1, PLANNED: 1 });
  assert.deepEqual(mismatchedRecords(b).map((r) => r.id), ['b']);
});

test('next environment', () => {
  assert.equal(nextEnvironment('sit'), 'UAT');
  assert.equal(nextEnvironment('UAT'), 'Prod');
  assert.equal(nextEnvironment('Prod'), null);
});
