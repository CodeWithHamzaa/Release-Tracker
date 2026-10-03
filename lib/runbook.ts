// Patch runbook generator for the ALARA toolkit.
//
// The tracker never runs anything on a server. It writes out the steps for
// `alara_server.sh patch` (alara_patch.sh v1.0, shipped with alara_server.sh
// v2.5+) and, optionally, a small bash wrapper whose only job is to refuse to
// run on the wrong server before handing over to the toolkit.
//
// Generated scripts follow the same contract as the toolkit's alara_deploy.sh:
//   --env ENV     required; must match the environment the script was made for
//                 AND the one the toolkit detects (alara_common.sh)
//   --dry-run     preview only (`patch plan`), change nothing
//   --timeout SEC passed to `patch apply` (health gate timeout)
//   --receipt ID  write the receipt for an existing patch record, nothing else
// and the toolkit's exit codes (0 ok / 1 rolled back / 2 refused / 3 manual)
// are passed through. After a run the script writes a small receipt file
// (alara/receipts/<PATCH_ID>_<stamp>.json) that packages the toolkit's own
// patch record (see receiptHelpers); uploading it closes the loop in the
// tracker. Who-is-this-server logic is NOT duplicated here: the
// script sources alara/alara_common.sh and compares what it says.
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

// Role codes used by the toolkit's alara_common.sh (ALARA_ROLE).
const ROLE_CODE_BY_NAME: Record<string, string> = {
  'Bot-Builder': 'BOT_BUILDER',
  'ChatBot / NLU': 'CHAT_BOT',
  Database: 'DATABASE',
  'Chat-Service': 'CHAT_SERVICE',
};

export function roleCode(role: string): string {
  return ROLE_CODE_BY_NAME[role] ?? role.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
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
  if (!s) warnings.push(`No server registry entry for ${where}. Add it on the Infrastructure page.`);
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
      `Prefer the downloaded script: it checks it is on the right server, then runs the same commands. Try it with --dry-run first: bash <file>.sh --env ${indexEnv(input.environment)} --dry-run`,
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

// Shared by every generated script (patch runbook, promotion export/import).
// Defines the expected server, die(), the option parser (--env / --dry-run /
// --timeout) and the account check. Ends with a newline.
export interface ScriptTarget {
  environment: string; // tracker label (SIT | UAT | Prod)
  role: string; // tracker role name
  server: RunbookServer | null; // registry entry, used only for account + folder
  noun?: string; // "runbook" | "script" in messages
  receipt?: boolean; // accept --receipt RECORD_ID (scripts that write receipts)
}

export function scriptGuard(t: ScriptTarget): string {
  const env = indexEnv(t.environment);
  const noun = t.noun ?? 'script';
  return `EXPECTED_ENV=${shellQuote(env)}
EXPECTED_ROLE=${shellQuote(roleCode(t.role))}
EXPECTED_USER=${shellQuote(t.server?.runAs || '')}
COMPOSE_DIR=${shellQuote(t.server?.composePath || '')}

die() { echo "REFUSED: $*" >&2; exit 2; }

# Options (same names as the toolkit's alara_deploy.sh).
ENV_ARG=""; DRY_RUN=0; TIMEOUT=""; RECEIPT_FOR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env)     [ $# -ge 2 ] || die "--env needs a value"; ENV_ARG="$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --timeout) [ $# -ge 2 ] || die "--timeout needs a value"; TIMEOUT="$2"; shift 2 ;;
${t.receipt ? `    --receipt) [ $# -ge 2 ] || die "--receipt needs a record id"; RECEIPT_FOR="$2"; shift 2 ;;
` : ''}    --yes|-y)  die "--yes is not supported here (the toolkit refuses it on PROD)" ;;
    -h|--help) echo "usage: bash $0 --env $EXPECTED_ENV [--dry-run] [--timeout SEC]${t.receipt ? ' [--receipt RECORD_ID]' : ''}"; exit 0 ;;
    *)         die "unknown option: $1 (try --help)" ;;
  esac
done

# 1. This ${noun} is for one environment, and you have to say which.
[ -n "$ENV_ARG" ] || die "--env is required: this ${noun} is for $EXPECTED_ENV (bash $0 --env $EXPECTED_ENV)"
[ "$ENV_ARG" = "$EXPECTED_ENV" ] || die "you said --env $ENV_ARG, but this ${noun} was made for $EXPECTED_ENV"
case "$TIMEOUT" in
  ''|*[!0-9]*) [ -z "$TIMEOUT" ] || die "--timeout must be a number of seconds" ;;
esac
if [ -n "$EXPECTED_USER" ] && [ "$(id -un)" != "$EXPECTED_USER" ]; then
  die "run as $EXPECTED_USER (you are $(id -un))"
fi
`;
}

// cd into the compose folder (when known), check the toolkit is there and let
// the toolkit itself say which server this is: alara_common.sh detects role
// and environment from the machine's IPs, so the tracker does not duplicate
// that. Needs EXPECTED_ENV / EXPECTED_ROLE from scriptGuard().
export function composeChecks(opts: { patch?: boolean } = {}): string {
  const patch = opts.patch ?? true;
  return `if [ -n "$COMPOSE_DIR" ]; then cd "$COMPOSE_DIR"; fi
[ -f docker-compose.yml ] || die "no docker-compose.yml in $(pwd); cd to the compose folder or set it in the tracker"
[ -x ./alara_server.sh ] || die "./alara_server.sh not found or not executable in $(pwd)"
[ -f alara/alara_common.sh ] || die "alara/alara_common.sh not found in $(pwd): is the ALARA toolkit installed?"

# 2. Ask the toolkit which server this is (alara_common.sh, from this machine's IPs).
TK="$(ALARA_WORKDIR="$PWD" bash -c '. alara/alara_common.sh >/dev/null 2>&1 || exit 2; printf "%s|%s" "$ALARA_ENV" "$ALARA_ROLE"')" \\
  || die "the toolkit could not identify this server (alara/alara_common.sh)"
[ "$TK" = "$EXPECTED_ENV|$EXPECTED_ROLE" ] \\
  || die "this script is for $EXPECTED_ENV / $EXPECTED_ROLE, but the toolkit says this server is \${TK/|/ / }"
${patch ? `
# 3. The patch command arrived in alara_server.sh v2.5.
TK_VER="$(grep -m1 '^SERVER_VERSION=' alara_server.sh | cut -d'"' -f2)"
if [ -z "$TK_VER" ] || [ "$(printf '%s\\n%s\\n' "$TK_VER" 2.5 | sort -V | head -1)" != "2.5" ]; then
  die "alara_server.sh v\${TK_VER:-?} has no 'patch' command (needs v2.5 or newer): install the toolkit update first"
fi` : ''}`;
}

// Bash that writes the deployment receipt. A receipt is ONE small JSON file,
// alara/receipts/<PATCH_ID>_<stamp>.json (0600), that carries the toolkit's
// own record of the run (alara/patches/applied/<STAMP>_<PATCH_ID>/: RESULT,
// plan.txt, images.txt, tars.sha256, state.after, compose.diff, word for word)
// plus who/where/when. No logs. Nothing is measured here: the toolkit already
// recorded it. JSON is written with sed/tr only (no jq on the servers).
//
// Needs from the script: PATCH_ID, EXPECTED_ENV, EXPECTED_ROLE, and (for the
// promotion script) the ADDED array of "file:KEY" env keys it appended.
export function receiptHelpers(scriptKind: 'runbook' | 'promotion-target'): string {
  return `
# ── Deployment receipt ───────────────────────────────────────────────────────
SCRIPT_KIND=${shellQuote(scriptKind)}
STARTED_AT="$(date -Iseconds)"
ADDED=()
APPLIED_DIR="alara/patches/applied"

# JSON string from stdin: control characters dropped, \\ " tab and newlines escaped.
json_str() {
  printf '"'
  tr -d '\\000-\\010\\013-\\037' | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g' -e 's/\\t/\\\\t/g' | sed -e ':a' -e 'N' -e '$!ba' -e 's/\\n/\\\\n/g' | tr -d '\\n'
  printf '"'
}

# write_receipt <exit code> <outcome> [record dir]
#   outcome: recorded (the toolkit wrote a patch record) | nothing-applicable |
#            refused | env-restarted | failed
write_receipt() {
  trap - ERR; set +e +o pipefail
  local rc="$1" outcome="$2" rec="\${3:-}" out f first s
  mkdir -p alara/receipts 2>/dev/null; chmod 700 alara/receipts 2>/dev/null
  out="alara/receipts/\${PATCH_ID}_$(date +%Y%m%d_%H%M%S).json"
  (
    umask 077
    {
      printf '{"format":"alara-receipt/1","generator":"release-tracker"'
      printf ',"script":'; printf '%s' "$SCRIPT_KIND" | json_str
      printf ',"patchId":'; printf '%s' "$PATCH_ID" | json_str
      printf ',"environment":'; printf '%s' "$EXPECTED_ENV" | json_str
      printf ',"role":'; printf '%s' "$EXPECTED_ROLE" | json_str
      printf ',"host":'; hostname 2>/dev/null | json_str
      printf ',"user":'; id -un | json_str
      printf ',"scriptSha256":'; sha256sum "$0" 2>/dev/null | cut -d' ' -f1 | json_str
      printf ',"startedAt":'; printf '%s' "$STARTED_AT" | json_str
      printf ',"finishedAt":'; date -Iseconds | json_str
      printf ',"exitCode":%s' "$rc"
      printf ',"outcome":'; printf '%s' "$outcome" | json_str
      printf ',"recordId":'; if [ -n "$rec" ]; then basename "$rec" | json_str; else printf 'null'; fi
      printf ',"envAdded":['; first=1
      for s in \${ADDED[@]+"\${ADDED[@]}"}; do [ "$first" = 1 ] || printf ','; first=0; printf '%s' "$s" | json_str; done
      printf ']'
      printf ',"files":{'; first=1
      for f in RESULT plan.txt images.txt tars.sha256 state.after compose.diff; do
        [ "$first" = 1 ] || printf ','; first=0
        printf '"%s":' "$f"
        if [ -n "$rec" ] && [ -f "$rec/$f" ]; then json_str < "$rec/$f"; else printf 'null'; fi
      done
      printf '}}\\n'
    } > "$out"
  )
  chmod 600 "$out" 2>/dev/null
  echo
  echo "Receipt written: $out"
  echo "Copy it back (WinSCP) and upload it in Release Tracker: Health > Add reports."
  return 0
}

# Names of this patch's records, so the one a run creates can be told apart.
patch_records() { ls -1d "$APPLIED_DIR"/*_"$PATCH_ID" 2>/dev/null | sort || true; }
new_patch_record() { # <records before>  -> the newest record created since
  comm -13 <(printf '%s\\n' "$1") <(patch_records) | tail -1
}

# --receipt <record id>: write the receipt for an existing record (e.g. after a
# manual 'patch rollback'). The exit code is derived from the record's RESULT.
rebuild_receipt() {
  local id="$1" rec res rc
  case "$id" in ''|*/*|*..*) die "--receipt needs a record id such as 20261003_120000_$PATCH_ID (see: ./alara_server.sh patch list)" ;; esac
  rec="$APPLIED_DIR/$id"
  [ -d "$rec" ] || die "no such patch record: $rec"
  res="$(grep '^RESULT=' "$rec/RESULT" 2>/dev/null | tail -1 | cut -d= -f2)"
  case "$res" in SUCCESS) rc=0 ;; ROLLED_BACK*) rc=1 ;; *) rc=3 ;; esac
  write_receipt "$rc" recorded "$rec"
}
`;
}

// A bash wrapper that only proceeds on the intended server, then hands over
// to alara_server.sh. The toolkit does the preview and confirmation itself.
export function runbookScript(input: RunbookInput): string {
  const s = input.server;
  if (!PATCH_ID_PATTERN.test(input.patchId)) throw new Error('Invalid PATCH_ID.');
  const generated = (input.generatedAt ?? new Date()).toISOString();
  const expected = input.services.map((x) => `#   ${x.service} ${x.version}`).join('\n') || '#   (none selected)';
  const env = indexEnv(input.environment);

  return `#!/usr/bin/env bash
# ALARA patch runbook, generated by Release Tracker at ${generated}
# Patch ${input.patchId} on ${env} / ${input.role}${s?.ip ? ` (${s.ip})` : ''}
# Expected images:
${expected}
#
# Copy the tars to alara/patches/incoming/${input.patchId}/ first.
# Run:  bash <this file> --env ${env} [--dry-run] [--timeout SEC] [--receipt RECORD_ID]
#   --dry-run   preview only (alara_server.sh patch plan), changes nothing
#   --receipt   write the receipt for an existing patch record, nothing else
# After a run it writes alara/receipts/<PATCH_ID>_<time>.json: copy it back and
# upload it in Release Tracker (Health > Add reports) to close the records.
# If you edited this file on Windows, run: sed -i 's/\\r$//' <this file>
set -euo pipefail
trap 'echo "ABORTED at line $LINENO. Nothing after this point ran." >&2' ERR

PATCH_ID=${shellQuote(input.patchId)}
${scriptGuard({ environment: input.environment, role: input.role, server: s, noun: 'runbook', receipt: true })}
# Compose folder, toolkit and server identity.
${composeChecks()}
${receiptHelpers('runbook')}
if [ -n "$RECEIPT_FOR" ]; then rebuild_receipt "$RECEIPT_FOR"; exit 0; fi
[ -d "alara/patches/incoming/$PATCH_ID" ] || die "copy the tars to alara/patches/incoming/$PATCH_ID/ first"

# Preview only? alara_server.sh patch plan shows the plan and the compose diff.
if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN: nothing will be changed."
  ./alara_server.sh patch plan "$PATCH_ID"
  exit 0
fi

# Apply. The toolkit shows the plan and asks for its own confirmation${isProd(input.environment) ? ' (type PROD)' : ''}.
APPLY_ARGS=()
[ -z "$TIMEOUT" ] || APPLY_ARGS+=(--timeout "$TIMEOUT")
BEFORE_RECORDS="$(patch_records)"
set +e
./alara_server.sh patch apply "$PATCH_ID" \${APPLY_ARGS[@]+"\${APPLY_ARGS[@]}"}
rc=$?
set -e
NEW_RECORD="$(new_patch_record "$BEFORE_RECORDS")"
if [ -n "$NEW_RECORD" ]; then outcome=recorded
elif [ "$rc" = 0 ]; then outcome=nothing-applicable
elif [ "$rc" = 2 ]; then outcome=refused
else outcome=failed; fi
write_receipt "$rc" "$outcome" "$NEW_RECORD"
case "$rc" in
  0) echo "Patch applied." ;;
  1) echo "Health gate failed: rolled back automatically, server is on the old images." ;;
  2) echo "Refused before any change (bad tar, checksum, conflict, lock, ...)." ;;
  3) echo "FAILED and rollback failed or was disabled: MANUAL ACTION NEEDED." ;;
  *) echo "patch apply exited with $rc." ;;
esac

# Show the result.
./alara_server.sh status || true
grep -n 'image:' docker-compose.yml || true
exit "$rc"
`;
}
