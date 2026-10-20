import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareEnvironments, PlanningData, PlanningDeployment } from './envCompare.js';
import { buildChangeIndex, MappingRecord } from './changeMap.js';
import { parseScopeInput, resolveScope, PatchScopeInput } from './patchScope.js';

const R = 'Bot-Builder';
const NOW = new Date('2026-10-20T00:00:00Z');
const dep = (environment: string, service: string, image: string, extra: Partial<PlanningDeployment> = {}): PlanningDeployment => ({
  service, role: R, environment, composeKey: service, containerName: service, image, tag: image.split(':').pop()!, composeFile: 'docker-compose.yml', vaultVersion: 1, vaultAt: '2026-08-01T00:00:00Z', ...extra,
});
let n = 0;
const rec = (environment: string, service: string, version: string, createdAt: string, note = ''): MappingRecord & any => ({
  id: `r${++n}`, environment, server: R, service, version, status: 'SUCCESS', note, createdAt, isBuildUpdate: true,
});

function setup(extra: Partial<PlanningData> = {}) {
  const records = [
    rec('SIT', 'ldap', 'v1.1', '2026-09-01T00:00:00Z'),
    rec('UAT', 'ldap', 'v1.1', '2026-09-02T00:00:00Z'),
    rec('SIT', 'ldap', 'v1.2', '2026-09-05T00:00:00Z', 'BANK-42 login timeout'),
    rec('SIT', 'ldap', 'v1.3', '2026-09-10T00:00:00Z'),
    rec('SIT', 'ldap', 'v1.4', '2026-09-15T00:00:00Z'),
  ];
  const data: PlanningData = {
    records,
    deployments: [
      dep('SIT', 'ldap', 'reg/ldap:v1.1'), dep('UAT', 'ldap', 'reg/ldap:v1.1'),
      dep('SIT', 'rbac', 'reg/rbac:2.0'), dep('UAT', 'rbac', 'reg/rbac:1.9'),
      dep('SIT', 'ui', 'reg/ui:3.0'), dep('UAT', 'ui', 'reg/ui:3.0'),
      dep('SIT', 'newsvc', 'reg/newsvc:1.0'),
      dep('SIT', 'flaky', 'reg/flaky:latest'), dep('UAT', 'flaky', 'reg/flaky:1'),
    ],
    reports: [], servers: [], vaultFiles: [],
    ...extra,
  };
  const comparison = compareEnvironments(data, { sourceEnv: 'SIT', targetEnv: 'UAT', now: NOW });
  const index = buildChangeIndex({ changes: [], links: [], records });
  return { comparison, index, records };
}
const scope = (s: Partial<PatchScopeInput>): PatchScopeInput => ({ mode: 'builds', selections: [], changeKeys: [], includeConfig: true, ...s });
const K = (svc: string) => `${R}::${svc}`;

test('full sync: every differing service plus the missing one, conflicts skipped, unchanged left out', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ mode: 'full-sync' }), index, records);
  assert.deepEqual(out.items.map((i) => [i.service, i.to.tag]), [['ldap', 'v1.4'], ['newsvc', '1.0'], ['rbac', '2.0']]);
  assert.equal(out.items.find((i) => i.service === 'newsvc')!.newService, true);
  assert.match(out.items.find((i) => i.service === 'newsvc')!.blocking.join(' '), /add its service definition by hand/);
  assert.ok(out.skipped.some((s) => s.key === K('flaky') && /Conflicting/.test(s.reason)));
  assert.ok(!out.items.some((i) => i.service === 'ui'));
});

test('selected builds: only the picked services; the rollback point is the target build', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ selections: [{ key: K('rbac') }] }), index, records);
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.items[0].to, { image: 'reg/rbac:2.0', tag: '2.0', imageId: null });
  assert.deepEqual(out.items[0].from, { image: 'reg/rbac:1.9', tag: '1.9', imageId: null });
  assert.deepEqual(out.configRoles, [R]);
});

test('one image per service: intermediate builds are listed, never loaded', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ selections: [{ key: K('ldap') }] }), index, records);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].to.tag, 'v1.4');
  assert.deepEqual(out.items[0].skippedBuilds, ['v1.2', 'v1.3']);
});

test('a specific older build can be chosen; picking the same service twice keeps the last', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ selections: [{ key: K('ldap'), version: 'v1.3' }, { key: K('ldap'), version: 'v1.2' }] }), index, records);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].to.tag, 'v1.2');
  assert.equal(out.items[0].to.image, 'reg/ldap:v1.2');
  assert.equal(out.items[0].chosen, 'specific-build');
  assert.match(out.warnings.join(' '), /picked twice/);
  assert.match(out.items[0].warnings.join(' '), /not what SIT runs \(v1.4\)/);
});

test('an unlogged build is allowed but flagged unverified', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ selections: [{ key: K('ldap'), version: 'v9.9' }] }), index, records);
  assert.match(out.items[0].warnings.join(' '), /never logged.*unverified build/);
});

test('selecting by change: the service joins at the source build that contains it', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ changeKeys: ['BANK-42'] }), index, records);
  assert.deepEqual(out.items.map((i) => [i.service, i.to.tag, i.why]), [['ldap', 'v1.4', ['change BANK-42']]]);
  assert.deepEqual(out.items[0].changes.map((c) => [c.key, c.inclusion]), [['BANK-42', 'inferred']]);
  assert.match(out.warnings.join(' '), /BANK-42 in ldap v1.4: .*unverified/);
});

test('a chosen build older than the fix is refused for that change', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ selections: [{ key: K('ldap'), version: 'v1.1' }], changeKeys: ['BANK-42'] }), index, records);
  assert.match(out.errors.join(' '), /BANK-42: ldap v1.1 does not contain it/);
});

test('unknown keys and unknown changes are errors, nothing is guessed', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ selections: [{ key: K('ghost') }], changeKeys: ['NOPE-1'] }), index, records);
  assert.equal(out.items.length, 0);
  assert.equal(out.errors.length, 2);
});

test('picking an unchanged service is skipped with the reason', () => {
  const { comparison, index, records } = setup();
  const out = resolveScope(comparison, scope({ selections: [{ key: K('ui') }] }), index, records);
  assert.equal(out.items.length, 0);
  assert.match(out.skipped[0].reason, /already runs 3.0/);
  assert.match(out.warnings.join(' '), /Nothing to promote/);
});

test('scope input is validated', () => {
  assert.equal(parseScopeInput({ mode: 'builds', selections: [{ key: K('ldap'), version: 'v1.2' }] }).ok, true);
  for (const bad of [null, [], { mode: 'all' }, { mode: 'builds', selections: [{ key: 'nocolons' }] }, { mode: 'builds', selections: [{ key: K('x'), version: 'a b' }] }, { mode: 'builds', changeKeys: ['not a key'] }, { mode: 'builds', includeConfig: 'yes' }]) {
    assert.equal(parseScopeInput(bad).ok, false, JSON.stringify(bad));
  }
  const ok = parseScopeInput({ mode: 'full-sync', changeKeys: ['bank-42'] }) as any;
  assert.deepEqual(ok.scope.changeKeys, ['BANK-42']);
  assert.equal(ok.scope.includeConfig, true);
});
