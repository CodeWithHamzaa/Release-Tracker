import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToolkitOutput } from './toolkitParse.js';
import { ageLevel, ageText, containerFor, runningIndex, sameVersion, serverHealth, versionChecks, HealthReportMeta } from './healthModel.js';
import { summarizeCompose } from './configDrift.js';
import type { ReleaseRecord } from './types.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toolkit');
const report = (file: string, reportedAt: string): HealthReportMeta => {
  const parsed = parseToolkitOutput(readFileSync(join(FX, file), 'utf8'));
  return { id: file, environment: parsed.environment, role: parsed.role, kind: parsed.kind, reportedAt, host: null, uploadedBy: 'x', createdAt: reportedAt, parsed };
};
const rec = (over: Partial<ReleaseRecord>): ReleaseRecord => ({
  id: Math.random().toString(36), environment: 'SIT', server: 'ChatBot / NLU', service: 'memento', version: '1.1.8',
  developerName: 'x', status: 'SUCCESS', isBuildUpdate: true, isEnvUpdate: false, isConfigUpdate: false, hasCommands: false,
  added_by: 'A.Hameed', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', ...over,
});

test('serverHealth: counts from the newer of status/snapshot, doctor version and problems', () => {
  const h = serverHealth([
    report('chatbot_sit.snapshot', '2026-10-01T10:00:00Z'),
    report('chatbot_sit.status.txt', '2026-10-02T10:00:00Z'),
  ]);
  assert.equal(h.containersFrom, 'status');
  assert.deepEqual(h.counts, { total: 6, up: 4, unhealthy: 1, starting: 1, restarting: 1, exited: 1 });
  assert.equal(h.newestAt, '2026-10-02T10:00:00Z');
  assert.equal(h.configMismatch, null);
  assert.equal(h.envFiles[0].state, 'plain');

  const d = serverHealth([report('chatbot_uat.doctor.txt', '2026-10-02T00:00:00Z')]);
  assert.equal(d.toolkitVersion, '2.6');
  assert.equal(d.doctorPassed, false);
  assert.equal(d.doctorProblems.length, 5);
  assert.equal(d.containersFrom, null);
});

test('ageLevel / ageText', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  assert.equal(ageLevel('2026-10-01T12:00:00Z', now), 'fresh');
  assert.equal(ageLevel('2026-09-20T12:00:00Z', now), 'stale');
  assert.equal(ageLevel('2026-08-01T12:00:00Z', now), 'old');
  assert.equal(ageText('2026-10-02T11:30:00Z', now), '30m ago');
  assert.equal(ageText('2026-09-28T12:00:00Z', now), '4d ago');
});

test('versionChecks: running vs recorded vs vault, loose v-prefix match', () => {
  const status = report('chatbot_sit.status.txt', '2026-10-02T10:00:00Z');
  const records = [
    rec({ service: 'memento', version: 'v1.1.8' }), // same as running (v1.1.8)
    rec({ service: 'retriever_api_service', version: '7aa11111' }), // server runs 8bd276a2
    rec({ service: 'retriever_api_service', version: '8bd276a2', status: 'PENDING', createdAt: '2026-10-01T00:00:00Z' }), // ignored
  ];
  const compose = summarizeCompose('services:\n  memento:\n    image: registry.local/memento:1.1.7\n');
  const checks = versionChecks((status.parsed as any).containers, records, compose);
  const by = Object.fromEntries(checks.map((c) => [c.container, c]));
  assert.deepEqual([by.memento.running, by.memento.recorded, by.memento.vault, by.memento.recordMismatch, by.memento.vaultMismatch], ['v1.1.8', 'v1.1.8', '1.1.7', false, true]);
  assert.deepEqual([by.retriever_api_service.recorded, by.retriever_api_service.recordMismatch], ['7aa11111', true]);
  assert.equal(by['sent-lang'].recorded, null);
  assert.ok(sameVersion('v2.4.2', '2.4.2'));
});

test('containerFor matches by name, compose service label, then image repo', () => {
  const bb = report('bb_sit.status.txt', '2026-10-02T10:00:00Z');
  const cs = (bb.parsed as any).containers;
  assert.equal(containerFor(cs, 'alara-ui')!.name, 'alara-ui2'); // via compose service label
  assert.equal(containerFor(cs, 'nginx')!.name, 'nginx');
  assert.equal(containerFor(cs, 'kafka'), null);
});

test('runningIndex keys by ENV::role::service for the Drift Matrix', () => {
  const idx = runningIndex(
    [report('bb_prod.snapshot', '2026-10-02T09:00:00Z')],
    [rec({ environment: 'Prod', server: 'Bot-Builder', service: 'ldap-connector', version: '2.4.3' })]
  );
  assert.deepEqual(Object.keys(idx), ['PROD::Bot-Builder::ldap-connector']);
  assert.equal(idx['PROD::Bot-Builder::ldap-connector'].tag, '2.4.2');
});
