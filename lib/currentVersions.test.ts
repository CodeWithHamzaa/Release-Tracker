import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCurrentVersions, currentVersion, recordsFor, staleVaultFlags, withTag, VersionRecord } from './currentVersions.js';
import type { ComposeServiceSummary } from './configDrift.js';

let n = 0;
const rec = (version: string, createdAt: string, extra: Partial<VersionRecord> = {}): VersionRecord => ({
  id: `r${++n}`,
  environment: 'SIT',
  server: 'Bot-Builder',
  service: 'ldap-connector',
  version,
  status: 'SUCCESS',
  createdAt,
  ...extra,
});
const baseline = { tag: '1.0.0', at: '2026-10-01T10:00:00Z', version: 3 };

test('only the compose upload: the vault tag is current', () => {
  const c = currentVersion(baseline, []);
  assert.equal(c.source, 'vault');
  assert.equal(c.version, '1.0.0');
  assert.equal(c.vaultVersion, 3);
  assert.equal(c.superseded, null);
});

test('a PENDING record after the upload wins; FAILED is ignored', () => {
  const c = currentVersion(baseline, [
    rec('1.0.1', '2026-10-02T09:00:00Z', { status: 'PENDING' }),
    rec('1.0.2', '2026-10-03T09:00:00Z', { status: 'FAILED' }),
  ]);
  assert.equal(c.source, 'record');
  assert.equal(c.version, '1.0.1');
  assert.equal(c.status, 'PENDING');
  assert.deepEqual(c.superseded, { source: 'vault', version: '1.0.0' });
});

test('config- or env-only records never move the image version', () => {
  const c = currentVersion(baseline, [rec('9.9.9', '2026-10-02T09:00:00Z', { isBuildUpdate: false, isConfigUpdate: true })]);
  assert.equal(c.source, 'vault');
  assert.equal(c.version, '1.0.0');
  assert.equal(c.superseded, null);
});

test('the newest of several daily builds wins', () => {
  const c = currentVersion(baseline, [
    rec('1.0.3', '2026-10-04T09:00:00Z'),
    rec('1.0.1', '2026-10-02T09:00:00Z'),
    rec('1.0.2', '2026-10-03T09:00:00Z'),
  ]);
  assert.equal(c.version, '1.0.3');
});

test('a compose re-upload after the latest record wins and reports the record as superseded', () => {
  const c = currentVersion({ tag: '1.1.0', at: '2026-10-05T10:00:00Z', version: 4 }, [rec('1.0.3', '2026-10-04T09:00:00Z')]);
  assert.equal(c.source, 'vault');
  assert.equal(c.version, '1.1.0');
  assert.deepEqual(c.superseded, { source: 'record', version: '1.0.3' });
});

test('a record backdated before the upload loses; equal timestamps go to the record', () => {
  assert.equal(currentVersion(baseline, [rec('0.9.0', '2026-09-30T10:00:00Z')]).source, 'vault');
  assert.equal(currentVersion(baseline, [rec('1.0.5', '2026-10-01T10:00:00Z')]).source, 'record');
});

test('v-prefixed versions are not reported as different', () => {
  const c = currentVersion(baseline, [rec('v1.0.0', '2026-10-02T09:00:00Z')]);
  assert.equal(c.version, 'v1.0.0');
  assert.equal(c.superseded, null);
});

test('no baseline and no deployed record', () => {
  assert.equal(currentVersion(null, [rec('1.0.0', '2026-10-02T09:00:00Z', { status: 'FAILED' })]).source, 'none');
  assert.equal(currentVersion(null, [rec('1.0.0', '2026-10-02T09:00:00Z')]).source, 'record');
});

test('recordsFor matches environment case-insensitively, role and any of the names', () => {
  const all = [
    rec('1', '2026-10-02T09:00:00Z', { environment: 'sit' }),
    rec('2', '2026-10-02T09:00:00Z', { environment: 'UAT' }),
    rec('3', '2026-10-02T09:00:00Z', { server: 'Database' }),
    rec('4', '2026-10-02T09:00:00Z', { service: 'alara-ui' }),
  ];
  assert.deepEqual(recordsFor(all, 'SIT', 'Bot-Builder', ['ldap-connector']).map((r) => r.version), ['1']);
  assert.deepEqual(recordsFor(all, 'SIT', 'Bot-Builder', ['alara-ui2', null, 'alara-ui']).map((r) => r.version), ['4']);
});

test('withTag keeps the registry port and drops a digest', () => {
  assert.equal(withTag('host:5000/team/app:1.0', '1.1'), 'host:5000/team/app:1.1');
  assert.equal(withTag('host:5000/team/app', '1.1'), 'host:5000/team/app:1.1');
  assert.equal(withTag('app@sha256:abc', '2'), 'app:2');
  assert.equal(withTag(null, '2'), null);
});

test('applyCurrentVersions overlays tags matched by compose key, container name or image repo', () => {
  const s = (name: string, image: string, containerName: string | null = null): ComposeServiceSummary => ({
    name, containerName, image, tag: image.split(':')[1], ports: '80→80', envFiles: '', volumes: '',
  });
  const { summaries, versions } = applyCurrentVersions(
    [s('alara-ui2', 'reg/alara-ui:1.0', 'alara-ui'), s('nginx', 'nginx:1.25')],
    { at: '2026-10-01T10:00:00Z', version: 2 },
    'SIT',
    'Bot-Builder',
    [rec('1.4', '2026-10-03T09:00:00Z', { service: 'alara-ui' })]
  );
  assert.equal(summaries[0].tag, '1.4');
  assert.equal(summaries[0].image, 'reg/alara-ui:1.4');
  assert.equal(summaries[0].ports, '80→80');
  assert.equal(versions['alara-ui2'].source, 'record');
  assert.equal(summaries[1].tag, '1.25');
  assert.equal(versions.nginx.source, 'vault');
});

test('stale-vault flags: builds are info, config and env changes are warnings', () => {
  const files = [
    { environment: 'SIT', role: 'Bot-Builder', path: 'docker-compose.yml', latestAt: '2026-10-01T10:00:00Z', latestVersion: 3 },
    { environment: 'SIT', role: 'Bot-Builder', path: '.env', latestAt: '2026-10-01T10:00:00Z' },
    { environment: 'SIT', role: 'Bot-Builder', path: '.env_fbl', latestAt: '2026-10-03T10:00:00Z' },
    { environment: 'UAT', role: 'Bot-Builder', path: 'docker-compose.yml', latestAt: '2026-10-01T10:00:00Z' },
  ];
  const records = [
    rec('1.0.1', '2026-10-02T09:00:00Z', { isBuildUpdate: true }),
    rec('1.0.2', '2026-10-02T11:00:00Z', { isBuildUpdate: true, isConfigUpdate: true }),
    rec('1.0.2', '2026-10-02T12:00:00Z', { isBuildUpdate: false, isEnvUpdate: true }), // older than .env_fbl
    rec('1.0.3', '2026-10-02T13:00:00Z', { isBuildUpdate: true, status: 'FAILED', isConfigUpdate: true }),
    rec('1.0.0', '2026-09-30T09:00:00Z', { isBuildUpdate: true }), // before the upload
  ];
  const [sit, uat] = staleVaultFlags(files, records);
  assert.equal(sit.composePath, 'docker-compose.yml');
  assert.equal(sit.composeVersion, 3);
  assert.equal(sit.buildsSince, 2);
  assert.equal(sit.configStale, '2026-10-02T11:00:00.000Z');
  assert.equal(sit.envStale, null);
  assert.equal(uat.buildsSince, 0);
  assert.equal(uat.configStale, null);

  const [later] = staleVaultFlags(files, [rec('x', '2026-10-04T09:00:00Z', { isBuildUpdate: false, isEnvUpdate: true })]);
  assert.equal(later.envStale, '2026-10-04T09:00:00.000Z');
});
