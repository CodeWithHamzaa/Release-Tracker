import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewRecords, normalizeRecordPatch, isFail, MAX_RECORDS_PER_REQUEST } from './recordInput.js';

const ctx = { addedBy: 'op@x.com', defaultDeveloper: 'Dev Default', now: new Date('2026-10-20T10:00:00Z') };
const base = { environment: 'SIT', server: 'Bot-Builder', service: 'api', version: 'v1.0.0', note: 'Released.' };

function ok(body: unknown) {
  const r = normalizeNewRecords(body, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { records: any[] }).records;
}
function bad(body: unknown, re: RegExp) {
  const r = normalizeNewRecords(body, ctx);
  assert.equal(isFail(r), true, 'expected a validation error');
  assert.match((r as { message: string }).message, re);
}

test('client id, timestamps and added_by are ignored on every input shape', () => {
  const evil = { id: 'evil', createdAt: '2000-01-01', updatedAt: '2000-01-01', added_by: 'Mallory' };
  const single = ok({ ...base, ...evil })[0];
  const [arr] = ok([{ ...base, ...evil }]);
  const [batch] = ok({ ...base, ...evil, services: [{ server: 'S', service: 'x', version: '1', ...evil }] });
  for (const r of [single, arr, batch]) {
    assert.match(r.id, /^rel-[0-9a-f-]{36}$/);
    assert.equal(r.added_by, 'op@x.com');
    assert.equal(r.createdAt, '2026-10-20T10:00:00.000Z');
    assert.equal(r.updatedAt, '2026-10-20T10:00:00.000Z');
  }
});

test('environment is canonicalised and anything else rejected (all shapes)', () => {
  assert.equal(ok({ ...base, environment: 'PROD' })[0].environment, 'Prod');
  assert.equal(ok([{ ...base, environment: 'uat' }])[0].environment, 'UAT');
  bad({ ...base, environment: 'Staging' }, /environment/);
  bad([{ ...base, environment: undefined }], /environment/);
  bad({ ...base, services: [{ server: 'S', service: 'x', version: '1' }], environment: 7 }, /environment/);
});

test('status must be a known value; missing means PENDING', () => {
  assert.equal(ok(base)[0].status, 'PENDING');
  assert.equal(ok({ ...base, status: 'success' })[0].status, 'SUCCESS');
  bad({ ...base, status: 'HACKED' }, /status/);
  bad([{ ...base, status: 'HACKED' }], /status/);
});

test('required fields, no silent placeholder defaults', () => {
  bad({ ...base, service: '' }, /service is required/);
  bad({ ...base, server: undefined }, /server is required/);
  bad({ ...base, version: '   ' }, /version is required/);
  bad({ ...base, note: '' }, /Release Notes/);
  bad({ ...base, note: 'x'.repeat(5001) }, /note/);
  bad({ ...base, service: 'a\nb' }, /single line/);
  bad({ ...base, service: 's'.repeat(101) }, /at most/);
  bad({ ...base, envDetails: 'a\u0000b' }, /null/);
  bad({ ...base, commandDetails: 'x'.repeat(20_001) }, /commandDetails/);
});

test('flags are real booleans: the string "false" is not truthy', () => {
  bad({ ...base, isEnvUpdate: 'false' }, /isEnvUpdate/);
  bad({ ...base, hasCommands: 1 }, /hasCommands/);
  const r = ok({ ...base, isBuildUpdate: false, isConfigUpdate: true, configDetails: ' c ' })[0];
  assert.equal(r.isBuildUpdate, false);
  assert.equal(r.isConfigUpdate, true);
  assert.equal(r.configDetails, 'c');
});

test('batch services inherit shared fields and may override them', () => {
  const rs = ok({ ...base, status: 'SUCCESS', services: [{ server: 'A', service: 'a', version: '1' }, { server: 'B', service: 'b', version: '2', status: 'FAILED' }] });
  assert.deepEqual(rs.map((r) => [r.server, r.status, r.developerName]), [['A', 'SUCCESS', 'Dev Default'], ['B', 'FAILED', 'Dev Default']]);
  bad({ ...base, services: 'nope' }, /services/);
  bad({ ...base, services: [] }, /at least one/);
  bad({ environment: 'SIT', note: 'n', services: [{ server: 'A', service: 'a', version: '1' }, { server: 'B' }] }, /Record 2: service is required/);
});

test('request size and shape limits', () => {
  bad(Array.from({ length: MAX_RECORDS_PER_REQUEST + 1 }, () => base), /At most/);
  assert.equal(ok(Array.from({ length: MAX_RECORDS_PER_REQUEST }, () => base)).length, MAX_RECORDS_PER_REQUEST);
  bad(null, /Send a release record/);
  bad('text', /Send a release record/);
  bad([null], /must be an object/);
  bad([], /at least one/);
});

test('PATCH keeps only valid editable fields and never added_by or id', () => {
  const r = normalizeRecordPatch({ added_by: 'Mallory', id: 'x', createdAt: 'x', bogus: 1, status: 'failed', environment: 'PROD', note: ' n ', isEnvUpdate: false });
  assert.equal(r.ok, true);
  assert.deepEqual((r as any).data, { environment: 'Prod', status: 'FAILED', note: 'n', isEnvUpdate: false });
  assert.deepEqual((normalizeRecordPatch({}) as any).data, {});
});

test('PATCH rejects invalid values instead of dropping or storing them', () => {
  for (const body of [{ status: 'HACKED' }, { environment: 'Dev' }, { note: '  ' }, { hasCommands: 'yes' }, { service: 'x'.repeat(101) }, null, []]) {
    assert.equal(isFail(normalizeRecordPatch(body)), true, JSON.stringify(body));
  }
});
