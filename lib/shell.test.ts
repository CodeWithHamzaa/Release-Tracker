import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { shellArg, shellQuote } from './shell.js';

test('quoted values reach bash unchanged, including single quotes and spaces', () => {
  for (const v of ["it's /root/ISSM/a b", '<COMPOSE_DIR:UAT/ChatBot / NLU>', '$(rm -rf /)', 'a;b', 'plain/path-1.2']) {
    for (const q of [shellQuote, shellArg]) {
      assert.equal(execFileSync('bash', ['-c', `printf %s ${q(v)}`]).toString(), v, `${q.name} ${v}`);
    }
  }
  assert.equal(shellArg('registry.local/memento:v1.1.9'), 'registry.local/memento:v1.1.9');
  assert.equal(shellArg('a b'), "'a b'");
});
