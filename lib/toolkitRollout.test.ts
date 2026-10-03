import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolkitRollout, toolkitRolloutMarkdown, INSTALL_ORDER, RESTART_ORDER, RolloutServer } from './toolkitRollout.js';

const servers = (env: string): RolloutServer[] =>
  ['Bot-Builder', 'ChatBot / NLU', 'Database', 'Chat-Service'].map((role) => ({
    environment: env, role, runAs: env === 'UAT' ? 'chatbotuat' : 'root', composePath: `/srv/${role.split(' ')[0].toLowerCase()}`, access: null,
  }));
const flat = (r: ReturnType<typeof buildToolkitRollout>) => r.phases.flatMap((p) => p.servers.flatMap((s) => s.steps.flatMap((x) => x.commands))).join('\n');

test('install and restart orders follow the bundle README', () => {
  const r = buildToolkitRollout({ environment: 'SIT', bundle: 'alara-deploy-v2.6-sit.tar.gz', keyFile: null, servers: servers('SIT') });
  assert.deepEqual(r.phases[0].servers.map((s) => s.role), [...INSTALL_ORDER]);
  assert.deepEqual(r.phases[1].servers.map((s) => s.role), [...RESTART_ORDER]);
  assert.deepEqual([...INSTALL_ORDER], ['Chat-Service', 'Database', 'ChatBot / NLU', 'Bot-Builder']);
  assert.deepEqual([...RESTART_ORDER], ['Database', 'ChatBot / NLU', 'Chat-Service', 'Bot-Builder']);
});

test('commands use the deployer\'s real flags: --env required, --dry-run first, --key-file only for the key pass', () => {
  const plain = flat(buildToolkitRollout({ environment: 'UAT', bundle: 'b.tar.gz', keyFile: null, servers: servers('UAT') }));
  assert.match(plain, /~\/alara-deploy\/alara_deploy\.sh --env UAT --dry-run/);
  assert.match(plain, /~\/alara-deploy\/alara_deploy\.sh --env UAT$/m);
  assert.match(plain, /sha256sum -c SHA256SUMS/);
  assert.doesNotMatch(plain, /--key-file/);
  const key = flat(buildToolkitRollout({ environment: 'UAT', bundle: 'b.tar.gz', keyFile: '~/alara_shared.key', servers: servers('UAT') }));
  assert.match(key, /--env UAT --key-file '~\/alara_shared\.key' --dry-run/);
  assert.match(key, /key rollback/);
});

test('PROD: typed PROD, never --yes; UAT/PROD mention bank sessions', () => {
  const prod = buildToolkitRollout({ environment: 'Prod', bundle: 'b.tar.gz', keyFile: null, servers: servers('Prod') });
  assert.ok(prod.warnings.some((w) => /type PROD/i.test(w) && /refuses --yes/.test(w)));
  assert.ok(prod.warnings.some((w) => /bank sessions/.test(w)));
  assert.doesNotMatch(flat(prod), /--yes/);
  assert.match(toolkitRolloutMarkdown(prod), /Type PROD when asked/);
  const sit = buildToolkitRollout({ environment: 'SIT', bundle: 'b.tar.gz', keyFile: null, servers: servers('SIT') });
  assert.ok(!sit.warnings.some((w) => /bank sessions/.test(w)));
});

test('uses the registry compose folder and flags unknown ones; DB gets the DR check', () => {
  const r = buildToolkitRollout({ environment: 'SIT', bundle: 'b.tar.gz', keyFile: null, servers: servers('SIT') });
  assert.match(flat(r), /cd '\/srv\/database'/);
  const unknown = buildToolkitRollout({ environment: 'SIT', bundle: 'b.tar.gz', keyFile: null, servers: servers('SIT').map((s) => ({ ...s, composePath: null })) });
  assert.ok(unknown.warnings.some((w) => /Compose folder unknown/.test(w)));
  assert.match(flat(unknown), /cd <compose folder>/);
  const db = r.phases[1].servers.find((s) => s.role === 'Database')!;
  assert.ok(db.steps.some((s) => s.notes.some((n) => /SHOW REPLICA STATUS/.test(n))));
  assert.match(toolkitRolloutMarkdown(r), /^## Phase B/m);
});
