import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewRelease, normalizeReleasePatch } from './releaseInput.js';
import { isFail } from './recordInput.js';

const ctx = { addedBy: 'op@x.com', defaultDeveloper: 'Team', now: new Date('2026-10-30T12:00:00Z') };
const body = (extra: Record<string, unknown> = {}) => ({
  title: 'Chat fixes',
  environment: 'sit',
  note: 'Fixes the reconnect loop.',
  services: [
    { server: 'Chat-Service', service: 'chat-service', version: 'v2.1.1', developerName: 'Bilal' },
    { server: 'ChatBot / NLU', service: 'retriever_api_service', version: 'v1.4.3', developerName: 'Sannia' },
  ],
  ...extra,
});

test('a release keeps one owner per service and stamps every record with the release date', () => {
  const r = normalizeNewRelease(body({ releasedAt: '2026-09-01T08:30:00Z', status: 'success' }), ctx);
  assert.ok(!isFail(r));
  assert.equal(r.release.environment, 'SIT');
  assert.equal(r.release.status, 'SUCCESS');
  assert.equal(r.release.releasedAt.toISOString(), '2026-09-01T08:30:00.000Z');
  assert.deepEqual(r.records.map((x) => [x.service, x.developerName]), [['chat-service', 'Bilal'], ['retriever_api_service', 'Sannia']]);
  assert.ok(r.records.every((x) => x.createdAt === '2026-09-01T08:30:00.000Z' && x.added_by === 'op@x.com'));
});

test('no releasedAt means now; a future or garbage date is refused', () => {
  const r = normalizeNewRelease(body(), ctx);
  assert.ok(!isFail(r));
  assert.equal(r.release.releasedAt.toISOString(), ctx.now.toISOString());
  assert.ok(isFail(normalizeNewRelease(body({ releasedAt: '2027-01-01T00:00:00Z' }), ctx)));
  assert.ok(isFail(normalizeNewRelease(body({ releasedAt: 'yesterday-ish' }), ctx)));
});

test('the config flag follows the records unless it is given', () => {
  const plain = normalizeNewRelease(body(), ctx);
  assert.ok(!isFail(plain) && plain.release.hasConfigChange === false);
  const env = normalizeNewRelease(body({ isEnvUpdate: true, envDetails: 'A=1' }), ctx);
  assert.ok(!isFail(env) && env.release.hasConfigChange === true);
  const forced = normalizeNewRelease(body({ hasConfigChange: true }), ctx);
  assert.ok(!isFail(forced) && forced.release.hasConfigChange === true);
});

test('title, services and record rules are enforced', () => {
  assert.ok(isFail(normalizeNewRelease(body({ title: '' }), ctx)));
  assert.ok(isFail(normalizeNewRelease(body({ title: 'x'.repeat(151) }), ctx)));
  assert.ok(isFail(normalizeNewRelease(body({ services: [] }), ctx)));
  assert.ok(isFail(normalizeNewRelease(body({ hasConfigChange: 'yes' }), ctx)));
  const bad = normalizeNewRelease(body({ services: [{ server: 'Database', service: 'redis-db' }] }), ctx);
  assert.ok(isFail(bad) && /version/.test(bad.message));
});

test('PLANNED is a valid status', () => {
  const r = normalizeNewRelease(body({ status: 'planned' }), ctx);
  assert.ok(!isFail(r) && r.release.status === 'PLANNED' && r.records.every((x) => x.status === 'PLANNED'));
});

test('patch: only given fields; applyStatusToRecords needs a status', () => {
  const p = normalizeReleasePatch({ status: 'FAILED', applyStatusToRecords: true });
  assert.ok(!isFail(p));
  assert.deepEqual(p.data, { status: 'FAILED' });
  assert.equal(p.applyStatusToRecords, true);
  assert.ok(isFail(normalizeReleasePatch({ applyStatusToRecords: true, title: 'x' })));
  assert.ok(isFail(normalizeReleasePatch({})));
  assert.ok(isFail(normalizeReleasePatch({ status: 'DONE' })));
  const d = normalizeReleasePatch({ releasedAt: '2026-01-02T03:04:05Z', note: '' });
  assert.ok(!isFail(d) && d.data.releasedAt!.toISOString() === '2026-01-02T03:04:05.000Z' && d.data.note === null);
});
