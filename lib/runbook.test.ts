import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { buildRunbook, runbookMarkdown, runbookScript, shellQuote, RunbookInput } from './runbook.js';
import { syncLines } from './syncLines.js';
import { installFakeToolkit } from './fakeToolkit.js';
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
  // No registry entry is needed to build a script any more: the toolkit identifies the server.
  assert.doesNotThrow(() => runbookScript({ ...sitChatbot, server: null }));
});

test('shellQuote survives single quotes', () => {
  const out = execFileSync('bash', ['-c', `printf %s ${shellQuote("it's /root/ISSM/a b")}`]).toString();
  assert.equal(out, "it's /root/ISSM/a b");
});

// Runs the generated script against a stand-in toolkit (lib/fakeToolkit.ts):
// the machine's IP is simulated with ALARA_TEST_IPS, alara_server.sh is a stub.
function runScript(opts: {
  ip: string;
  args?: string[];
  runAs?: string | null;
  answer?: string;
  applyExit?: number;
  withTars?: boolean;
  version?: string;
  server?: RunbookInput['server'];
}) {
  const dir = mkdtempSync(join(tmpdir(), 'rb-'));
  const compose = join(dir, 'compose');
  mkdirSync(compose);
  writeFileSync(join(compose, 'docker-compose.yml'), 'services:\n  memento:\n    image: memento:v1.1.8\n');
  installFakeToolkit(compose, { applyExit: opts.applyExit, version: opts.version });
  if (opts.withTars !== false) mkdirSync(join(compose, 'alara/patches/incoming/PATCH-2026-09-20'), { recursive: true });

  const script = runbookScript({
    ...sitChatbot,
    server:
      opts.server === undefined
        ? { ...sitChatbot.server!, composePath: compose, runAs: opts.runAs === undefined ? userInfo().username : opts.runAs }
        : opts.server && { ...opts.server, composePath: compose },
  });
  const file = join(dir, 'runbook.sh');
  writeFileSync(file, script);
  const syntax = spawnSync('bash', ['-n', file]);
  assert.equal(syntax.status, 0, syntax.stderr.toString());

  const res = spawnSync('bash', [file, ...(opts.args ?? ['--env', 'SIT'])], {
    input: `${opts.answer ?? ''}\n`,
    cwd: compose, // like standing in the compose folder: no registry path needed
    env: { ...process.env, ALARA_TEST_IPS: opts.ip },
  });
  const log = join(compose, 'calls.log');
  return {
    status: res.status,
    out: res.stdout.toString() + res.stderr.toString(),
    calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
  };
}

const SIT_CHATBOT_IP = '10.42.42.250';

test('script: --env is required and must match the environment it was made for', () => {
  const none = runScript({ ip: SIT_CHATBOT_IP, args: [] });
  assert.equal(none.status, 2);
  assert.match(none.out, /--env is required: this runbook is for SIT/);
  const wrong = runScript({ ip: SIT_CHATBOT_IP, args: ['--env', 'PROD'] });
  assert.equal(wrong.status, 2);
  assert.match(wrong.out, /you said --env PROD, but this runbook was made for SIT/);
  assert.deepEqual([...none.calls, ...wrong.calls], []);
  assert.equal(runScript({ ip: SIT_CHATBOT_IP, args: ['--env', 'sit', '--dry-run'] }).status, 0); // case-insensitive
});

test('script: the toolkit decides which server this is; the wrong one is refused', () => {
  const uat = runScript({ ip: '10.32.32.158' }); // a UAT ChatBot, script is for SIT
  assert.equal(uat.status, 2);
  assert.match(uat.out, /this script is for SIT \/ CHAT_BOT, but the toolkit says this server is UAT \/ CHAT_BOT/);
  const db = runScript({ ip: '10.42.42.251' }); // SIT Database, script is for the ChatBot
  assert.equal(db.status, 2);
  assert.match(db.out, /says this server is SIT \/ DATABASE/);
  const nowhere = runScript({ ip: '192.168.9.9' });
  assert.equal(nowhere.status, 2);
  assert.match(nowhere.out, /toolkit could not identify this server/);
  assert.deepEqual([...uat.calls, ...db.calls, ...nowhere.calls], []);
});

test('script: no registry entry needed; wrong account refused; old toolkit refused', () => {
  assert.equal(runScript({ ip: SIT_CHATBOT_IP, server: null, args: ['--env', 'SIT', '--dry-run'] }).status, 0);
  const acct = runScript({ ip: SIT_CHATBOT_IP, runAs: 'chatbotuat-not-me' });
  assert.equal(acct.status, 2);
  assert.match(acct.out, /run as chatbotuat-not-me/);
  const old = runScript({ ip: SIT_CHATBOT_IP, version: '2.4' });
  assert.equal(old.status, 2);
  assert.match(old.out, /v2\.4 has no 'patch' command \(needs v2\.5 or newer\)/);
  assert.deepEqual([...acct.calls, ...old.calls], []);
  assert.equal(runScript({ ip: SIT_CHATBOT_IP, version: '2.10' }).status, 0); // version sort, not string sort
});

test('script: unknown options, --yes and a bad --timeout are refused', () => {
  assert.match(runScript({ ip: SIT_CHATBOT_IP, args: ['--env', 'SIT', '--bogus'] }).out, /unknown option: --bogus/);
  assert.match(runScript({ ip: SIT_CHATBOT_IP, args: ['--env', 'SIT', '--yes'] }).out, /--yes is not supported/);
  assert.match(runScript({ ip: SIT_CHATBOT_IP, args: ['--env', 'SIT', '--timeout', 'abc'] }).out, /--timeout must be a number/);
});

test('script: missing incoming folder is refused', () => {
  const r = runScript({ ip: SIT_CHATBOT_IP, withTars: false });
  assert.equal(r.status, 2);
  assert.match(r.out, /copy the tars/);
});

test('script: --dry-run runs patch plan only and changes nothing', () => {
  const r = runScript({ ip: SIT_CHATBOT_IP, args: ['--env', 'SIT', '--dry-run'] });
  assert.equal(r.status, 0);
  assert.deepEqual(r.calls, ['patch plan PATCH-2026-09-20']);
});

test('script: applies once (the toolkit previews and confirms) and passes the exit code through', () => {
  const ok = runScript({ ip: SIT_CHATBOT_IP });
  assert.equal(ok.status, 0);
  assert.deepEqual(ok.calls, ['patch apply PATCH-2026-09-20', 'status']); // no doctor, no second plan

  const timed = runScript({ ip: SIT_CHATBOT_IP, args: ['--env', 'SIT', '--timeout', '900'] });
  assert.deepEqual(timed.calls, ['patch apply PATCH-2026-09-20 --timeout 900', 'status']);

  const rolledBack = runScript({ ip: SIT_CHATBOT_IP, applyExit: 1 });
  assert.equal(rolledBack.status, 1);
  assert.match(rolledBack.out, /rolled back automatically/);
  assert.ok(rolledBack.calls.includes('status'));
  assert.equal(runScript({ ip: SIT_CHATBOT_IP, applyExit: 2 }).status, 2);
  assert.equal(runScript({ ip: SIT_CHATBOT_IP, applyExit: 3 }).status, 3);
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
