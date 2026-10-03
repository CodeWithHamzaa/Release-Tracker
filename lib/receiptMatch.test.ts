import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReceipt } from './receiptParse.js';
import { matchReceipt, receiptNote, MatchableRecord } from './receiptMatch.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'receipts');
const receipt = (n: string) => parseReceipt(readFileSync(join(FX, n), 'utf8'));

const rec = (over: Partial<MatchableRecord>): MatchableRecord => ({
  id: Math.random().toString(36).slice(2),
  environment: 'SIT',
  server: 'ChatBot / NLU',
  service: 'memento',
  version: 'v1.1.9',
  status: 'PENDING',
  note: 'Patch PATCH-E2E: memento v1.1.9',
  ...over,
});

test('a successful receipt closes the PENDING record for the applied image, as SUCCESS', () => {
  const r = rec({});
  const { matches, unmatchedImages } = matchReceipt(receipt('success.json'), [r]);
  assert.deepEqual(matches.map((m) => [m.record.id, m.via, m.newStatus]), [[r.id, 'both', 'SUCCESS']]);
  assert.deepEqual(unmatchedImages, []);
});

test('a rolled-back receipt marks the record FAILED', () => {
  const { matches } = matchReceipt(receipt('rolled_back.json'), [rec({})]);
  assert.equal(matches[0].newStatus, 'FAILED');
});

test('it matches by image alone (no PATCH_ID in the note) and by PATCH_ID alone', () => {
  const byImage = matchReceipt(receipt('success.json'), [rec({ note: 'plain note, no id' })]).matches;
  assert.deepEqual(byImage.map((m) => m.via), ['image']);
  const byId = matchReceipt(receipt('success.json'), [rec({ version: 'v9.9.9' })]).matches; // version differs, id agrees
  assert.deepEqual(byId.map((m) => m.via), ['patch-id']);
  assert.deepEqual(matchReceipt(receipt('success.json'), [rec({ version: 'v9.9.9', note: 'no id' })]).matches, []);
});

test('records already closed, in another environment or on another server are never touched', () => {
  const records = [
    rec({ status: 'SUCCESS' }),
    rec({ status: 'FAILED' }),
    rec({ environment: 'UAT' }),
    rec({ server: 'Database' }),
    rec({ environment: 'Sit', status: 'pending' }), // case-insensitive: this one matches
  ];
  const { matches } = matchReceipt(receipt('success.json'), records);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].record, records[4]);
});

test('a record for a service the toolkit did NOT apply here is not closed, even with the PATCH_ID', () => {
  const other = rec({ service: 'sent-lang', version: '1.2' });
  const { matches } = matchReceipt(receipt('success.json'), [other]);
  assert.deepEqual(matches, []);
});

test('applied images with no record come back so the review screen can offer new records', () => {
  const { matches, unmatchedImages } = matchReceipt(receipt('success.json'), []);
  assert.deepEqual(matches, []);
  assert.deepEqual(unmatchedImages.map((i) => [i.service, i.newRef]), [['memento', 'memento:v1.1.9']]);
});

test('nothing applied: only the PATCH_ID ties a record to the receipt, and it stays PENDING', () => {
  const tied = rec({ service: 'anything', version: '1' });
  const { matches } = matchReceipt(receipt('nothing_applicable.json'), [tied, rec({ note: 'no id here' })]);
  assert.deepEqual(matches.map((m) => [m.record.id, m.newStatus]), [[tied.id, null]]);
  const refused = matchReceipt(receipt('refused.json'), [tied]).matches;
  assert.equal(refused[0].newStatus, null);
});

test('PATCH_ID matching is a whole token: PATCH-E2E does not match PATCH-E2E-OLD or PATCH-E2E2', () => {
  const notes = ['x PATCH-E2E-OLD y', 'PATCH-E2E2', 'e2e only', '(PATCH-E2E)', 'patch-e2e.'];
  const matched = matchReceipt(receipt('nothing_applicable.json'), notes.map((note) => rec({ note }))).matches.map((m) => m.record.note);
  assert.deepEqual(matched, ['(PATCH-E2E)', 'patch-e2e.']);
});

test('the note line says what happened, in plain words', () => {
  const line = receiptNote(receipt('rolled_back.json'));
  assert.match(line, /^\[receipt \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\] ROLLED_BACK, exit 1 on sit-chatbot-01, toolkit record \d{8}_\d{6}_PATCH-E2E\. The health gate failed/);
  assert.match(receiptNote(receipt('refused.json')), /refused, exit 2/);
});
