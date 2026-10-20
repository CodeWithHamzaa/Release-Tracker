import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChangeIndex, changesForBuild, extractChangeKeys, inclusionOf, knownBuilds, MappingRecord } from './changeMap.js';

const R = 'Bot-Builder';
let n = 0;
const rec = (environment: string, version: string, createdAt: string, note = '', extra: Partial<MappingRecord> = {}): MappingRecord => ({
  id: `r${++n}`, environment, server: R, service: 'ldap', version, status: 'SUCCESS', note, createdAt, isBuildUpdate: true, ...extra,
});

const records = [
  rec('SIT', 'v1.0', '2026-09-01T00:00:00Z'),
  rec('SIT', 'v1.1', '2026-09-05T00:00:00Z', 'Fixes BANK-42 timeout'),
  rec('SIT', 'v1.2', '2026-09-10T00:00:00Z'),
  rec('UAT', 'v1.1', '2026-09-12T00:00:00Z', 'promoted'),
  rec('SIT', 'v1.3', '2026-09-15T00:00:00Z', '', { status: 'FAILED' }),
];

test('change keys come from notes; prose is not a key', () => {
  assert.deepEqual(extractChangeKeys('Fixes BANK-42 and OPS-7; see covid-19 and v1-2'), ['BANK-42', 'OPS-7']);
  assert.deepEqual(extractChangeKeys(null), []);
});

test('a record note is evidence for its exact build; later builds are inferred, earlier not included', () => {
  const idx = buildChangeIndex({ changes: [], links: [], records });
  assert.equal(inclusionOf(idx, 'BANK-42', { role: R, service: 'ldap', version: '1.1' }).inclusion, 'recorded');
  const later = inclusionOf(idx, 'BANK-42', { role: R, service: 'ldap', version: 'v1.2' });
  assert.equal(later.inclusion, 'inferred');
  assert.match(later.detail, /unverified/);
  assert.equal(inclusionOf(idx, 'BANK-42', { role: R, service: 'ldap', version: 'v1.0' }).inclusion, 'not-included');
  assert.equal(inclusionOf(idx, 'BANK-42', { role: R, service: 'ldap', version: 'abc123' }).inclusion, 'unknown');
  assert.equal(inclusionOf(idx, 'NOPE-1', { role: R, service: 'ldap', version: 'v1.1' }).inclusion, 'unknown');
});

test('manual mappings are declared until verified; an explicit introduced build wins', () => {
  const changes = [{ id: 'c1', key: 'BANK-99', title: 'Login fix', kind: 'fix' }];
  const links = [
    { id: 'l1', changeId: 'c1', role: R, service: 'ldap', version: 'v1.2', relation: 'introduced', verified: false },
    { id: 'l2', changeId: 'c1', role: R, service: 'ldap', version: 'v1.0', relation: 'included', verified: true, evidence: 'git log' },
  ];
  const idx = buildChangeIndex({ changes, links, records });
  assert.equal(idx.changes.get('BANK-99')!.title, 'Login fix');
  assert.deepEqual(idx.changes.get('BANK-99')!.introduced, [{ role: R, service: 'ldap', version: 'v1.2' }]);
  assert.equal(inclusionOf(idx, 'BANK-99', { role: R, service: 'ldap', version: 'v1.2' }).inclusion, 'declared');
  assert.equal(inclusionOf(idx, 'BANK-99', { role: R, service: 'ldap', version: 'v1.0' }).inclusion, 'verified');
  assert.equal(inclusionOf(idx, 'BANK-99', { role: R, service: 'ldap', version: 'v1.1' }).inclusion, 'not-included');
});

test('changesForBuild lists every change of the service with its inclusion', () => {
  const idx = buildChangeIndex({ changes: [], links: [], records });
  assert.deepEqual(changesForBuild(idx, { role: R, service: 'ldap', version: 'v1.2' }).map((c) => [c.key, c.inclusion]), [['BANK-42', 'inferred']]);
  assert.deepEqual(changesForBuild(idx, { role: R, service: 'other', version: 'v1.2' }), []);
});

test('known builds: newest first, failed builds left out, environments merged', () => {
  const b = knownBuilds(records, R, 'ldap');
  assert.deepEqual(b.map((x) => x.version), ['v1.2', 'v1.1', 'v1.0']);
  assert.deepEqual(b[1].environments, ['SIT', 'UAT']);
});
