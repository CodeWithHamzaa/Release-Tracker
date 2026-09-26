import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { buildRunbook, runbookMarkdown, runbookScript, shellQuote, RunbookInput } from './runbook.js';
import { syncLines } from './syncLines.js';
import type { ReleaseRecord } from './types.js';

const sitChatbot: RunbookInput = {
  environment: 'SIT',
  role: 'ChatBot / NLU',
  patchId: 'PATCH-2026-09-20',
  services: [
    { service: 'memento', version: 'v1.1.8' },
    { service: 'sent-lang', version: '1.2' },
  ],
  server: {
    ip: '10.42.42.250',
    domain: 'evasit.faysalbank.com',
    composePath: null,
    runAs: 'root',
    access: 'Jump server 10.200.200.20 (SSH/SFTP)',
    envFiles: ['.env_fbl', '.env'],
    toolkitVersion: null,
  },
  generatedAt: new Date('2026-10-02T09:00:00Z'),
};

test('runbook: SIT uses the toolkit commands from README_alara_patch v1.0', () => {
  const rb = buildRunbook(sitChatbot);
  const commands = rb.steps.flatMap((s) => s.commands);
  assert.ok(commands.includes('./alara_server.sh doctor'));
  assert.ok(commands.includes('./alara_server.sh patch plan PATCH-2026-09-20'));
  assert.ok(commands.includes('./alara_server.sh patch apply PATCH-2026-09-20'));
  assert.ok(commands.includes('./alara_server.sh patch rollback'));
  assert.ok(!commands.some((c) => /--yes|docker (compose|pull|image prune)/.test(c)));
  assert.equal(rb.syncLine, '2026-10-02 | SIT  | ChatBot      | patch PATCH-2026-09-20: memento v1.1.8, sent-lang 1.2');
  assert.ok(rb.warnings.some((w) => /Compose folder unknown/.test(w)));
  assert.ok(!rb.warnings.some((w) => /PROD/.test(w)));
});

test('runbook: PROD warns about typed PROD and never suggests --yes; non-SIT needs a bank session', () => {
  const rb = buildRunbook({ ...sitChatbot, environment: 'Prod', server: { ...sitChatbot.server!, ip: '10.0.11.72', runAs: null } });
  assert.ok(rb.warnings.some((w) => /type PROD/.test(w)));
  const text = runbookMarkdown({ ...sitChatbot, environment: 'Prod' });
  assert.match(text, /Type PROD when asked/);
  assert.match(text, /bank jump-server session/);
  assert.doesNotMatch(text.replace(/Do not use --yes|--yes is refused/g, ''), /--yes/);
});

test('runbook: PROD with a known account expects it; unknown account is flagged', () => {
  const prodServer = { ...sitChatbot.server!, ip: '10.0.11.72', runAs: 'chatbotpro' };
  const rb = buildRunbook({ ...sitChatbot, environment: 'Prod', server: prodServer });
  assert.ok(!rb.warnings.some((w) => /unverified|unknown/i.test(w) && /account/i.test(w)));
  assert.ok(rb.steps.flatMap((s) => s.commands).includes('whoami   # expect chatbotpro'));
  assert.match(runbookScript({ ...sitChatbot, environment: 'Prod', server: prodServer }), /^EXPECTED_USER='chatbotpro'$/m);

  const unknown = buildRunbook({ ...sitChatbot, environment: 'Prod', server: { ...prodServer, runAs: null } });
  assert.ok(unknown.warnings.includes('Run-as account unknown (unverified).'));
});

test('runbook: bad PATCH_ID is flagged and the script refuses it', () => {
  const bad = { ...sitChatbot, patchId: '../../etc; rm -rf /' };
  assert.ok(buildRunbook(bad).warnings.some((w) => /PATCH_ID/.test(w)));
  assert.throws(() => runbookScript(bad), /Invalid PATCH_ID/);
  assert.throws(() => runbookScript({ ...sitChatbot, server: { ...sitChatbot.server!, ip: null } }), /IP is required/);
});

test('shellQuote survives single quotes', () => {
  const out = execFileSync('bash', ['-c', `printf %s ${shellQuote("it's /root/ISSM/a b")}`]).toString();
  assert.equal(out, "it's /root/ISSM/a b");
});

// Runs the generated script with stubbed hostname / alara_server.sh.
function runScript(opts: { hostIp: string; runAs?: string | null; answer: string; applyExit?: number; withTars?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), 'rb-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'hostname'), `#!/bin/sh\necho "${opts.hostIp} 172.17.0.1"\n`);
  chmodSync(join(bin, 'hostname'), 0o755);
  const compose = join(dir, 'compose');
  mkdirSync(compose);
  writeFileSync(join(compose, 'docker-compose.yml'), 'services:\n  memento:\n    image: memento:v1.1.8\n');
  writeFileSync(
    join(compose, 'alara_server.sh'),
    `#!/bin/sh\necho "$*" >> calls.log\n[ "$1 $2" = "patch apply" ] && exit ${opts.applyExit ?? 0}\nexit 0\n`
  );
  chmodSync(join(compose, 'alara_server.sh'), 0o755);
  if (opts.withTars !== false) mkdirSync(join(compose, 'alara/patches/incoming/PATCH-2026-09-20'), { recursive: true });

  const script = runbookScript({
    ...sitChatbot,
    server: { ...sitChatbot.server!, composePath: compose, runAs: opts.runAs === undefined ? userInfo().username : opts.runAs },
  });
  const file = join(dir, 'runbook.sh');
  writeFileSync(file, script);
  const syntax = spawnSync('bash', ['-n', file]);
  assert.equal(syntax.status, 0, syntax.stderr.toString());

  const res = spawnSync('bash', [file], {
    input: `${opts.answer}\n`,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const log = join(compose, 'calls.log');
  return {
    status: res.status,
    out: res.stdout.toString() + res.stderr.toString(),
    calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
  };
}

test('script: wrong server is refused before touching the toolkit', () => {
  const r = runScript({ hostIp: '10.0.11.72', answer: 'apply' });
  assert.equal(r.status, 2);
  assert.match(r.out, /this runbook is for 10\.42\.42\.250/);
  assert.deepEqual(r.calls, []);
});

test('script: wrong account is refused', () => {
  const r = runScript({ hostIp: '10.42.42.250', runAs: 'chatbotuat-not-me', answer: 'apply' });
  assert.equal(r.status, 2);
  assert.match(r.out, /run as chatbotuat-not-me/);
  assert.deepEqual(r.calls, []);
});

test('script: missing incoming folder is refused', () => {
  const r = runScript({ hostIp: '10.42.42.250', answer: 'apply', withTars: false });
  assert.equal(r.status, 2);
  assert.match(r.out, /copy the tars/);
});

test('script: right server, answer not "apply" stops after the preview', () => {
  const r = runScript({ hostIp: '10.42.42.250', answer: 'no' });
  assert.equal(r.status, 0);
  assert.deepEqual(r.calls, ['doctor', 'patch plan PATCH-2026-09-20']);
});

test('script: right server applies and passes the toolkit exit code through', () => {
  const ok = runScript({ hostIp: '10.42.42.250', answer: 'apply' });
  assert.equal(ok.status, 0);
  assert.deepEqual(ok.calls, ['doctor', 'patch plan PATCH-2026-09-20', 'patch apply PATCH-2026-09-20', 'status']);

  const rolledBack = runScript({ hostIp: '10.42.42.250', answer: 'apply', applyExit: 1 });
  assert.equal(rolledBack.status, 1);
  assert.match(rolledBack.out, /rolled back automatically/);
  assert.ok(rolledBack.calls.includes('status'));
});

const rec = (over: Partial<ReleaseRecord>): ReleaseRecord => ({
  id: Math.random().toString(36),
  environment: 'SIT',
  server: 'ChatBot / NLU',
  service: 'memento',
  version: 'v1.1.8',
  developerName: 'x',
  status: 'SUCCESS',
  isBuildUpdate: true,
  isEnvUpdate: false,
  isConfigUpdate: false,
  hasCommands: false,
  added_by: 'A.Hameed',
  createdAt: '2026-10-02T10:00:00',
  updatedAt: '2026-10-02T10:00:00',
  ...over,
});

test('syncLines: groups day+env+role, newest first, skips PENDING, uses PATCH id from note', () => {
  const lines = syncLines([
    rec({ service: 'memento', version: 'v1.1.8', note: 'Applied PATCH-1002 tonight' }),
    rec({ service: 'sent-lang', version: '1.2' }),
    rec({ environment: 'UAT', server: 'Bot-Builder', service: 'nginx', version: '1.0', status: 'FAILED', createdAt: '2026-10-03T08:00:00' }),
    rec({ service: 'x', status: 'PENDING', createdAt: '2026-10-04T08:00:00' }),
    rec({ service: 'old', createdAt: '2026-09-01T08:00:00' }),
  ], '2026-09-20');
  assert.deepEqual(lines, [
    '2026-10-03 | UAT  | Bot-Builder  | release: nginx 1.0 (FAILED)',
    '2026-10-02 | SIT  | ChatBot      | patch PATCH-1002: memento v1.1.8, sent-lang 1.2',
  ]);
});
