import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectKind, parseDoctor, parseSnapshot, parseStatus, parseToolkitOutput, stripAnsi } from './toolkitParse.js';
import { compareSnapshots, parseIgnoreKeys, scriptImageRepo } from './toolkitCompare.js';

// Fixtures were produced by running the real ALARA scripts (alara_server.sh
// v2.6, alara_release_snapshot.sh v2.0, alara_release_compare.sh v2.1) on
// simulated servers with fake data. The scripts themselves are not in the repo.
const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toolkit');
const fx = (name: string) => readFileSync(join(FX, name), 'utf8');

test('detectKind recognises all three outputs, with or without ANSI colours', () => {
  assert.equal(detectKind(fx('chatbot_sit.snapshot')), 'snapshot');
  assert.equal(detectKind(fx('chatbot_sit.status.ansi.txt')), 'status');
  assert.equal(detectKind(fx('chatbot_sit.status.txt')), 'status');
  assert.equal(detectKind(fx('chatbot_uat.doctor.ansi.txt')), 'doctor');
  assert.equal(detectKind('hello world'), null);
  assert.throws(() => parseToolkitOutput('random text'), /Not recognised/);
});

test('parseSnapshot: header, containers with state/health, env files with hashed secrets', () => {
  const s = parseSnapshot(fx('chatbot_sit.snapshot'));
  assert.equal(s.roleCode, 'CHAT_BOT');
  assert.equal(s.role, 'ChatBot / NLU');
  assert.equal(s.environment, 'SIT');
  assert.equal(s.hostname, 'alara-chatbot_sit');
  assert.equal(s.scriptVersion, '2.0');
  assert.ok(s.generated && !Number.isNaN(Date.parse(s.generated)));
  const c = Object.fromEntries(s.containers.map((x) => [x.name, x]));
  assert.equal(c.retriever_api_service.image, 'registry.local/retriever_api_service:8bd276a2');
  assert.deepEqual([c.retriever_api_service.state, c.retriever_api_service.health], ['running', 'healthy']);
  assert.deepEqual([c['sent-lang'].state, c['sent-lang'].health], ['running', 'unhealthy']);
  assert.deepEqual([c['common-service'].state, c['common-service'].health], ['running', 'starting']);
  assert.equal(c['litellm-service'].state, 'restarting');
  assert.equal(c['litellm-db'].state, 'exited');
  const fbl = s.envFiles.find((f) => f.file === '.env_fbl')!;
  const e = Object.fromEntries(fbl.entries.map((x) => [x.key, x]));
  assert.equal(e.DB_HOST.value, '<IP:DATABASE>');
  assert.equal(e.AZURE_OPENAI_API_KEY.sensitive, true);
  assert.match(e.AZURE_OPENAI_API_KEY.value, /^SHA256:[0-9a-f]{64}$/);
  assert.equal(fbl.entries.filter((x) => x.key === 'DUP_KEY').length, 2);
  assert.deepEqual(s.envFiles.map((f) => f.file), ['.env_fbl', '.env']);
});

test('parseSnapshot refuses garbage and DATABASE snapshots', () => {
  assert.throws(() => parseSnapshot('nope'), /Not an ALARA release snapshot/);
  assert.throws(() => parseSnapshot('# ALARA_RELEASE_SNAPSHOT\n# role: DATABASE\n# environment: SIT\n'), /out of scope/);
  assert.throws(() => parseSnapshot('# ALARA_RELEASE_SNAPSHOT\n# role: CHAT_BOT\n# environment: DEV\n'), /Unknown environment/);
});

for (const variant of ['status.txt', 'status.ansi.txt']) {
  test(`parseStatus (${variant}): header, encryption, key, containers incl. overflowing columns`, () => {
    const s = parseStatus(fx(`chatbot_sit.${variant}`));
    assert.equal(s.role, 'ChatBot / NLU');
    assert.equal(s.environment, 'SIT');
    assert.equal(s.ip, '10.42.42.250');
    assert.equal(s.configPoints, 'SIT');
    assert.equal(s.workdir, '/srv/alara/chatbot_sit');
    assert.deepEqual(s.envFiles, [
      { file: '.env_fbl', state: 'plain', encryptedValues: null },
      { file: '.env', state: 'plain', encryptedValues: null },
    ]);
    assert.equal(s.masterKey, 'present');
    assert.match(s.keyState!, /^fingerprint [0-9a-f]{16} — expected fingerprint not set/);
    const c = Object.fromEntries(s.containers.map((x) => [x.name, x]));
    assert.deepEqual(Object.keys(c).sort(), ['common-service', 'litellm-db', 'litellm-service', 'memento', 'retriever_api_service', 'sent-lang']);
    // SERVICE overflowed its 20-char column here
    assert.equal(c.retriever_api_service.service, 'retriever_api_service');
    assert.equal(c.retriever_api_service.image, 'registry.local/retriever_api_service:8bd276a2');
    assert.equal(c.retriever_api_service.status, 'Up 3 hours (healthy)');
    assert.equal(c.retriever_api_service.ports, '0.0.0.0:8000->8000/tcp');
    // IMAGE overflowed its 42-char column, no ports
    assert.equal(c['litellm-service'].image, 'registry.local/platform/team-ai/litellm-service-proxy-image:v1.74.0-stable-patched');
    assert.equal(c['litellm-service'].status, 'Restarting (1) 12 seconds ago');
    assert.equal(c['litellm-service'].ports, null);
    assert.equal(c['litellm-service'].state, 'restarting');
    assert.equal(c['common-service'].status, 'Up 2 minutes (health: starting)');
    assert.equal(c['common-service'].health, 'starting');
    assert.equal(c['sent-lang'].ports, '0.0.0.0:8200->8200/tcp, :::8200->8200/tcp');
    assert.equal(c['sent-lang'].health, 'unhealthy');
    assert.deepEqual([c['litellm-db'].state, c['litellm-db'].status, c['litellm-db'].ports], ['exited', 'Exited (137) 2 hours ago', null]);
  });
}

test('parseStatus: empty compose service label shows as null', () => {
  const s = parseStatus(fx('chatbot_uat.status.txt'));
  const debug = s.containers.find((c) => c.name === 'debug-shell')!;
  assert.equal(debug.service, null);
  assert.equal(debug.image, 'busybox:1.36');
  assert.equal(s.environment, 'UAT');
});

test('parseStatus: encrypted env files, missing master key, PROD', () => {
  const s = parseStatus(fx('chatbot_prod.status.txt'));
  assert.equal(s.environment, 'Prod');
  assert.equal(s.configPoints, 'PROD');
  assert.deepEqual(s.envFiles, [
    { file: '.env_fbl', state: 'encrypted', encryptedValues: 2 },
    { file: '.env', state: 'encrypted', encryptedValues: 1 },
  ]);
  assert.equal(s.masterKey, 'missing');
  assert.equal(s.keyState, null);
});

test('parseDoctor: version, checks, failed preflight', () => {
  const ok = parseDoctor(fx('bb_sit.doctor.ansi.txt'));
  assert.equal(ok.serverVersion, '2.6');
  assert.equal(ok.role, 'Bot-Builder');
  assert.equal(ok.environment, 'SIT');
  assert.equal(ok.runningAs, 'root');
  assert.ok(ok.checks.some((c) => c.status === 'ok' && c.item === 'alara_patch.sh'));
  assert.equal(ok.passed, true);

  const bad = parseDoctor(fx('chatbot_uat.doctor.txt'));
  assert.equal(bad.passed, false);
  assert.deepEqual(
    bad.checks.filter((c) => c.status === 'MISS').map((c) => c.item),
    ['alara_key.sh', 'alara_env_encrypt.sh', 'alara_start.sh', 'alara_env_generate.sh', 'alara_patch.sh']
  );
  assert.equal(bad.environment, 'UAT');
  assert.match(bad.keyState!, /^fingerprint /);

  const prod = parseDoctor(fx('bb_prod.doctor.txt'));
  assert.equal(prod.environment, 'Prod');
});

// Parse the real script's printed checklist into its three lists.
function goldenLists(text: string) {
  const lines = stripAnsi(text).split('\n');
  const take = (title: string): string[] => {
    const start = lines.findIndex((l) => l.startsWith(title));
    if (start === -1) return [];
    const items: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) break;
      const m = /^ {2}\d+\. (.*)$/.exec(l);
      if (m) items.push(m[1]);
      else items[items.length - 1] += `\n${l}`; // value that spans lines
    }
    return items;
  };
  return {
    critical: take('CRITICAL - action required before release'),
    expected: take('EXPECTED - routinely per-environment, verify only'),
    notes: take('INFO - non-blocking'),
    exit: Number(/exit=(\d+)/.exec(text)?.[1]),
  };
}

const goldenCases: [string, string, string, string?][] = [
  ['compare_chatbot_sit_uat.txt', 'chatbot_sit.snapshot', 'chatbot_uat.snapshot'],
  ['compare_chatbot_sit_uat_ignore.txt', 'chatbot_sit.snapshot', 'chatbot_uat.snapshot', 'ignore_keys.txt'],
  ['compare_bb_sit_prod.txt', 'bb_sit.snapshot', 'bb_prod.snapshot'],
  ['compare_bb_prod_sit.txt', 'bb_prod.snapshot', 'bb_sit.snapshot'],
];

for (const [golden, a, b, ignore] of goldenCases) {
  test(`compareSnapshots matches alara_release_compare.sh v2.1 item for item: ${golden}`, () => {
    const expected = goldenLists(fx(golden));
    const got = compareSnapshots(fx(a), fx(b), ignore ? parseIgnoreKeys(fx(ignore)) : []);
    assert.deepEqual(got.critical, expected.critical);
    assert.deepEqual(got.expected, expected.expected);
    assert.deepEqual(got.notes, expected.notes);
    assert.equal(got.critical.length > 0 ? 1 : 0, expected.exit, 'exit code');
  });
}

test('compareSnapshots refuses different roles; warns on same environment', () => {
  assert.throws(() => compareSnapshots(fx('chatbot_sit.snapshot'), fx('bb_sit.snapshot')), /Role mismatch/);
  const same = compareSnapshots(fx('chatbot_sit.snapshot'), fx('chatbot_sit.snapshot'));
  assert.equal(same.critical.length, 1); // only the duplicate-key CLEANUP
  assert.match(same.critical[0], /CLEANUP DUP_KEY/);
  assert.match(same.warnings[0], /same environment/);
});

test('scriptImageRepo keeps a registry port, drops tag and digest', () => {
  assert.equal(scriptImageRepo('registry.internal:5000/alara-ui:9.3.1'), 'registry.internal:5000/alara-ui');
  assert.equal(scriptImageRepo('registry.internal:5000/alara-ui'), 'registry.internal:5000/alara-ui');
  assert.equal(scriptImageRepo('alara-ui@sha256:abcd'), 'alara-ui');
});
