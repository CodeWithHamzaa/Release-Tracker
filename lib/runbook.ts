// Patch runbook generator for the ALARA toolkit.
//
// The tracker never runs anything on a server. It writes out the steps for
// `alara_server.sh patch` (alara_patch.sh v1.0, shipped with alara_server.sh
// v2.5+) and, optionally, a small bash wrapper whose only job is to refuse to
// run on the wrong server before handing over to the toolkit.
//
// Command syntax follows README_alara_patch.md v1.0:
//   ./alara_server.sh patch list | plan <ID> | apply <ID> | rollback [<RECORD>]
// Exit codes of `patch apply`: 0 ok / 1 rolled back / 2 refused / 3 manual.

export interface RunbookServer {
  ip: string | null;
  domain: string | null;
  composePath: string | null;
  runAs: string | null;
  access: string | null;
  envFiles: string[];
  toolkitVersion: string | null;
}

export interface RunbookInput {
  environment: string; // SIT | UAT | Prod
  role: string; // Bot-Builder | ChatBot / NLU | Database | Chat-Service
  patchId: string;
  services: { service: string; version: string }[];
  server: RunbookServer | null;
  generatedAt?: Date;
}

export interface RunbookStep {
  title: string;
  commands: string[];
  notes: string[];
}

export interface Runbook {
  title: string;
  warnings: string[];
  steps: RunbookStep[];
  syncLine: string;
}

// Same rule as a folder name under alara/patches/incoming/.
export const PATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function isProd(environment: string): boolean {
  return environment.trim().toUpperCase() === 'PROD';
}

// Short role name used in the knowledge index (section 1.2).
export function indexRole(role: string): string {
  return role === 'ChatBot / NLU' ? 'ChatBot' : role;
}

export function indexEnv(environment: string): string {
  return environment.trim().toUpperCase();
}

// Quote for bash: everything inside single quotes is literal.
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function dateStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function syncLineFor(input: RunbookInput): string {
  const what = input.services.map((s) => `${s.service} ${s.version}`).join(', ');
  const date = dateStamp(input.generatedAt ?? new Date());
  return `${date} | ${indexEnv(input.environment).padEnd(4)} | ${indexRole(input.role).padEnd(12)} | patch ${input.patchId}: ${what}`;
}

export function buildRunbook(input: RunbookInput): Runbook {
  const prod = isProd(input.environment);
  const s = input.server;
  const where = `${indexEnv(input.environment)} / ${input.role}${s?.ip ? ` (${s.ip})` : ''}`;
  const dir = s?.composePath || '<compose folder>';
  const incoming = `${dir.replace(/\/+$/, '')}/alara/patches/incoming/${input.patchId}/`;
  const warnings: string[] = [];

  if (!PATCH_ID_PATTERN.test(input.patchId)) {
    warnings.push('PATCH_ID must be letters, digits, dot, dash or underscore (it is a folder name).');
  }
  if (!s) warnings.push(`No server registry entry for ${where}. Add it on the Catalog page.`);
  if (s && !s.ip) warnings.push('Server IP unknown: the downloadable script cannot check it is on the right server.');
  if (s && !s.composePath) warnings.push('Compose folder unknown (unverified): run from the folder holding docker-compose.yml.');
  if (s && !s.runAs) warnings.push('Run-as account unknown (unverified).');
  if (prod) warnings.push('PROD: apply asks you to type PROD, and --yes is refused.');

  const steps: RunbookStep[] = [];

  steps.push({
    title: 'Before you start',
    commands: [],
    notes: [
      ...(input.environment.toUpperCase() !== 'SIT'
        ? ['Request the bank jump-server session. Plan every step below so the one session covers it.']
        : [`Access: ${s?.access || 'Jump server 10.200.200.20 (SSH/SFTP)'}.`]),
      'Not during an active incident: no patch, encrypt, decrypt, generate or deploy.',
      'Tars must be saved by name: docker save repo:tag -o file.tar (a tar saved by image ID is refused).',
      'Optional: put a SHA256SUMS file next to the tars (sha256sum *.tar > SHA256SUMS); it is verified if present.',
      `This patch expects: ${input.services.map((x) => `${x.service} ${x.version}`).join(', ') || '(no services selected)'}.`,
    ],
  });

  steps.push({
    title: 'Copy the tars (WinSCP)',
    commands: [],
    notes: [
      `Upload the .tar / .tar.gz / .tgz files to ${incoming}`,
      'The same folder can go to all four servers; each applies only the images its own compose uses.',
    ],
  });

  steps.push({
    title: 'Open the compose folder and check the toolkit',
    commands: [
      ...(s?.runAs ? [`whoami   # expect ${s.runAs}`] : []),
      ...(s?.ip ? [`hostname -I   # expect ${s.ip}`] : []),
      `cd ${s?.composePath ? shellQuote(s.composePath) : '<compose folder>'}`,
      './alara_server.sh doctor',
    ],
    notes: [
      'doctor must list alara_patch.sh as ok. The patch command needs alara_server.sh v2.5 or newer;' +
        (s?.toolkitVersion ? ` registry says ${s.toolkitVersion}.` : ' installed version unverified.'),
    ],
  });

  steps.push({
    title: 'Preview (changes nothing)',
    commands: ['./alara_server.sh patch list', `./alara_server.sh patch plan ${input.patchId}`],
    notes: ['Check the plan table and compose diff match the expected services above.'],
  });

  steps.push({
    title: 'Apply',
    commands: [`./alara_server.sh patch apply ${input.patchId}`],
    notes: [
      prod ? 'Type PROD when asked. Do not use --yes (refused on PROD).' : "Type yes when asked.",
      'Health gate: services running before must run again, patched ones on the new image, 30 s stable. Default timeout 600 s (--timeout SEC).',
      'Exit code: 0 applied · 1 health gate failed, rolled back · 2 refused before any change · 3 rollback failed or disabled, act manually.',
    ],
  });

  steps.push({
    title: 'Verify',
    commands: ['./alara_server.sh status', "grep -n 'image:' docker-compose.yml"],
    notes: ['Mark the release records SUCCESS or FAILED in the tracker.'],
  });

  steps.push({
    title: 'If you need to undo',
    commands: [
      './alara_server.sh patch rollback',
      `./alara_server.sh patch rollback <STAMP>_${input.patchId}`,
    ],
    notes: [
      'Manual fallback: cp alara/patches/applied/<RECORD>/docker-compose.yml.before docker-compose.yml && ./alara_server.sh restart',
      'Do not docker image prune until the patch is signed off. After sign-off remove any <repo>:alara-rollback-<stamp> tags.',
    ],
  });

  const syncLine = syncLineFor(input);
  steps.push({
    title: 'Record it',
    commands: [],
    notes: [`Add to section 1.2 of the knowledge index: ${syncLine}`],
  });

  return { title: `Patch ${input.patchId} on ${where}`, warnings, steps, syncLine };
}

export function runbookMarkdown(input: RunbookInput): string {
  const rb = buildRunbook(input);
  const lines = [`# ${rb.title}`, ''];
  if (rb.warnings.length) {
    lines.push(...rb.warnings.map((w) => `> ⚠ ${w}`), '');
  }
  rb.steps.forEach((step, i) => {
    lines.push(`## ${i + 1}. ${step.title}`, '');
    if (step.commands.length) lines.push('```bash', ...step.commands, '```', '');
    lines.push(...step.notes.map((n) => `- ${n}`), '');
  });
  return lines.join('\n');
}

// A bash wrapper that only proceeds on the intended server, then hands over
// to alara_server.sh. Requires a known IP: without one it cannot guard.
export function runbookScript(input: RunbookInput): string {
  const s = input.server;
  if (!s?.ip) throw new Error('A server IP is required for the environment guard.');
  if (!PATCH_ID_PATTERN.test(input.patchId)) throw new Error('Invalid PATCH_ID.');
  const generated = (input.generatedAt ?? new Date()).toISOString();
  const expected = input.services.map((x) => `#   ${x.service} ${x.version}`).join('\n') || '#   (none selected)';

  return `#!/usr/bin/env bash
# ALARA patch runbook, generated by Release Tracker at ${generated}
# Patch ${input.patchId} on ${indexEnv(input.environment)} / ${input.role} (${s.ip})
# Expected images:
${expected}
#
# Copy the tars to alara/patches/incoming/${input.patchId}/ first.
# If you edited this file on Windows, run: sed -i 's/\\r$//' <this file>
set -euo pipefail
trap 'echo "ABORTED at line $LINENO. Nothing after this point ran." >&2' ERR

PATCH_ID=${shellQuote(input.patchId)}
EXPECTED_IP=${shellQuote(s.ip)}
EXPECTED_USER=${shellQuote(s.runAs || '')}
COMPOSE_DIR=${shellQuote(s.composePath || '')}

die() { echo "REFUSED: $*" >&2; exit 2; }

# 1. Environment guard: this file only runs on the server it was made for.
HOST_IPS="$( (hostname -I 2>/dev/null || ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1) | tr ' ' '\\n')"
grep -qxF "$EXPECTED_IP" <<<"$HOST_IPS" || die "this runbook is for $EXPECTED_IP (${indexEnv(input.environment)} / ${input.role}); this host has: $(echo $HOST_IPS)"
if [ -n "$EXPECTED_USER" ] && [ "$(id -un)" != "$EXPECTED_USER" ]; then
  die "run as $EXPECTED_USER (you are $(id -un))"
fi

# 2. Compose folder, toolkit and tars present.
if [ -n "$COMPOSE_DIR" ]; then cd "$COMPOSE_DIR"; fi
[ -f docker-compose.yml ] || die "no docker-compose.yml in $(pwd); cd to the compose folder or set it in the tracker"
[ -x ./alara_server.sh ] || die "./alara_server.sh not found or not executable in $(pwd)"
[ -d "alara/patches/incoming/$PATCH_ID" ] || die "copy the tars to alara/patches/incoming/$PATCH_ID/ first"

# 3. Toolkit health, then a preview that changes nothing.
./alara_server.sh doctor
./alara_server.sh patch plan "$PATCH_ID"

read -r -p "Review the plan above. Type 'apply' to continue: " answer
[ "$answer" = "apply" ] || { echo "Stopped before any change."; exit 0; }

# 4. Apply. alara_server.sh asks its own confirmation${isProd(input.environment) ? ' (type PROD)' : ''}.
set +e
./alara_server.sh patch apply "$PATCH_ID"
rc=$?
set -e
case "$rc" in
  0) echo "Patch applied." ;;
  1) echo "Health gate failed: rolled back automatically, server is on the old images." ;;
  2) echo "Refused before any change (bad tar, checksum, conflict, lock, ...)." ;;
  3) echo "FAILED and rollback failed or was disabled: MANUAL ACTION NEEDED." ;;
  *) echo "patch apply exited with $rc." ;;
esac

# 5. Show the result.
./alara_server.sh status || true
grep -n 'image:' docker-compose.yml || true
exit "$rc"
`;
}
