import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNote, NOTE_LABEL, NOTE_REQUIRED_MESSAGE } from './releaseNote.js';

test('validateNote accepts any non-blank text', () => {
  assert.equal(validateNote('Patched memento to v1.1.8'), null);
  assert.equal(validateNote('  x  '), null);
});

test('validateNote rejects empty, whitespace-only and non-string values', () => {
  for (const bad of ['', '   ', '\n\t', null, undefined, 0, 42, {}, []]) {
    assert.equal(validateNote(bad), NOTE_REQUIRED_MESSAGE, String(bad));
  }
});

test('the error message names the field the way the forms label it', () => {
  assert.match(NOTE_REQUIRED_MESSAGE, new RegExp(NOTE_LABEL));
});
