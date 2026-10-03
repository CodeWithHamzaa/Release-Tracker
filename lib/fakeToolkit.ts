// Test support only (not imported by the app): a stand-in ALARA toolkit for
// running the generated scripts in a temp folder. alara_common.sh here has
// the same function names and the same detection rule as the real one (role
// and environment from the machine's IPs; ALARA_TEST_IPS simulates them), with
// a two-role address table. The REAL toolkit scripts are exercised separately
// (see the receipts tests); nothing of the toolkit is copied into this repo.

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FAKE_COMMON = `#!/usr/bin/env bash
# test double of alara_common.sh
ALARA_HOME="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ALARA_IP_TABLE=(
  "CHAT_BOT|ChatBot / NLU|10.42.42.250|10.32.32.158|10.0.11.72"
  "DATABASE|Database|10.42.42.251|10.42.42.79|10.0.8.57"
)
alara_get_ip() {
  local x r l sit uat prod
  for x in "\${ALARA_IP_TABLE[@]}"; do
    IFS='|' read -r r l sit uat prod <<< "$x"
    if [[ "$r" == "$1" ]]; then
      case "$2" in SIT) echo "$sit" ;; UAT) echo "$uat" ;; PROD) echo "$prod" ;; *) return 1 ;; esac
      return 0
    fi
  done
  return 1
}
alara_get_domain() {
  [[ "$1" == "EVA" ]] || return 1
  case "$2" in SIT) echo evasit.faysalbank.com ;; UAT) echo evauat.faysalbank.com ;; PROD) echo eva.faysalbank.com ;; *) return 1 ;; esac
}
alara_detect() {
  local ip x r l sit uat prod
  for ip in $(echo "\${ALARA_TEST_IPS:-}" | tr ',' ' '); do
    for x in "\${ALARA_IP_TABLE[@]}"; do
      IFS='|' read -r r l sit uat prod <<< "$x"
      [[ "$ip" == "$sit" ]] && { ALARA_ROLE="$r"; ALARA_ENV=SIT; return 0; }
      [[ "$ip" == "$uat" ]] && { ALARA_ROLE="$r"; ALARA_ENV=UAT; return 0; }
      [[ "$ip" == "$prod" ]] && { ALARA_ROLE="$r"; ALARA_ENV=PROD; return 0; }
    done
  done
  echo "[ERROR] could not detect role/environment" >&2
  exit 2
}
alara_detect
export ALARA_ROLE ALARA_ENV
`;

export interface FakeToolkitOptions {
  version?: string; // alara_server.sh SERVER_VERSION
  applyExit?: number; // exit code of "patch apply"
}

// alara_server.sh logs every call to calls.log; "patch apply" exits applyExit.
export function installFakeToolkit(compose: string, opts: FakeToolkitOptions = {}) {
  mkdirSync(join(compose, 'alara'), { recursive: true });
  writeFileSync(join(compose, 'alara', 'alara_common.sh'), FAKE_COMMON);
  writeFileSync(
    join(compose, 'alara_server.sh'),
    `#!/bin/sh\nSERVER_VERSION="${opts.version ?? '2.6'}"\necho "$*" >> calls.log\n[ "$1 $2" = "patch apply" ] && exit ${opts.applyExit ?? 0}\nexit 0\n`
  );
  chmodSync(join(compose, 'alara_server.sh'), 0o755);
}
