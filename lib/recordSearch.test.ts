import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, recordDateTerms } from './recordSearch.js';
import type { ReleaseRecord } from './types.js';

// Local-time constructors so the tests do not depend on the machine's timezone.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0).toISOString();

const rec = (over: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
  id: 'rel-1',
  environment: 'SIT',
  server: 'ChatBot / NLU',
  service: 'memento',
  version: 'v1.1.8',
  developerName: 'Bilal Saleem',
  status: 'SUCCESS',
  isBuildUpdate: true,
  isEnvUpdate: false,
  isConfigUpdate: false,
  hasCommands: false,
  note: 'Fixed login timeout for LDAP users',
  source: 'Teams Group',
  added_by: 'A.Hameed',
  createdAt: at(2026, 10, 3),
  updatedAt: at(2026, 10, 3),
  ...over,
});

test('an empty or blank query matches everything', () => {
  assert.equal(matchesSearch(rec(), ''), true);
  assert.equal(matchesSearch(rec(), '   '), true);
});

test('matches service, release note, version, developer and server text', () => {
  const r = rec();
  assert.equal(matchesSearch(r, 'memento'), true);
  assert.equal(matchesSearch(r, 'LDAP'), true); // note, case-insensitive
  assert.equal(matchesSearch(r, 'login timeout'), true); // two words, both in the note
  assert.equal(matchesSearch(r, 'v1.1.8'), true);
  assert.equal(matchesSearch(r, 'bilal'), true);
  assert.equal(matchesSearch(r, 'nlu'), true);
  assert.equal(matchesSearch(r, 'nonexistent'), false);
});

test('every word must match (AND), each in any field', () => {
  assert.equal(matchesSearch(rec(), 'memento ldap'), true);
  assert.equal(matchesSearch(rec(), 'memento kubernetes'), false);
});

test('ISO date, month and year', () => {
  const r = rec({ createdAt: at(2026, 10, 3) });
  assert.equal(matchesSearch(r, '2026-10-03'), true);
  assert.equal(matchesSearch(r, '2026-10'), true);
  assert.equal(matchesSearch(r, '2026'), true);
  assert.equal(matchesSearch(r, '2026-10-04'), false);
  assert.equal(matchesSearch(r, '2025'), false);
  assert.equal(matchesSearch(r, '2026-09'), false);
});

test('month names, short and long, any case', () => {
  const r = rec({ createdAt: at(2026, 10, 3), note: 'plain note', service: 'svc', developerName: 'dev', server: 'srv', added_by: 'x', source: 'y', version: 'v9' });
  assert.equal(matchesSearch(r, 'Oct'), true);
  assert.equal(matchesSearch(r, 'OCTOBER'), true);
  assert.equal(matchesSearch(r, 'nov'), false);
  assert.equal(matchesSearch(r, 'november'), false);
});

test('"Oct 3" matches that day only, not Oct 13 or Oct 30', () => {
  const third = rec({ createdAt: at(2026, 10, 3) });
  const thirteenth = rec({ createdAt: at(2026, 10, 13) });
  const thirtieth = rec({ createdAt: at(2026, 10, 30) });
  for (const q of ['Oct 3', 'oct 03', 'October 3', 'oct. 3']) {
    assert.equal(matchesSearch(third, q), true, q);
    assert.equal(matchesSearch(thirteenth, q), false, `13th vs ${q}`);
    assert.equal(matchesSearch(thirtieth, q), false, `30th vs ${q}`);
  }
  assert.equal(matchesSearch(rec({ createdAt: at(2026, 9, 3) }), 'oct 3'), false);
});

test('a month-day phrase combines with other words', () => {
  const r = rec({ createdAt: at(2026, 10, 3) });
  assert.equal(matchesSearch(r, 'oct 3 memento'), true);
  assert.equal(matchesSearch(r, 'oct 3 kubernetes'), false);
  assert.equal(matchesSearch(rec({ createdAt: at(2026, 10, 4) }), 'oct 3 memento'), false);
});

test('a bad or missing date never throws and only blocks date queries', () => {
  const bad = rec({ createdAt: 'not-a-date' });
  assert.equal(matchesSearch(bad, 'memento'), true);
  assert.equal(matchesSearch(bad, '2026-10-03'), false);
  assert.equal(matchesSearch(bad, 'oct 3'), false);
  const missing = { ...rec(), createdAt: undefined } as unknown as ReleaseRecord;
  assert.equal(matchesSearch(missing, 'memento'), true);
  assert.deepEqual(recordDateTerms(undefined), []);
});

test('recordDateTerms lists ISO day/month/year and month names, no bare day', () => {
  assert.deepEqual(recordDateTerms(at(2026, 10, 3)), ['2026-10-03', '2026-10', '2026', 'oct', 'october']);
});
