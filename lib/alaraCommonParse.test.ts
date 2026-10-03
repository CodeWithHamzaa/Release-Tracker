import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAlaraCommon, registryChanges, RegistryNode } from './alaraCommonParse.js';

// Same shape as the toolkit's alara_common.sh v2.4, with made-up addresses.
const COMMON = `#!/usr/bin/env bash
# =============================================================================
#            ALARA Common Library — Role & Environment Auto-Detection
#                                v2.4
# =============================================================================
ALARA_EXPECTED_KEY_FP="3f9a0c1d2b4e5f60"

ALARA_IP_TABLE=(
    "BOT_BUILDER|Bot-Builder|10.1.1.11|10.2.2.11|10.3.3.11"
    "CHAT_BOT|ChatBot / NLU|10.1.1.12|10.2.2.12|10.3.3.12"
    "DATABASE|Database|10.1.1.13|10.1.1.99|10.3.3.13"
    "CHAT_SERVICE|Chat-Service|10.1.1.14|10.2.2.14|10.3.3.14"
)
ALARA_DOMAIN_TABLE=(
    "EVA|evasit.example.com|evauat.example.com|eva.example.com"
)
alara_env_files_for_role() {
    case "$1" in
        DATABASE)      echo ".env" ;;
        CHAT_SERVICE)  echo ".env" ;;
        CHAT_BOT)      echo ".env_fbl .env" ;;
        BOT_BUILDER)   echo ".env .env_fbl .poly_env" ;;
        *)             echo "" ;;
    esac
}
`;

test('parses version, IP matrix, domains, env files and the key fingerprint', () => {
  const c = parseAlaraCommon(COMMON);
  assert.equal(c.version, '2.4');
  assert.equal(c.expectedKeyFp, '3f9a0c1d2b4e5f60');
  assert.deepEqual(c.roles.map((r) => [r.code, r.role]), [
    ['BOT_BUILDER', 'Bot-Builder'], ['CHAT_BOT', 'ChatBot / NLU'], ['DATABASE', 'Database'], ['CHAT_SERVICE', 'Chat-Service'],
  ]);
  assert.deepEqual(c.roles[2].ips, { SIT: '10.1.1.13', UAT: '10.1.1.99', PROD: '10.3.3.13' }); // UAT Database on another subnet is kept
  assert.deepEqual(c.domains, [{ name: 'EVA', domains: { SIT: 'evasit.example.com', UAT: 'evauat.example.com', PROD: 'eva.example.com' } }]);
  assert.deepEqual(c.envFiles.CHAT_BOT, ['.env_fbl', '.env']);
  assert.deepEqual(c.envFiles.BOT_BUILDER, ['.env', '.env_fbl', '.poly_env']);
  assert.equal(c.envFiles['*'], undefined);
});

test('an unstamped file has no fingerprint; junk and bad rows are ignored, never thrown', () => {
  const c = parseAlaraCommon(COMMON.replace('3f9a0c1d2b4e5f60', ''));
  assert.equal(c.expectedKeyFp, null);
  const junk = parseAlaraCommon('hello\nALARA_IP_TABLE=(\n "X|Only|not-an-ip|1|2"\n)\n');
  assert.deepEqual(junk.roles, []);
  assert.equal(parseAlaraCommon('').version, null);
});

test('registryChanges lists only what differs from the toolkit', () => {
  const c = parseAlaraCommon(COMMON);
  const nodes: RegistryNode[] = [
    { id: 'a', environment: 'SIT', role: 'ChatBot / NLU', ip: '10.1.1.12', domain: 'evasit.example.com', envFiles: ['.env_fbl', '.env'] }, // all agree
    { id: 'b', environment: 'UAT', role: 'ChatBot / NLU', ip: '10.9.9.9', domain: null, envFiles: [] }, // ip wrong, domain and files missing
    { id: 'c', environment: 'Prod', role: 'Database', ip: null, domain: 'eva.example.com', envFiles: ['.env'] },
    { id: 'd', environment: 'SIT', role: 'Unknown role', ip: null, domain: null, envFiles: [] }, // not in the toolkit: ignored
  ];
  const ch = registryChanges(c, nodes);
  assert.deepEqual(ch.filter((x) => x.id === 'a'), []);
  assert.deepEqual(ch.filter((x) => x.id === 'b').map((x) => [x.field, x.current, x.fromToolkit]), [
    ['ip', '10.9.9.9', '10.2.2.12'], ['domain', null, 'evauat.example.com'], ['envFiles', null, '.env_fbl, .env'],
  ]);
  assert.deepEqual(ch.filter((x) => x.id === 'c').map((x) => [x.field, x.fromToolkit]), [['ip', '10.3.3.13']]);
  assert.equal(ch.some((x) => x.id === 'd'), false);
  assert.deepEqual(ch.find((x) => x.id === 'b' && x.field === 'ip')!.patch, { ip: '10.2.2.12' });
});
