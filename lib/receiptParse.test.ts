import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeReceipt, parseReceipt, receiptVerdict, RECEIPT_MAX_BYTES } from './receiptParse.js';

// Receipts written by the generated scripts while running against the REAL
// alara_patch.sh v1.0 / alara_start.sh v2.0 / alara_common.sh v2.4 (with a fake
// docker). Paths scrubbed. lib/fixtures/receipts/.
const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'receipts');
const fx = (n: string) => readFileSync(join(FX, n), 'utf8');
const json = (n: string) => JSON.parse(fx(n));

test('a successful patch: success, the changed image, the containers after, the tar checksum', () => {
  const r = parseReceipt(fx('success.json'));
  assert.equal(r.kind, 'receipt');
  assert.equal(r.verdict, 'success');
  assert.equal(r.result, 'SUCCESS');
  assert.equal(r.outcome, 'recorded');
  assert.deepEqual([r.environment, r.role, r.roleCode, r.script, r.patchId], ['SIT', 'ChatBot / NLU', 'CHAT_BOT', 'runbook', 'PATCH-E2E']);
  assert.match(r.recordId!, /^\d{8}_\d{6}_PATCH-E2E$/);
  assert.deepEqual(r.images.map((i) => [i.service, i.oldRef, i.newRef]), [['memento', 'memento:v1.1.8', 'memento:v1.1.9']]);
  assert.match(r.images[0].oldId!, /^sha256:/);
  assert.equal(r.tars.length, 1);
  assert.match(r.tars[0].file, /memento_v1\.1\.9\.tar$/);
  assert.deepEqual(r.containers.map((c) => [c.service, c.image, c.state]), [['memento', 'memento:v1.1.9', 'running'], ['retriever', 'retriever:v2.0.1', 'running']]);
  assert.match(r.composeDiff!, /\+\s+image: memento:v1\.1\.9/);
  assert.equal(r.exitCode, 0);
  assert.equal(r.scriptSha256!.length, 64);
});

test('a health-gate failure rolled back automatically is FAILED', () => {
  const r = parseReceipt(fx('rolled_back.json'));
  assert.equal(r.result, 'ROLLED_BACK');
  assert.equal(r.verdict, 'failed');
  assert.match(r.reason, /rolled back automatically/);
  assert.equal(r.exitCode, 1);
});

test('the LAST RESULT line wins: a success rolled back by hand later is FAILED', () => {
  const raw = json('rolled_back_manual.json');
  assert.match(raw.files.RESULT, /RESULT=SUCCESS[\s\S]*RESULT=ROLLED_BACK_MANUAL/);
  const r = parseReceipt(fx('rolled_back_manual.json'));
  assert.equal(r.result, 'ROLLED_BACK_MANUAL');
  assert.equal(r.verdict, 'failed');
});

test('nothing applicable and refused leave the records PENDING', () => {
  const none = parseReceipt(fx('nothing_applicable.json'));
  assert.deepEqual([none.outcome, none.verdict, none.recordId, none.exitCode], ['nothing-applicable', 'pending', null, 0]);
  const refused = parseReceipt(fx('refused.json'));
  assert.deepEqual([refused.outcome, refused.verdict, refused.exitCode], ['refused', 'pending', 2]);
  assert.match(refused.reason, /refused or not confirmed/);
});

test('a promotion receipt lists the env keys the script appended', () => {
  const r = parseReceipt(fx('promotion_applied.json'));
  assert.equal(r.script, 'promotion-target');
  assert.deepEqual([r.environment, r.verdict], ['UAT', 'success']);
  assert.deepEqual(r.envAdded, ['.env:WORKERS', '.env_fbl:DB_HOST', '.env_fbl:PUBLIC_URL']);
  const envOnly = parseReceipt(fx('promotion_env_only.json'));
  assert.deepEqual([envOnly.outcome, envOnly.verdict, envOnly.images.length], ['env-restarted', 'pending', 0]);
  assert.equal(envOnly.envAdded.length, 3);
});

test('the status comes from the toolkit RESULT, never from a claim in the file', () => {
  const raw = json('success.json');
  raw.exitCode = 1; // script exited non-zero although the record says SUCCESS
  assert.equal(parseReceipt(JSON.stringify(raw)).verdict, 'pending');
  const noResult = json('success.json');
  noResult.files.RESULT = 'PATCH_ID=X\n';
  const r = parseReceipt(JSON.stringify(noResult));
  assert.equal(r.verdict, 'failed');
  assert.match(r.reason, /ended as|no result/i);
  assert.equal(receiptVerdict({ outcome: 'failed', result: null, exitCode: 3 }).verdict, 'failed');
});

test('looksLikeReceipt tells receipts from snapshots, status text and other JSON', () => {
  assert.equal(looksLikeReceipt(fx('success.json')), true);
  assert.equal(looksLikeReceipt('# ALARA_RELEASE_SNAPSHOT\n'), false);
  assert.equal(looksLikeReceipt('{"hello":"world"}'), false);
  assert.equal(looksLikeReceipt('  \n{"format":"alara-receipt/1"}'), true);
});

test('invalid receipts are rejected with a plain reason, never thrown as junk', () => {
  const bad = (mutate: (r: any) => void, re: RegExp) => {
    const r = json('success.json');
    mutate(r);
    assert.throws(() => parseReceipt(JSON.stringify(r)), re);
  };
  assert.throws(() => parseReceipt('not json'), /not valid JSON/);
  assert.throws(() => parseReceipt('[1,2]'), /not a JSON object/);
  bad((r) => (r.format = 'alara-receipt/2'), /unsupported format/);
  bad((r) => delete r.format, /format field is missing/);
  bad((r) => (r.patchId = '../etc; rm'), /PATCH_ID/);
  bad((r) => (r.environment = 'DEV'), /SIT, UAT or PROD/);
  bad((r) => (r.role = 'ROOT'), /known ALARA role/);
  bad((r) => (r.exitCode = '0'), /exit code/);
  bad((r) => (r.exitCode = 999), /exit code/);
  bad((r) => (r.outcome = 'great'), /unknown outcome/);
  bad((r) => (r.finishedAt = 'yesterday'), /finish time/);
  bad((r) => (r.recordId = '../../x'), /record id/);
  bad((r) => (r.files.RESULT = 42), /files\.RESULT must be text/);
  bad((r) => (r.files.RESULT = null), /RESULT is missing/);
  bad((r) => (r.files['compose.diff'] = 'x'.repeat(300_000)), /too large/);
  assert.throws(() => parseReceipt('{"format":"alara-receipt/1","pad":"' + 'x'.repeat(RECEIPT_MAX_BYTES) + '"}'), /larger than 1 MB/);
});

test('hostile content is carried as data: odd env entries are dropped, nothing is evaluated', () => {
  const raw = json('promotion_applied.json');
  raw.envAdded = ['.env:OK', 'x; rm -rf /', '$(id):KEY', 42, '.env_fbl:A.B-C'];
  raw.files['state.after'] += '\n|bad row\nsvc|name|img';
  const r = parseReceipt(JSON.stringify(raw));
  assert.deepEqual(r.envAdded, ['.env:OK', '.env_fbl:A.B-C']);
  assert.ok(r.containers.every((c) => c.image));
});
