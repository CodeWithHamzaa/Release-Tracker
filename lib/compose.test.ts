import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompose, findPortConflicts, interpolate } from './compose.js';

const hostPorts = (text: string, vars?: Record<string, string>) =>
  parseCompose(text, vars).services.map((s) => ({
    name: s.name,
    ports: s.ports.map((p) => `${p.hostIp ? p.hostIp + ':' : ''}${p.hostPort}:${p.containerPort}/${p.protocol}`),
  }));

test('short syntax: host:container, host ip, udp, container-only', () => {
  const { services, warnings } = parseCompose(`
services:
  nginx:
    image: nginx:1.25
    container_name: nginx
    ports:
      - "80:80"
      - 127.0.0.1:8443:443
      - "5353:53/udp"
      - "9000"
      - 3000
`);
  assert.deepEqual(warnings, []);
  assert.equal(services[0].image, 'nginx:1.25');
  assert.equal(services[0].containerName, 'nginx');
  assert.deepEqual(hostPorts('services:\n  n:\n    ports: ["80:80", "127.0.0.1:8443:443", "5353:53/udp"]')[0].ports, [
    '80:80/tcp',
    '127.0.0.1:8443:443/tcp',
    '5353:53/udp',
  ]);
  assert.deepEqual(services[0].internalPorts, ['9000/tcp', '3000/tcp']);
});

test('ranges expand one-to-one', () => {
  assert.deepEqual(hostPorts('services:\n  k:\n    ports: ["9092-9094:9092-9094"]')[0].ports, [
    '9092:9092/tcp',
    '9093:9093/tcp',
    '9094:9094/tcp',
  ]);
});

test('long syntax, with and without published', () => {
  const r = parseCompose(`
services:
  api:
    ports:
      - target: 8080
        published: "18080"
        protocol: tcp
        host_ip: 0.0.0.0
      - target: 9229
`);
  assert.deepEqual(r.services[0].ports, [{ hostPort: 18080, containerPort: 8080, protocol: 'tcp', hostIp: '0.0.0.0' }]);
  assert.deepEqual(r.services[0].internalPorts, ['9229/tcp']);
});

test('variables: defaults resolve, unset variables warn and skip', () => {
  const text = `
services:
  redis:
    image: redis:\${REDIS_TAG:-7.2-alpine}
    ports:
      - "\${REDIS_PORT:-6379}:6379"
      - "\${METRICS_PORT}:9121"
`;
  const r = parseCompose(text);
  assert.equal(r.services[0].image, 'redis:7.2-alpine');
  assert.deepEqual(r.services[0].ports.map((p) => p.hostPort), [6379]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /METRICS_PORT/);

  const withVars = parseCompose(text, { METRICS_PORT: '9121', REDIS_PORT: '16379' });
  assert.deepEqual(withVars.services[0].ports.map((p) => p.hostPort), [16379, 9121]);
  assert.deepEqual(withVars.warnings, []);
});

test('interpolate: ${A-x} keeps an empty value, ${A:-x} does not', () => {
  assert.equal(interpolate('${A-x}', { A: '' }), '');
  assert.equal(interpolate('${A:-x}', { A: '' }), 'x');
  assert.equal(interpolate('$A/$B', { A: '1', B: '2' }), '1/2');
  assert.equal(interpolate('${MISSING}'), null);
});

test('network_mode host, expose, anchors/merge keys', () => {
  const r = parseCompose(`
x-common: &common
  restart: always
  ports: ["7000:7000"]
services:
  a:
    <<: *common
    image: a:1
  b:
    network_mode: host
    expose: ["8000"]
`);
  assert.deepEqual(r.services[0].ports.map((p) => p.hostPort), [7000]);
  assert.equal(r.services[1].hostNetwork, true);
  assert.deepEqual(r.services[1].internalPorts, ['8000']);
  assert.equal(r.warnings.length, 1);
});

test('invalid input is reported, not thrown', () => {
  assert.match(parseCompose('services: [').warnings[0], /Not valid YAML/);
  assert.match(parseCompose('version: "3"').warnings[0], /services/);
  assert.match(parseCompose('services:\n  a:\n    ports: ["abc:80"]').warnings[0], /could not read port/);
});

test('findPortConflicts: same env+host+port+protocol across different services', () => {
  const conflicts = findPortConflicts([
    { service: 'nginx', environment: 'SIT', host: 'sit-01', hostPort: 80, protocol: 'tcp' },
    { service: 'alara-ui', environment: 'SIT', host: 'sit-01', hostPort: 80, protocol: 'TCP' },
    { service: 'nginx', environment: 'SIT', host: 'sit-01', hostPort: 443, protocol: 'tcp' },
    { service: 'nginx', environment: 'SIT', host: 'sit-01', hostPort: 443, protocol: 'tcp' }, // same service twice
    { service: 'dns', environment: 'SIT', host: 'sit-01', hostPort: 80, protocol: 'udp' }, // other protocol
    { service: 'mcpherson-ui', environment: 'SIT', host: 'sit-02', hostPort: 80, protocol: 'tcp' }, // other host
    { service: 'x', environment: 'UAT', host: 'sit-01', hostPort: 80, protocol: 'tcp' }, // other env
  ]);
  assert.deepEqual(conflicts, [
    { environment: 'SIT', host: 'sit-01', hostPort: 80, protocol: 'tcp', services: ['nginx', 'alara-ui'] },
  ]);
});
