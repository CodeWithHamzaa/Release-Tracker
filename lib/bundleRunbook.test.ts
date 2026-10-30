import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRunbook, renderOpsBrief, changedKeys, patchId, RunbookInput } from './bundleRunbook.js';

const input = (extra: Partial<RunbookInput> = {}): RunbookInput => ({
  releaseId: 'abcdef12-3456',
  title: 'Chat fixes',
  sourceEnvironment: 'SIT',
  targetEnvironment: 'UAT',
  hasConfigChange: true,
  configDetails: 'Heartbeat 25s',
  services: [
    { server: 'Chat-Service', service: 'chat-service', version: 'v2.1.1', developerName: 'Bilal', composeKey: 'chat-service', image: 'registry.local/chat-service', envDetails: 'HEARTBEAT_MS=25000\nDB_PASSWORD=hunter2' },
    { server: 'Bot-Builder', service: 'alara-ui', version: '2.1.5', developerName: 'Sannia', composeKey: 'alara-ui2', image: 'registry.local/alara-ui' },
  ],
  servers: [{ role: 'Chat-Service', ip: '10.1.1.5', composePath: '/srv/chat', runAs: 'chatuat', access: 'jump 10.200.200.20' }],
  mode: 'standard',
  generatedAt: new Date('2026-10-30T10:00:00Z'),
  ...extra,
});

test('standard runbook: target servers in order, compose keys, essential commands only, secrets redacted', () => {
  const md = renderRunbook(input());
  const id = patchId('abcdef12-3456', new Date('2026-10-30T10:00:00Z'));
  assert.match(md, /Chat-Service → Bot-Builder/);
  assert.ok(md.indexOf('## Chat-Service') < md.indexOf('## Bot-Builder'));
  assert.match(md, /ssh chatuat@10\.1\.1\.5/);
  assert.match(md, /cd \/srv\/chat/);
  assert.match(md, /docker load -i <TAR_DIR>\/chat-service_v2\.1\.1\.tar/);
  assert.match(md, /docker compose up -d --no-deps alara-ui2/);
  assert.match(md, new RegExp(`docker-compose.yml.before-${id}`));
  assert.match(md, /Config change required/);
  assert.match(md, /HEARTBEAT_MS=25000/);
  assert.doesNotMatch(md, /hunter2/);
  assert.doesNotMatch(md, /df -h|sha256sum|docker compose logs/);
  assert.doesNotMatch(md, /docker save|scp|sftp/);
});

test('detailed runbook adds pre-flight and post-checks', () => {
  const md = renderRunbook(input({ mode: 'detailed' }));
  assert.match(md, /Pre-flight checks/);
  assert.match(md, /df -h \/srv\/chat/);
  assert.match(md, /sha256sum <TAR_DIR>\/chat-service_v2\.1\.1\.tar/);
  assert.match(md, /docker compose config -q/);
  assert.match(md, /docker compose logs --tail=100/);
});

test('unknown servers become placeholders listed as unknowns, never guesses', () => {
  const md = renderRunbook(input());
  assert.match(md, /<UAT_BOT_BUILDER_IP>/);
  assert.match(md, /ssh <UAT_BOT_BUILDER_USER>@<UAT_BOT_BUILDER_IP>/);
  assert.match(md, /Bot-Builder \(UAT\): server IP is not in the server registry/);
});

test('ops brief: servers, steps, config keys only; no versions, owners per service or values', () => {
  const md = renderOpsBrief(input());
  assert.match(md, /Deployment brief — UAT/);
  assert.match(md, /\| 1 \| Chat-Service \| 10\.1\.1\.5 \| 1 \|/);
  assert.match(md, /`HEARTBEAT_MS`, `DB_PASSWORD`/);
  assert.doesNotMatch(md, /25000|hunter2|v2\.1\.1|docker load -i/);
  assert.match(md, /Release owner\(s\): Bilal, Sannia/);
  assert.match(renderOpsBrief(input({ hasConfigChange: false })), /## Configuration change required\n\nNo\./);
});

test('changedKeys reads KEY=value and KEY: value lines', () => {
  assert.deepEqual(changedKeys('A=1\nexport B=2\n# c\nC: 3\nfree text'), ['A', 'B', 'C']);
});
