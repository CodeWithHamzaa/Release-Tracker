import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEnvironment, checkPromotionPair } from './environments.js';

test('canonical names', () => {
  assert.equal(canonicalEnvironment('prod'), 'Prod');
  assert.equal(canonicalEnvironment(' sit '), 'SIT');
  assert.equal(canonicalEnvironment('Staging'), null);
  assert.equal(canonicalEnvironment(3), null);
});

test('usual promotion paths have no warning; others are allowed with one; same or unknown are refused', () => {
  assert.deepEqual(checkPromotionPair('SIT', 'UAT'), { ok: true, source: 'SIT', target: 'UAT', warning: null });
  assert.deepEqual(checkPromotionPair('uat', 'PROD'), { ok: true, source: 'UAT', target: 'Prod', warning: null });
  const skip = checkPromotionPair('SIT', 'Prod');
  assert.equal(skip.ok, true);
  assert.match((skip as any).warning, /skips UAT/);
  assert.match((checkPromotionPair('Prod', 'UAT') as any).warning, /backwards/);
  assert.equal(checkPromotionPair('UAT', 'uat').ok, false);
  assert.equal(checkPromotionPair('UAT', 'Staging').ok, false);
  assert.equal(checkPromotionPair(undefined, 'UAT').ok, false);
});
