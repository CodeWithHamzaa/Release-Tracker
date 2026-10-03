import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSnapshots } from './toolkitCompare.js';
import { buildPromotion, tarFileName, PromotionInput } from './promotionGenerator.js';
import { installFakeToolkit } from './fakeToolkit.js';
import type { RunbookServer } from './runbook.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'toolkit');
const fx = (n: string) => readFileSync(join(FX, n), 'utf8');
const me = userInfo().username;
const server = (ip: string | null, runAs: string | null = me): RunbookServer => ({
  ip, domain: null, composePath: null, runAs, access: null, envFiles: [], toolkitVersion: null,
});
const SIT_IP = '10.42.42.250'; // ChatBot SIT / UAT per the stand-in toolkit's table (lib/fakeToolkit.ts)
const UAT_IP = '10.32.32.158';

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

test('placeholders stay in the plan (filled in on the server); secrets warn; repo changes go manual', () => {
  const plan = buildPromotion(input());
  const env = Object.fromEntries(plan.envAdds.map((e) => [e.key, e]));
  assert.equal(env.DB_HOST.value, '<IP:DATABASE>');
  assert.equal(env.PUBLIC_URL.value, 'https://<DOMAIN:EVA>/chat');
  assert.equal(env.NEW_SECRET_TOKEN.status, 'secret');
  assert.equal(env.CHAT_SVC.status, 'append'); // resolved ON the server, which may or may not know it
  assert.equal(env.WORKERS.file, '.env');
  const web = plan.images.find((i) => i.container === 'web')!;
  assert.match(web.manual!, /repository changed/);
  assert.equal(plan.images.find((i) => i.container === 'api')!.manual, null);
  assert.match(plan.targetScript!, /# WARNING: 'NEW_SECRET_TOKEN' exists in source but is missing here\. Add manually\./);
});

test('no server registry is needed to build the scripts; a bad PATCH_ID blocks them', () => {
  const none = buildPromotion(input({ sourceServer: null, targetServer: null }));
  assert.ok(none.sourceScript && none.targetScript);
  assert.deepEqual(none.errors, []);
  const bad = buildPromotion(input({ patchId: '../x; rm' }));
  assert.equal(bad.sourceScript, null);
  assert.match(bad.errors[0], /PATCH_ID/);
});

test('helpers: tar names', () => {
  assert.equal(tarFileName('registry.internal:5000/team/alara-ui:9.3.1'), 'alara-ui_9.3.1.tar');
  assert.equal(tarFileName('nginx'), 'nginx_latest.tar');
});

// ── Execute the generated scripts against a stand-in toolkit ─────────────────

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'promo-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const compose = join(dir, 'compose');
  mkdirSync(compose);
  writeFileSync(join(compose, 'docker-compose.yml'), 'services: {}\n');
  return { dir, bin, compose };
}

// Scripts run from the compose folder (no registry path), like an engineer
// standing in it. The machine's IP is simulated with ALARA_TEST_IPS.
function run(script: string, box: { dir: string; bin: string; compose: string }, ip: string, args: string[], answer = '') {
  const file = join(box.dir, 'run.sh');
  writeFileSync(file, script);
  assert.equal(spawnSync('bash', ['-n', file]).status, 0);
  const res = spawnSync('bash', [file, ...args], {
    input: `${answer}\n`,
    cwd: box.compose,
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, ALARA_TEST_IPS: ip },
  });
  return { status: res.status, out: res.stdout.toString() + res.stderr.toString() };
}

function targetBox(applyExit = 0) {
  const box = sandbox();
  installFakeToolkit(box.compose, { applyExit });
  writeFileSync(join(box.compose, '.env_fbl'), 'KEEP=1\nQUOTED=already-here'); // no trailing newline
  writeFileSync(join(box.compose, '.env'), 'OTHER=1\n');
  mkdirSync(join(box.compose, 'alara/patches/incoming/PROMO-T1'), { recursive: true });
  return box;
}
const calls = (box: { compose: string }) =>
  existsSync(join(box.compose, 'calls.log')) ? readFileSync(join(box.compose, 'calls.log'), 'utf8').trim().split('\n') : [];
const UNTOUCHED = 'KEEP=1\nQUOTED=already-here';
const UAT = ['--env', 'UAT'];

test('target script: --env is required and must match; the toolkit must agree it is the UAT ChatBot', () => {
  const box = targetBox();
  const plan = buildPromotion(input());
  assert.match(run(plan.targetScript!, box, UAT_IP, []).out, /--env is required: this script is for UAT/);
  assert.match(run(plan.targetScript!, box, UAT_IP, ['--env', 'PROD']).out, /you said --env PROD, but this script was made for UAT/);
  const sit = run(plan.targetScript!, box, SIT_IP, UAT, 'apply'); // the SIT server, script is for UAT
  assert.equal(sit.status, 2);
  assert.match(sit.out, /this script is for UAT \/ CHAT_BOT, but the toolkit says this server is SIT \/ CHAT_BOT/);
  const db = run(plan.targetScript!, box, '10.42.42.79', UAT, 'apply'); // the UAT Database
  assert.match(db.out, /says this server is UAT \/ DATABASE/);
  assert.deepEqual(calls(box), []);
  assert.equal(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), UNTOUCHED);
});

test('target script: --dry-run shows the plan, previews env edits and the patch, changes nothing', () => {
  const box = targetBox();
  const r = run(buildPromotion(input()).targetScript!, box, UAT_IP, [...UAT, '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(calls(box), ['patch plan PROMO-T1']);
  assert.match(r.out, /would add DB_HOST=10\.42\.42\.79 to \.env_fbl/);
  assert.match(r.out, /would add PUBLIC_URL=https:\/\/evauat\.faysalbank\.com\/chat to \.env_fbl/);
  assert.match(r.out, /DRY RUN: nothing was changed/);
  assert.equal(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), UNTOUCHED);
  assert.equal(existsSync(join(box.compose, 'alara/backups')), false);
});

test('target script: one preview, one confirmation; anything but "apply" stops before any change', () => {
  const box = targetBox();
  const r = run(buildPromotion(input()).targetScript!, box, UAT_IP, UAT, 'no');
  assert.equal(r.status, 0);
  assert.deepEqual(calls(box), ['patch plan PROMO-T1']); // no doctor
  assert.match(r.out, /Stopped before any change/);
  assert.equal(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), UNTOUCHED);
});

test('target script: backs up, fills placeholders from the toolkit, appends once, applies via patch, passes exit code', () => {
  const box = targetBox(1);
  const r = run(buildPromotion(input()).targetScript!, box, UAT_IP, UAT, 'apply');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /rolled back to the old images/);
  assert.deepEqual(calls(box), ['patch plan PROMO-T1', 'patch apply PROMO-T1', 'status']);
  assert.equal(
    readFileSync(join(box.compose, '.env_fbl'), 'utf8'),
    // CHAT_SVC uses <IP:CHAT_SERVICE>, which this toolkit table does not know: not added, reported
    'KEEP=1\nQUOTED=already-here\nDB_HOST=10.42.42.79\nPUBLIC_URL=https://evauat.faysalbank.com/chat\n'
  );
  assert.equal(readFileSync(join(box.compose, '.env'), 'utf8'), 'OTHER=1\nWORKERS=4\n');
  const backups = readdirSync(join(box.compose, 'alara/backups'));
  assert.equal(backups.filter((b) => b.endsWith('_.env_fbl')).length, 1);
  assert.equal(backups.filter((b) => b.endsWith('_.env')).length, 1);
  assert.match(r.out, /skip   QUOTED: already in \.env_fbl/);
  assert.match(r.out, /WARNING: 'NEW_SECRET_TOKEN'/);
  assert.match(r.out, /MANUAL: 'CHAT_SVC' not added: the toolkit has no address for a placeholder/);
});

test('target script: images only: no tracker prompt, patch apply asks for confirmation itself; --timeout is passed', () => {
  const srcNoEnv = SRC.replace(/## ENV:\.env_fbl[\s\S]*$/, '## ENV:.env_fbl\nKEEP=1\n## ENV:.env\nOTHER=1\n');
  const plan = buildPromotion(input({ compare: compareSnapshots(srcNoEnv, TGT) }));
  assert.equal(plan.envAdds.length, 0);
  const box = targetBox();
  const r = run(plan.targetScript!, box, UAT_IP, [...UAT, '--timeout', '900']); // no answer given
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(calls(box), ['patch apply PROMO-T1 --timeout 900', 'status']);
  const dry = targetBox();
  run(plan.targetScript!, dry, UAT_IP, [...UAT, '--dry-run']);
  assert.deepEqual(calls(dry), ['patch plan PROMO-T1']);
});

test('target script: env-only promotion ends with a restart; quoting survives', () => {
  const tgtNoImageDiff = TGT.replace('api=registry.local/api:2.4', 'api=registry.local/api:2.5').replace('web=registry.local/web:3.0', 'web=registry.local/web-new:3.0');
  const box = targetBox();
  writeFileSync(join(box.compose, '.env_fbl'), 'KEEP=1\n');
  const plan = buildPromotion(input({ compare: compareSnapshots(SRC, tgtNoImageDiff) }));
  assert.equal(plan.images.length, 0);
  const r = run(plan.targetScript!, box, UAT_IP, UAT, 'apply');
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(calls(box), ['restart', 'status']);
  assert.match(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), /^QUOTED=it's "x" \$HOME$/m);
});

test('PROD target: the env confirmation needs the word PROD, not "apply"', () => {
  const prodTgt = TGT.replace('# environment: UAT', '# environment: PROD');
  const plan = buildPromotion(input({ compare: compareSnapshots(SRC, prodTgt) }));
  const box = targetBox();
  const prodIp = '10.0.11.72';
  assert.match(plan.targetScript!, /Type 'PROD' to add these env keys/);
  const wrong = run(plan.targetScript!, box, prodIp, ['--env', 'PROD'], 'apply');
  assert.match(wrong.out, /Stopped before any change/);
  assert.equal(readFileSync(join(box.compose, '.env_fbl'), 'utf8'), UNTOUCHED);
  run(plan.targetScript!, box, prodIp, ['--env', 'PROD'], 'PROD');
  // placeholders resolve to the PROD addresses of the toolkit's own table
  const env = readFileSync(join(box.compose, '.env_fbl'), 'utf8');
  assert.match(env, /DB_HOST=10\.0\.8\.57\n/);
  assert.match(env, /PUBLIC_URL=https:\/\/eva\.faysalbank\.com\/chat\n/);
});

test('source script: needs --env SIT and the SIT ChatBot; saves each image and writes SHA256SUMS; --dry-run writes nothing', () => {
  const plan = buildPromotion(input());
  const wrong = sandbox();
  installFakeToolkit(wrong.compose);
  assert.equal(run(plan.sourceScript!, wrong, UAT_IP, ['--env', 'SIT']).status, 2); // the UAT server
  assert.match(run(plan.sourceScript!, wrong, SIT_IP, ['--env', 'UAT']).out, /made for SIT/);

  const box = sandbox();
  installFakeToolkit(box.compose, { version: '2.4' }); // no patch command needed to export
  writeFileSync(
    join(box.bin, 'docker'),
    `#!/bin/sh\nif [ "$1 $2" = "image inspect" ]; then exit 0; fi\nif [ "$1" = "save" ]; then echo "tar of $4" > "$3"; exit 0; fi\nexit 1\n`
  );
  chmodSync(join(box.bin, 'docker'), 0o755);
  const dry = run(plan.sourceScript!, box, SIT_IP, ['--env', 'SIT', '--dry-run']);
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /would save registry\.local\/api:2\.5 -> alara\/patches\/export\/PROMO-T1\/api_2\.5\.tar/);
  assert.equal(existsSync(join(box.compose, 'alara/patches/export')), false);
  const r = run(plan.sourceScript!, box, SIT_IP, ['--env', 'SIT']);
  assert.equal(r.status, 0, r.out);
  const out = join(box.compose, 'alara/patches/export/PROMO-T1');
  assert.deepEqual(readdirSync(out).sort(), ['SHA256SUMS', 'api_2.5.tar', 'web-new_3.0.tar']);
  assert.match(readFileSync(join(out, 'SHA256SUMS'), 'utf8'), /^[0-9a-f]{64}  api_2\.5\.tar$/m);
  assert.match(r.out, /Copy the whole folder alara\/patches\/export\/PROMO-T1 to the UAT server/);
});
