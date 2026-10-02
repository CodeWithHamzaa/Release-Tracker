import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile, isSecretKey, isEnvFileName } from './envFile.js';
import {
  envDrift,
  normalizeValue,
  composeDrift,
  imageTag,
  imageRepo,
  summarizeCompose,
  versionOf,
  imageChanges,
  lineDiff,
  EnvTokens,
} from './configDrift.js';

test('parseEnvFile: export, quotes, comments, ENC[], duplicates', () => {
  const r = parseEnvFile(
    '﻿# comment\nexport A=1\nB="quoted # not comment"\nC=\'single\'\nD=http://x/#frag\nE=val # trailing\n' +
      'F=ENC[AES256_CBC,data:abc==]\n\nnot a line\nA=2\n'
  );
  const m = Object.fromEntries(r.entries.map((e) => [e.key, e]));
  assert.equal(m.A.value, '2');
  assert.equal(m.B.value, 'quoted # not comment');
  assert.equal(m.C.value, 'single');
  assert.equal(m.D.value, 'http://x/#frag');
  assert.equal(m.E.value, 'val');
  assert.equal(m.F.encrypted, true);
  assert.equal(m.A.encrypted, false);
  assert.deepEqual(r.duplicates, ['A']);
});

test('isSecretKey / isEnvFileName', () => {
  for (const k of ['DB_PASSWORD', 'LIELLM_DB_PASSWORD', 'AZURE_OPENAI_API_KEY', 'JWT_SECRET', 'ACCESS_TOKEN', 'MINIO_ROOT_PASSWORD', 'KEY']) {
    assert.ok(isSecretKey(k), k);
  }
  for (const k of ['AZURE_AGENT_ENDPOINT', 'REDIS_URL', 'LOG_LEVEL', 'KEYCLOAK_HOST', 'MONKEY_MODE']) {
    assert.ok(!isSecretKey(k), k);
  }
  for (const f of ['.env', '.env_fbl', '.poly_env', 'app.env']) assert.ok(isEnvFileName(f), f);
  for (const f of ['docker-compose.yml', 'nginx.conf', 'litellm-config.yaml']) assert.ok(!isEnvFileName(f), f);
});

const tokens: EnvTokens = {
  SIT: [
    { token: '10.42.42.250', placeholder: '<ChatBot IP>' },
    { token: '10.42.42.251', placeholder: '<Database IP>' },
    { token: 'evasit.faysalbank.com', placeholder: '<domain>' },
  ],
  UAT: [
    { token: '10.32.32.158', placeholder: '<ChatBot IP>' },
    { token: '10.42.42.79', placeholder: '<Database IP>' },
    { token: 'evauat.faysalbank.com', placeholder: '<domain>' },
  ],
};

test('normalizeValue matches whole IPs only', () => {
  const t = [{ token: '10.42.42.25', placeholder: '<X>' }];
  assert.equal(normalizeValue('http://10.42.42.250:8080', t), 'http://10.42.42.250:8080');
  assert.equal(normalizeValue('http://10.42.42.25:8080', t), 'http://<X>:8080');
  assert.equal(normalizeValue('https://evasit.faysalbank.com/api', tokens.SIT), 'https://<domain>/api');
});

test('envDrift labels: same, expected (IP/domain only), differs, missing, encrypted', () => {
  const sit = [
    'LOG_LEVEL=info',
    'DB_HOST=10.42.42.251',
    'PUBLIC_URL=https://evasit.faysalbank.com/chat',
    'TIMEOUT=30',
    'ONLY_SIT=1',
    'API_KEY=ENC[a]',
    'MIXED=plain',
  ].join('\n');
  const uat = [
    'LOG_LEVEL=info',
    'DB_HOST=10.42.42.79',
    'PUBLIC_URL=https://evauat.faysalbank.com/chat',
    'TIMEOUT=60',
    'API_KEY=ENC[b]',
    'MIXED=ENC[c]',
  ].join('\n');
  const rows = envDrift({ SIT: sit, UAT: uat, Prod: null }, tokens);
  const label = Object.fromEntries(rows.map((r) => [r.key, r.label]));
  assert.deepEqual(label, {
    API_KEY: 'encrypted',
    DB_HOST: 'expected',
    LOG_LEVEL: 'same',
    MIXED: 'differs',
    ONLY_SIT: 'missing',
    PUBLIC_URL: 'expected',
    TIMEOUT: 'differs',
  });
  assert.equal(rows.find((r) => r.key === 'LOG_LEVEL')!.values.Prod, null);
});

test('imageTag / imageRepo', () => {
  assert.equal(imageTag('registry.local:5000/team/ldap-connector:2.4.2'), '2.4.2');
  assert.equal(imageTag('registry.local:5000/team/ldap-connector'), 'latest');
  assert.equal(imageTag('nginx'), 'latest');
  assert.equal(imageRepo('registry.local:5000/team/ldap-connector:2.4.2'), 'ldap-connector');
  assert.equal(imageTag(null), null);
});

const sitCompose = `services:
  alara-ui2:
    image: registry.local/alara-ui:2.1.4
    container_name: alara-ui2
    ports: ["3000:3000"]
    env_file: [.env, .env_fbl]
  nginx:
    image: nginx:1.0
    ports: ["80:80", "443:443"]
    volumes: ["./nginx.conf:/etc/nginx/nginx.conf"]
`;
const uatCompose = `services:
  alara-ui2:
    image: registry.local/alara-ui:2.1.3
    container_name: alara-ui2
    ports: ["3000:3000"]
    env_file: [.env, .env_fbl]
  nginx:
    image: nginx:1.0
    ports: ["80:80"]
    volumes: ["./nginx.conf:/etc/nginx/nginx.conf"]
  extra:
    image: extra:1
`;

test('composeDrift: tag, ports, env_file, missing service', () => {
  const rows = composeDrift({ SIT: sitCompose, UAT: uatCompose });
  const by = Object.fromEntries(rows.map((r) => [r.service, r]));
  assert.deepEqual(by['alara-ui2'].labels, { image: 'differs', ports: 'same', envFiles: 'same', volumes: 'same' });
  assert.deepEqual(by.nginx.labels, { image: 'same', ports: 'differs', envFiles: 'same', volumes: 'same' });
  assert.equal(by.extra.labels.image, 'missing');
  assert.equal(by['alara-ui2'].perEnv.SIT!.tag, '2.1.4');
  assert.equal(by['alara-ui2'].perEnv.SIT!.envFiles, '.env, .env_fbl');
});

test('versionOf matches by key, container_name or image repository', () => {
  const s = summarizeCompose(sitCompose);
  assert.equal(versionOf(s, 'nginx')!.tag, '1.0');
  assert.equal(versionOf(s, 'alara-ui')!.tag, '2.1.4'); // via image repo
  assert.equal(versionOf(s, 'alara-ui2')!.tag, '2.1.4');
  assert.equal(versionOf(s, 'kafka'), null);
});

test('imageChanges lists only changed or new tags', () => {
  assert.deepEqual(imageChanges(uatCompose, sitCompose), [{ service: 'alara-ui2', from: '2.1.3', to: '2.1.4' }]);
  assert.equal(imageChanges(null, sitCompose).length, 2);
});

test('lineDiff marks added and removed lines', () => {
  const d = lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.deepEqual(
    d.filter((l) => l.type !== 'same'),
    [
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'add', text: 'd' },
    ]
  );
});
