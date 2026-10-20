import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareEnvironments, PlanningData, PlanningDeployment, PlanningServer } from './envCompare.js';
import { buildChangeIndex } from './changeMap.js';
import { resolveScope, PatchScopeInput } from './patchScope.js';
import { buildPatchPlan, tarFileName, defaultPatchId } from './patchPlan.js';
import { renderRunbook, renderSteps, stepNumbers } from './patchRender.js';

const R = 'ChatBot / NLU';
const DB = 'Database';
const NOW = new Date('2026-10-20T00:00:00Z');
const ID = 'PATCH-SIT-UAT-20261020';

const dep = (environment: string, service: string, image: string, role = R): PlanningDeployment => ({
  service, role, environment, composeKey: service, containerName: service, image, tag: image.split(':').pop()!, composeFile: 'docker-compose.yml', vaultVersion: 1, vaultAt: '2026-10-01T00:00:00Z',
});
const server = (environment: string, role: string, extra: Partial<PlanningServer> = {}): PlanningServer => ({
  environment, role, ip: environment === 'SIT' ? '10.1.1.5' : '10.2.2.5', domain: null, composePath: environment === 'SIT' ? '/root/ISSM/chatbot' : '/srv/alara/chatbot_uat',
  runAs: environment === 'SIT' ? 'root' : 'chatbotuat', access: environment === 'SIT' ? null : 'jump 10.200.200.20', envFiles: ['.env_fbl'], toolkitVersion: '2.6', ...extra,
});

const SIT_COMPOSE = `services:
  memento:
    image: registry.local/memento:v1.1.9
    env_file: [.env_fbl]
    ports: ["8100:8100"]
    depends_on: [redis]
  redis:
    image: redis:7.2
  retriever:
    image: registry.local/retriever:abc123
    ports: ["8000:8000"]
    environment:
      - API_KEY=supersecretvalue
  worker:
    image: registry.local/worker:2.0
    env_file: [.env_fbl]
`;
const UAT_COMPOSE = `services:
  memento:
    image: registry.local/memento:v1.1.7
    env_file: [.env_fbl]
    ports: ["8100:8100"]
    depends_on: [redis]
  redis:
    image: redis:7.0
  worker:
    image: registry.local/worker:1.9
    env_file: [.env_fbl]
`;

function setup(over: { servers?: PlanningServer[]; uatCompose?: string; envFiles?: boolean } = {}) {
  const data: PlanningData = {
    records: [],
    deployments: [
      dep('SIT', 'memento', 'registry.local/memento:v1.1.9'), dep('UAT', 'memento', 'registry.local/memento:v1.1.7'),
      dep('SIT', 'redis', 'redis:7.2'), dep('UAT', 'redis', 'redis:7.0'),
      dep('SIT', 'retriever', 'registry.local/retriever:abc123'),
      dep('SIT', 'worker', 'registry.local/worker:2.0'), dep('UAT', 'worker', 'registry.local/worker:1.9'),
      dep('SIT', 'postgres', 'postgres:16.2', DB), dep('UAT', 'postgres', 'postgres:16.1', DB),
    ],
    reports: [],
    servers: over.servers ?? [server('SIT', R), server('UAT', R), server('SIT', DB, { composePath: '/root/ISSM/db' }), server('UAT', DB, { composePath: '/srv/alara/db_uat', runAs: 'dbuat' })],
    vaultFiles: [
      { environment: 'SIT', role: R, path: 'docker-compose.yml', version: 3, createdAt: '2026-10-01T00:00:00Z', content: SIT_COMPOSE },
      { environment: 'UAT', role: R, path: 'docker-compose.yml', version: 2, createdAt: '2026-10-01T00:00:00Z', content: over.uatCompose ?? UAT_COMPOSE },
      ...(over.envFiles === false ? [] : [
        { environment: 'SIT', role: R, path: '.env_fbl', version: 1, createdAt: '2026-10-01T00:00:00Z', content: 'LOG_LEVEL=debug\nNEW_FLAG=1\nNEW_ADDR=10.1.1.5:9000\nDB_PASSWORD=hunter2\nNEW_TOKEN=tok-sit-123\n' },
        { environment: 'UAT', role: R, path: '.env_fbl', version: 1, createdAt: '2026-10-01T00:00:00Z', content: 'LOG_LEVEL=info\nDB_PASSWORD=swordfish\nONLY_UAT=1\n' },
      ]),
    ],
  };
  return data;
}

function plan(data: PlanningData, scope: Partial<PatchScopeInput>, opts: { includeValues?: boolean; patchId?: string; tarDir?: string } = {}) {
  const comparison = compareEnvironments(data, { sourceEnv: 'SIT', targetEnv: 'UAT', includeValues: opts.includeValues ?? true, now: NOW });
  const index = buildChangeIndex({ changes: [], links: [], records: [] });
  const resolved = resolveScope(comparison, { mode: 'builds', selections: [], changeKeys: [], includeConfig: true, ...scope }, index, []);
  const composeTexts: Record<string, { source: string | null; target: string | null }> = {};
  for (const r of comparison.roles) {
    const pick = (env: string) => data.vaultFiles.find((f) => f.environment === env && f.role === r.role && f.path === 'docker-compose.yml')?.content ?? null;
    composeTexts[r.role] = { source: pick('SIT'), target: pick('UAT') };
  }
  return buildPatchPlan({ comparison, scope: resolved, patchId: opts.patchId ?? ID, tarDir: opts.tarDir, composeTexts, generatedAt: NOW });
}

const allText = (p: ReturnType<typeof plan>) => JSON.stringify(p) + renderSteps(p) + renderRunbook(p);
const cmds = (p: ReturnType<typeof plan>, phase: string) => p.steps.filter((s) => s.phase === phase).flatMap((s) => s.commands);

test('target-only: starts on the target server with real paths, image already present', () => {
  const p = plan(setup(), { selections: [{ key: `${R}::memento` }] });
  assert.deepEqual(p.errors, []);
  assert.equal(p.steps[0].phase, 'access');
  assert.match(p.steps[0].server, /^UAT \/ ChatBot \/ NLU \(10\.2\.2\.5\)$/);
  assert.match(p.steps[0].title, /via jump 10\.200\.200\.20/);
  assert.deepEqual(p.steps[0].commands, ['whoami', 'hostname -I', 'cd /srv/alara/chatbot_uat', 'ls -l docker-compose.yml']);
  assert.ok(p.steps.every((s) => s.server.startsWith('UAT')), 'no step runs on the source');
  assert.deepEqual(cmds(p, 'load'), [
    `docker load -i /srv/alara/chatbot_uat/alara/patches/incoming/${ID}/memento_v1.1.9.tar`,
    "docker image inspect --format '{{.Id}} {{.RepoTags}}' registry.local/memento:v1.1.9",
  ]);
  assert.deepEqual(cmds(p, 'deploy'), ['docker compose -f docker-compose.yml up -d --no-deps memento worker']);
});

test('never exports, transfers or connects: no save, scp, sftp, rsync, ssh or WinSCP anywhere', () => {
  for (const scope of [{ mode: 'full-sync' as const }, { selections: [{ key: `${R}::memento` }] }]) {
    const text = allText(plan(setup(), scope)).toLowerCase();
    for (const banned of ['docker save', 'docker export', 'scp ', 'sftp', 'rsync', 'winscp', 'ssh ', 'docker push', 'docker pull']) {
      assert.ok(!text.includes(banned), `${banned} found`);
    }
  }
});

test('the generated compose edit changes exactly the one image line', () => {
  const p = plan(setup(), { selections: [{ key: `${R}::memento` }] });
  const step = p.steps.find((s) => s.id.endsWith('compose-memento'))!;
  assert.equal(step.manual, false);
  assert.equal(step.file, '/srv/alara/chatbot_uat/docker-compose.yml');
  assert.equal(step.setting, 'services.memento.image: registry.local/memento:v1.1.7 → registry.local/memento:v1.1.9');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sed-'));
  try {
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), UAT_COMPOSE);
    execFileSync('bash', ['-c', step.commands[0]], { cwd: dir });
    const after = fs.readFileSync(path.join(dir, 'docker-compose.yml'), 'utf8');
    assert.equal(after, UAT_COMPOSE.replace('memento:v1.1.7', 'memento:v1.1.9'));
    execFileSync('bash', ['-c', step.commands[1]], { cwd: dir }); // grep finds the new line (exit 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ambiguous or variable image lines become manual edits, never a blind sed', () => {
  const shared = UAT_COMPOSE.replace('image: registry.local/worker:1.9', 'image: registry.local/memento:v1.1.7');
  const p = plan(setup({ uatCompose: shared }), { selections: [{ key: `${R}::memento` }] });
  const step = p.steps.find((s) => s.id.endsWith('compose-memento'))!;
  assert.equal(step.manual, true);
  assert.ok(!step.commands.some((c) => c.startsWith('sed')));
  assert.ok(p.risks.some((r) => /more than one image: line/.test(r)));

  const variable = UAT_COMPOSE.replace('image: registry.local/memento:v1.1.7', 'image: registry.local/memento:${MEMENTO_TAG}');
  const v = plan(setup({ uatCompose: variable }), { selections: [{ key: `${R}::memento` }] }).steps.find((s) => s.id.endsWith('compose-memento'))!;
  assert.equal(v.manual, true);
  assert.match(v.setting!, /change the variable it uses/);
});

test('backup before edit; rollback restores the backup and names the previous image', () => {
  const p = plan(setup(), { selections: [{ key: `${R}::memento` }] });
  const order = p.steps.map((s) => s.phase);
  assert.ok(order.indexOf('backup') < order.indexOf('load') && order.indexOf('load') < order.indexOf('compose') && order.indexOf('compose') < order.indexOf('deploy') && order.indexOf('deploy') < order.indexOf('verify'));
  assert.equal(order.at(-1), 'rollback');
  assert.ok(cmds(p, 'backup').includes(`cp -p docker-compose.yml docker-compose.yml.before-${ID}`));
  const rb = p.steps.find((s) => s.phase === 'rollback')!;
  assert.ok(rb.commands.includes(`cp -p docker-compose.yml.before-${ID} docker-compose.yml`));
  assert.ok(rb.commands.includes('docker compose -f docker-compose.yml up -d --no-deps memento worker'));
  assert.match(rb.expected, /memento registry\.local\/memento:v1\.1\.7/);
  assert.match(rb.expected, /never docker image prune/);
});

test('config: plain added keys get exact appends with target values; secrets and changed values are manual and never shown', () => {
  const p = plan(setup(), { selections: [{ key: `${R}::memento` }] });
  const cfg = p.steps.filter((s) => s.phase === 'config');
  const flag = cfg.find((s) => s.title === 'Add NEW_FLAG to .env_fbl')!;
  assert.ok(flag.commands.includes("printf '%s\\n' NEW_FLAG=1 >> .env_fbl"));
  assert.equal(flag.file, '/srv/alara/chatbot_uat/.env_fbl');
  const addr = cfg.find((s) => /NEW_ADDR/.test(s.title))!;
  assert.equal(addr.setting, 'NEW_ADDR=10.2.2.5:9000', 'SIT IP translated to the UAT one');
  const token = cfg.find((s) => /NEW_TOKEN/.test(s.title))!;
  assert.equal(token.manual, true);
  assert.equal(token.setting, 'NEW_TOKEN=<UAT value>');
  assert.ok(!cfg.some((s) => /LOG_LEVEL|ONLY_UAT|DB_PASSWORD/.test(s.title)), 'changed and target-only keys get no step');
  assert.ok(p.servers[0].reviewOnly.some((c) => c.key === 'ONLY_UAT' && c.action === 'keep'));
  assert.ok(cmds(p, 'backup').includes(`cp -p .env_fbl .env_fbl.before-${ID}`));
  const text = allText(p);
  for (const secret of ['hunter2', 'swordfish', 'tok-sit-123', 'supersecretvalue']) assert.ok(!text.includes(secret), `${secret} leaked`);
});

test('without admin values, every config step is manual', () => {
  const p = plan(setup(), { selections: [{ key: `${R}::memento` }] }, { includeValues: false });
  assert.ok(p.steps.filter((s) => s.phase === 'config').every((s) => s.manual && /<UAT value>/.test(s.setting!)));
  assert.ok(p.assumptions.some((a) => /withheld/.test(a)));
});

test('unknown server data stays a placeholder and is listed, never invented', () => {
  const p = plan(setup({ servers: [server('SIT', R)] }), { selections: [{ key: `${R}::memento` }] });
  assert.equal(p.steps[0].commands.join('\n'), `cd '<COMPOSE_DIR:UAT/ChatBot / NLU>'\nls -l docker-compose.yml`);
  assert.ok(p.steps[0].unknowns.length >= 3);
  for (const u of [/Compose folder on UAT/, /No server registry entry for UAT/, /IP of UAT/, /Run-as account/]) assert.ok(p.unknowns.some((x) => u.test(x)), String(u));
  assert.doesNotMatch(allText(p), /\/srv\/alara\/chatbot_uat/);
});

test('a new service is added by hand from the redacted source definition', () => {
  const p = plan(setup(), { selections: [{ key: `${R}::retriever` }] });
  const step = p.steps.find((s) => s.id.endsWith('compose-retriever'))!;
  assert.equal(step.manual, true);
  assert.match(step.expected, /retriever:\n    image: registry\.local\/retriever:abc123/);
  assert.match(step.expected, /API_KEY=\[redacted\]/);
  const rb = p.steps.find((s) => s.phase === 'rollback')!;
  assert.ok(rb.commands.includes('docker compose -f docker-compose.yml stop retriever'));
});

test('full sync orders servers Database first and services by depends_on', () => {
  const p = plan(setup(), { mode: 'full-sync' });
  assert.deepEqual(p.servers.map((s) => s.role), [DB, R]);
  assert.match(p.steps[0].server, /^UAT \/ Database/);
  assert.deepEqual(cmds(p, 'deploy')[1], 'docker compose -f docker-compose.yml up -d --no-deps redis memento retriever worker');
});

test('both outputs come from the same steps: same numbers, titles, commands and expectations', () => {
  const p = plan(setup(), { mode: 'full-sync' });
  const steps = renderSteps(p);
  const runbook = renderRunbook(p);
  const nums = stepNumbers(p);
  for (const s of p.steps) {
    const heading = `[ ] ${nums.get(s.id)}. ${s.title}`;
    assert.ok(steps.includes(heading), `steps missing ${heading}`);
    assert.ok(runbook.includes(heading), `runbook missing ${heading}`);
    for (const c of s.commands) assert.ok(steps.includes(c) && runbook.includes(c), c);
    assert.ok(steps.includes(s.expected) && runbook.includes(s.expected));
  }
  for (let i = 1; i <= 10; i++) assert.match(runbook, new RegExp(`^## ${i}\\. `, 'm'));
  assert.ok(steps.length < runbook.length);
  assert.match(steps, /nothing has been run, and ticking a box is not proof/);
});

test('a bad patch ID or tar folder is an error; a tar folder override is used verbatim', () => {
  assert.ok(plan(setup(), { selections: [{ key: `${R}::memento` }] }, { patchId: 'bad id;rm' }).errors.length);
  assert.ok(plan(setup(), { selections: [{ key: `${R}::memento` }] }, { tarDir: 'relative/dir' }).errors.length);
  const p = plan(setup(), { selections: [{ key: `${R}::memento` }] }, { tarDir: '/data/incoming' });
  assert.ok(cmds(p, 'load')[0] === 'docker load -i /data/incoming/memento_v1.1.9.tar');
});

test('tar names and default patch IDs', () => {
  assert.equal(tarFileName('registry.local/memento:v1.1.9'), 'memento_v1.1.9.tar');
  assert.equal(tarFileName('postgres'), 'postgres_latest.tar');
  assert.equal(defaultPatchId('UAT', 'Prod', NOW), 'PATCH-UAT-PROD-20261020');
});
