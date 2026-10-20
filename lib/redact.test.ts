import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSecret, redactText, redactValue, REDACTED } from './redact.js';

test('sensitive keys are redacted whatever the value', () => {
  for (const key of ['DB_PASSWORD', 'JWT_SECRET', 'API_KEY', 'AZURE_OPENAI_API_KEY', 'ACCESS_TOKEN', 'REDIS_URL', 'MONGO_URI', 'DATABASE_URL', 'PRIVATE_KEY', 'MASTER_KEY']) {
    assert.equal(redactValue(key, 'plain'), REDACTED, key);
  }
});

test('secret-looking values are redacted under any key', () => {
  assert.equal(redactValue('X', 'ENC[AES256,abc]'), REDACTED);
  assert.equal(redactValue('X', 'SHA256:49c0374dbe'), REDACTED);
  assert.equal(redactValue('X', '-----BEGIN RSA PRIVATE KEY-----\nMIIE'), REDACTED);
  assert.equal(redactValue('X', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl'), REDACTED);
});

test('URL passwords are masked in place, ordinary values pass through', () => {
  assert.equal(redactValue('BROKER', 'amqp://app:pa55@10.0.0.5:5672/'), `amqp://app:${REDACTED}@10.0.0.5:5672/`);
  assert.equal(redactValue('TIMEOUT', '30'), '30');
  assert.equal(redactValue('PUBLIC_URL', 'https://uat.bank.local/chat'), 'https://uat.bank.local/chat');
  assert.equal(redactValue('X', null), null);
  assert.equal(isSecret('LOG_LEVEL', 'info'), false);
});

test('free text: KEY=value secrets, URL passwords and key blocks are masked line by line', () => {
  const out = redactText('A=1\nDB_PASSWORD=hunter2\n  - API_KEY: abc\nurl http://u:p@h/x\n-----BEGIN PRIVATE KEY-----');
  assert.equal(out, `A=1\nDB_PASSWORD=${REDACTED}\n  - API_KEY: ${REDACTED}\nurl http://u:${REDACTED}@h/x\n${REDACTED}`);
  assert.doesNotMatch(out, /hunter2|abc|:p@/);
});
