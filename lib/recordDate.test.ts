import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecordDate } from './recordDate.js';

const now = new Date('2026-10-02T12:00:00Z');

test('parseRecordDate accepts past dates and ISO strings', () => {
  assert.equal(parseRecordDate('2026-09-20T03:07:00.000Z', now)?.toISOString(), '2026-09-20T03:07:00.000Z');
  assert.ok(parseRecordDate('2024-01-15', now));
  assert.ok(parseRecordDate(now.getTime() - 1000, now));
});

test('parseRecordDate rejects junk, ancient and far-future dates', () => {
  for (const bad of ['', '   ', 'yesterday-ish', null, undefined, {}, '1999-12-31T00:00:00Z', '2026-10-04T00:00:00Z']) {
    assert.equal(parseRecordDate(bad, now), null, String(bad));
  }
  assert.ok(parseRecordDate('2026-10-03T06:00:00Z', now), 'within a day ahead is allowed (time zones)');
});
