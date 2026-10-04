import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isComposePath, planComposeSync, primaryComposePath } from './composeSync.js';

const plan = (compose: string, dotEnv: string | null = null, catalogNames: string[] = []) => {
  const p = planComposeSync({ compose, dotEnv, catalogNames });
  if (!p.ok) throw new Error(`expected ok, got: ${p.error}`);
  return p;
};

test('services, images, tags and published ports', () => {
  const p = plan(`
services:
  ldap-connector:
    image: registry.local:5000/ldap-connector:2.4.2
    ports: ["8081:8080", "8081:8080"]
  redis-db:
    image: redis
    expose: ["6379"]
`);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.services.length, 2);
  const [ldap, redis] = p.services;
  assert.equal(ldap.name, 'ldap-connector');
  assert.equal(ldap.tag, '2.4.2');
  assert.deepEqual(ldap.ports.map((x) => `${x.hostPort}:${x.containerPort}`), ['8081:8080']); // duplicate dropped
  assert.equal(redis.tag, 'latest');
  assert.deepEqual(redis.ports, []);
});

test('catalog name kept when the compose key differs', () => {
  const p = plan(
    `
services:
  alara-ui2:
    image: alara/alara-ui:1.0
    container_name: alara-ui
  single-intent-v2:
    image: alara/single-intent:3.1
`,
    null,
    ['alara-ui', 'single-intent']
  );
  assert.deepEqual(p.services.map((s) => [s.composeKey, s.name]), [
    ['alara-ui2', 'alara-ui'], // via container_name
    ['single-intent-v2', 'single-intent'], // via image repo
  ]);
});

test('a compose key that is a catalog name is never borrowed by another service', () => {
  const p = plan(
    `
services:
  alara-ui2:
    image: alara/alara-ui:2.0
  alara-ui:
    image: alara/alara-ui:1.0
`,
    null,
    ['alara-ui']
  );
  assert.deepEqual(p.services.map((s) => [s.composeKey, s.name]), [
    ['alara-ui2', 'alara-ui2'],
    ['alara-ui', 'alara-ui'],
  ]);
});

test('${VAR} resolves from .env; ENC[...] values are not used', () => {
  const p = plan(
    `
services:
  api:
    image: api:\${API_TAG}
    ports: ["\${API_PORT:-8080}:80", "\${SECRET_PORT}:81"]
`,
    'API_TAG=1.2.3\nAPI_PORT=9090\nSECRET_PORT=ENC[abc]\n'
  );
  assert.equal(p.services[0].image, 'api:1.2.3');
  assert.deepEqual(p.services[0].ports.map((x) => x.hostPort), [9090]);
  assert.ok(p.warnings.some((w) => w.includes('SECRET_PORT')));
});

test('default port used when there is no .env', () => {
  const p = plan('services:\n  api:\n    image: api:1\n    ports: ["${API_PORT:-8080}:80"]\n');
  assert.deepEqual(p.services[0].ports.map((x) => x.hostPort), [8080]);
});

test('unreadable files are refused, never synced as empty', () => {
  const bad = planComposeSync({ compose: 'services: [unclosed', dotEnv: null, catalogNames: [] });
  assert.equal(bad.ok, false);
  const empty = planComposeSync({ compose: 'version: "3"\n', dotEnv: null, catalogNames: [] });
  assert.equal(empty.ok, false);
  assert.match(String(empty.error), /services/);
});

test('primary compose file per environment + role', () => {
  assert.equal(primaryComposePath(['.env', 'docker-compose.override.yml', 'docker-compose.yml']), 'docker-compose.yml');
  assert.equal(primaryComposePath(['compose.yaml', 'b-compose.yml', '.env']), 'b-compose.yml');
  assert.equal(primaryComposePath(['.env', '.env_fbl']), null);
  assert.equal(isComposePath('docker-compose.prod.yaml'), true);
  assert.equal(isComposePath('.env'), false);
});
