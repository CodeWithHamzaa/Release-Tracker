import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSnapshots } from './toolkitCompare.js';
import { buildPromotion, resolvePlaceholders, targetTokensFrom, tarFileName, PromotionInput } from './promotionGenerator.js';
import type { RunbookServer } from './runbook.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toolkit');
const fx = (n: string) => readFileSync(join(FX, n), 'utf8');
const me = userInfo().username;
const server = (ip: string | null, runAs: string | null = me): RunbookServer => ({
  ip, domain: null, composePath: null, runAs, access: null, envFiles: [], toolkitVersion: null,
});
const UAT_TOKENS = { ips: { DATABASE: '10.42.42.79', CHAT_BOT: '10.32.32.158' }, domain: 'evauat.faysalbank.com' };

// A hand-made pair covering placeholders, secrets, quoting and a repo change.
const SRC = `# ALARA_RELEASE_SNAPSHOT
# role: CHAT_BOT
# environment: SIT
## IMAGES
api=registry.local/api:2.5|Up 1 hour
web=registry.local/web-new:3.0|Up 1 hour
## ENV:.env_fbl
DB_HOST=<IP:DATABASE>
PUBLIC_URL=https://<DOMAIN:EVA>/chat
NEW_SECRET_TOKEN=SHA256:0123abcd
CHAT_SVC=http://<IP:CHAT_SERVICE>:9000
QUOTED=it's "x" $HOME
## ENV:.env
WORKERS=4
`;
const TGT = `# ALARA_RELEASE_SNAPSHOT
# role: CHAT_BOT
# environment: UAT
## IMAGES
api=registry.local/api:2.4|Up 3 days
web=registry.local/web:3.0|Up 3 days
## ENV:.env_fbl
KEEP=1
## ENV:.env
OTHER=1
`;

const input = (over: Partial<PromotionInput> = {}): PromotionInput => ({
  compare: compareSnapshots(SRC, TGT),
  role: 'ChatBot / NLU',
  patchId: 'PROMO-T1',
  sourceServer: server('10.42.42.250'),
  targetServer: server('10.32.32.158'),
  targetTokens: UAT_TOKENS,
  generatedAt: new Date('2026-10-02T00:00:00Z'),
  ...over,
});

test('classifies the real-script checklist (chatbot SIT -> UAT fixture)', () => {
  const plan = buildPromotion(input({ compare: compareSnapshots(fx('chatbot_sit.snapshot'), fx('chatbot_uat.snapshot')) }));
  assert.deepEqual(
    plan.images.map((i) => [i.kind, i.container, i.file, !!i.manual]),
    [
      ['update', 'memento', 'memento_v1.1.8.tar', false],
      ['update', 'retriever_api_service', 'retriever_api_service_8bd276a2.tar', false],
      ['deploy', 'litellm-db', 'postgres_16-alpine.tar', true],
      ['deploy', 'litellm-service', 'litellm-service-proxy-image_v1.74.0-stable-patched.tar', true],
    ]
  );
  assert.deepEqual(plan.envAdds.map((e) => [e.key, e.status]), [['DUP_KEY', 'multiline'], ['ONLY_SIT_FLAG', 'append']]);
  // REVIEW x2, VERIFY x2, REVIEW TIMEOUT, EXPECTED: all kept for manual review
  assert.equal(plan.manual.length, 6);
  assert.ok(plan.manual.every((m) => /^(CRITICAL|EXPECTED|INFO) /.test(m)));
  assert.deepEqual(plan.errors, []);
});

test('placeholders resolve to the target; secrets warn; unresolved and repo changes go manual', () => {
  const plan = buildPromotion(input());
  const env = Object.fromEntries(plan.envAdds.map((e) => [e.key, e]));
  assert.equal(env.DB_HOST.value, '10.42.42.79');
  assert.equal(env.PUBLIC_URL.value, 'https://evauat.faysalbank.com/chat');
  assert.equal(env.NEW_SECRET_TOKEN.status, 'secret');
  assert.equal(env.CHAT_SVC.status, 'unresolved'); // no CHAT_SERVICE IP in the tokens
  assert.equal(env.WORKERS.file, '.env');
  const web = plan.images.find((i) => i.container === 'web')!;
  assert.match(web.manual!, /repository changed/);
  assert.equal(plan.images.find((i) => i.container === 'api')!.manual, null);
  assert.match(plan.targetScript!, /# WARNING: 'NEW_SECRET_TOKEN' exists in source but is missing here\. Add manually\./);
});

test('missing registry IP or bad PATCH_ID blocks the scripts with a reason', () => {
  const noIp = buildPromotion(input({ targetServer: server(null) }));
  assert.ok(noIp.sourceScript);
  assert.equal(noIp.targetScript, null);
  assert.match(noIp.errors[0], /Target script needs the UAT \/ ChatBot \/ NLU IP/);
  const bad = buildPromotion(input({ patchId: '../x; rm' }));
  assert.equal(bad.sourceScript, null);
  assert.match(bad.errors[0], /PATCH_ID/);
});

test('helpers: tokens from registry, placeholder resolution, tar names', () => {
  const t = targetTokensFrom(
    [
      { environment: 'UAT', role: 'Database', ip: '10.42.42.79', domain: 'evauat.faysalbank.com' },
      { environment: 'SIT', role: 'Database', ip: '10.42.42.251', domain: 'evasit.faysalbank.com' },
    ],
    'UAT'
  );
  assert.deepEqual(t, { ips: { DATABASE: '10.42.42.79' }, domain: 'evauat.faysalbank.com' });
  assert.equal(resolvePlaceholders('mongodb://<IP:DATABASE>:27017', t), 'mongodb://10.42.42.79:27017');
  assert.equal(resolvePlaceholders('<IP:CHAT_BOT>', t), null);
  assert.equal(tarFileName('registry.internal:5000/team/alara-ui:9.3.1'), 'alara-ui_9.3.1.tar');
  assert.equal(tarFileName('nginx'), 'nginx_latest.tar');
});

// ── Execute the generated scripts with stubbed tools ─────────────────────────

function sandbox(hostIp: string) {
  const dir = mkdtempSync(join(tmpdir(), 'promo-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'hostname'), `#!/bin/sh\necho "${hostIp} 172.17.0.1"\n`);
  chmodSync(join(bin, 'hostname'), 0o755);
  const compose = join(dir, 'compose');
  mkdirSync(compose);
  writeFileSync(join(compose, 'docker-compose.yml'), 'services: {}\n');
  return { dir, bin, compose };
}

function run(script: string, box: { dir: string; bin: string; compose: string }, answer: string) {
  const file = join(box.dir, 'run.sh');
  writeFileSync(file, script.replace("COMPOSE_DIR=''", `COMPOSE_DIR='${box.compose}'`));
  assert.equal(spawnSync('bash', ['-n', file]).status, 0);
  const res = spawnSync('bash', [file], { input: `${answer}\n`, env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}` } });
  return { status: res.status, out: res.stdout.toString() + res.stderr.toString() };
}

function targetBox(hostIp: string, applyExit = 0) {
  const box = sandbox(hostIp);
  writeFileSync(
    join(box.compose, 'alara_server.sh'),
    `#!/bin/sh\necho "$*" >> calls.log\n[ "$1 $2" = "patch apply" ] && exit ${applyExit}\nexit 0\n`
  );
  chmodSync(join(box.compose, 'alara_server.sh'), 0o755);
  writeFileSync(join(box.compose, '.env_fbl'), 'KEEP=1\nQUOTED=already-here'); // no trailing newline
  writeFileSync(join(box.compose, '.env'), 'OTHER=1\n');
  mkdirSync(join(box.compose, 'alara/patches/incoming/PROMO-T1'), { recursive: true });
  return box;
}
const calls = (box: { compose: string }) =>
  existsSync(join(box.compose, 'calls.log')) ? readFileSync(join(box.compose, 'calls.log'), 'utf8').trim().split('\n') : [];

test('target script: wrong server is refused before any change', () => {
  const box = targetBox('10.0.11.72');
  const r = run(buildPromotion(input()).targetScript!, box, 'apply');
  assert.equal(r.status, 2);
  assert.match(r.out, /this script is for 10\.32\.32\.158/);
  assert.deepEqual(calls(box), []);
  assert.equal(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), 'KEEP=1\nQUOTED=already-here');
});

test('target script: anything but "apply" stops after the preview', () => {
  const box = targetBox('10.32.32.158');
  const r = run(buildPromotion(input()).targetScript!, box, 'no');
  assert.equal(r.status, 0);
  assert.deepEqual(calls(box), ['patch plan PROMO-T1']);
  assert.equal(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), 'KEEP=1\nQUOTED=already-here');
});

test('target script: backs up, appends resolved keys once, applies via patch, passes exit code', () => {
  const box = targetBox('10.32.32.158', 1);
  const r = run(buildPromotion(input()).targetScript!, box, 'apply');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /rolled back to the old images/);
  assert.deepEqual(calls(box), ['patch plan PROMO-T1', 'patch apply PROMO-T1', 'status']);
  assert.equal(
    readFileSync(join(box.compose, '.env_fbl'), 'utf8'),
    'KEEP=1\nQUOTED=already-here\nDB_HOST=10.42.42.79\nPUBLIC_URL=https://evauat.faysalbank.com/chat\n'
  );
  assert.equal(readFileSync(join(box.compose, '.env'), 'utf8'), 'OTHER=1\nWORKERS=4\n');
  const backups = readdirSync(join(box.compose, 'alara/backups'));
  assert.equal(backups.filter((b) => b.endsWith('_.env_fbl')).length, 1);
  assert.equal(backups.filter((b) => b.endsWith('_.env')).length, 1);
  assert.match(r.out, /skip   QUOTED: already in \.env_fbl/);
  assert.match(r.out, /WARNING: 'NEW_SECRET_TOKEN'/);
  assert.match(r.out, /MANUAL: 'CHAT_SVC' not added/);
});

test('target script: env-only promotion ends with a restart; quoting survives', () => {
  const tgtNoImageDiff = TGT.replace('api=registry.local/api:2.4', 'api=registry.local/api:2.5').replace('web=registry.local/web:3.0', 'web=registry.local/web-new:3.0');
  const box = targetBox('10.32.32.158');
  writeFileSync(join(box.compose, '.env_fbl'), 'KEEP=1\n');
  const plan = buildPromotion(input({ compare: compareSnapshots(SRC, tgtNoImageDiff) }));
  assert.equal(plan.images.length, 0);
  const r = run(plan.targetScript!, box, 'apply');
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(calls(box), ['restart', 'status']);
  assert.match(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), /^QUOTED=it's "x" \$HOME$/m);
});

test('source script: refuses the wrong server, saves each image and writes SHA256SUMS', () => {
  const plan = buildPromotion(input());
  const wrong = sandbox('10.32.32.158');
  writeFileSync(join(wrong.compose, 'alara_server.sh'), '#!/bin/sh\n');
  chmodSync(join(wrong.compose, 'alara_server.sh'), 0o755);
  assert.equal(run(plan.sourceScript!, wrong, '').status, 2);

  const box = sandbox('10.42.42.250');
  writeFileSync(join(box.compose, 'alara_server.sh'), '#!/bin/sh\n');
  chmodSync(join(box.compose, 'alara_server.sh'), 0o755);
  writeFileSync(
    join(box.bin, 'docker'),
    `#!/bin/sh\nif [ "$1 $2" = "image inspect" ]; then exit 0; fi\nif [ "$1" = "save" ]; then echo "tar of $4" > "$3"; exit 0; fi\nexit 1\n`
  );
  chmodSync(join(box.bin, 'docker'), 0o755);
  const r = run(plan.sourceScript!, box, '');
  assert.equal(r.status, 0, r.out);
  const out = join(box.compose, 'alara/patches/export/PROMO-T1');
  assert.deepEqual(readdirSync(out).sort(), ['SHA256SUMS', 'api_2.5.tar', 'web-new_3.0.tar']);
  assert.match(readFileSync(join(out, 'SHA256SUMS'), 'utf8'), /^[0-9a-f]{64}  api_2\.5\.tar$/m);
  assert.match(r.out, /Copy the whole folder alara\/patches\/export\/PROMO-T1 to the UAT server/);
});
