import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccess } from './auth.js';

const both = { ALLOWED_EMAILS: 'op@x.com, Other@x.com', ADMIN_EMAILS: 'Admin@x.com' };

test('admins and operators get their roles, case-insensitively', () => {
  assert.deepEqual(resolveAccess('admin@x.com', both, true), { status: 'ok', role: 'admin' });
  assert.deepEqual(resolveAccess('ADMIN@x.com', both, true), { status: 'ok', role: 'admin' });
  assert.deepEqual(resolveAccess('other@x.com', both, true), { status: 'ok', role: 'operator' });
});

test('an email on neither list is forbidden, and so is an empty email', () => {
  assert.deepEqual(resolveAccess('stranger@x.com', both, true), { status: 'forbidden' });
  assert.deepEqual(resolveAccess('', both, true), { status: 'forbidden' });
});

test('ADMIN_EMAILS alone works: admins are implicitly allowed, nobody else is', () => {
  const env = { ADMIN_EMAILS: 'admin@x.com' };
  assert.deepEqual(resolveAccess('admin@x.com', env, true), { status: 'ok', role: 'admin' });
  assert.deepEqual(resolveAccess('op@x.com', env, true), { status: 'forbidden' });
});

test('lock-out guard: ALLOWED_EMAILS alone keeps its users as admins', () => {
  assert.deepEqual(resolveAccess('op@x.com', { ALLOWED_EMAILS: 'op@x.com' }, true), { status: 'ok', role: 'admin' });
  assert.deepEqual(resolveAccess('stranger@x.com', { ALLOWED_EMAILS: 'op@x.com' }, true), { status: 'forbidden' });
});

test('no lists: production fails closed, local dev stays open', () => {
  assert.deepEqual(resolveAccess('anyone@x.com', {}, true), { status: 'misconfigured' });
  assert.deepEqual(resolveAccess('anyone@x.com', { ALLOWED_EMAILS: ' , ', ADMIN_EMAILS: '' }, true), { status: 'misconfigured' });
  assert.deepEqual(resolveAccess('anyone@x.com', {}, false), { status: 'ok', role: 'admin' });
});
