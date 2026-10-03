// Promotion scripts from a release checklist (Health tab).
//
// Consumes the CompareResult of compareSnapshots() (lib/toolkitCompare.ts,
// unchanged) and writes two bash scripts:
//   Part 1 (source server): docker save the images the target needs, plus
//          SHA256SUMS, into alara/patches/export/<PATCH_ID>/.
//   Part 2 (target server): add missing plain env keys, then apply the images
//          through the toolkit's own patch flow (./alara_server.sh patch
//          apply: plan + confirmation, compose backup, health gate,
//          auto-rollback), or restart when there are no images.
//
// Single source of truth: the toolkit owns who-is-this-server, the IP and
// domain tables and the patch preview/confirm. The scripts source
// alara/alara_common.sh for the first two (`<IP:ROLE>` / `<DOMAIN:EVA>`
// placeholders in env values are filled in ON the server with
// alara_get_ip / alara_get_domain), so the tracker keeps no copy of them.
// Same options as the toolkit's alara_deploy.sh: --env, --dry-run, --timeout.
// Part 2 also writes a deployment receipt (alara/receipts/<PATCH_ID>_<time>.json)
// that packages the toolkit's own patch record; see lib/receiptParse.ts.
// Anything the scripts must not decide alone (secrets, changed values,
// target-only keys, new services...) is listed for manual review, never
// dropped.

import type { CompareResult } from './toolkitCompare.js';
import { classifyCompareItems } from './compareItems.js';
import { scriptImageRepo } from './toolkitCompare.js';
import { composeChecks, indexEnv, PATCH_ID_PATTERN, receiptHelpers, RunbookServer, scriptGuard, shellQuote } from './runbook.js';

export interface PromotionImage {
  kind: 'update' | 'deploy';
  container: string;
  image: string; // the source's image, to export and apply
  previous: string | null; // what the target runs now (update only)
  file: string; // tar file name
  manual: string | null; // why patch can't apply it on its own
}

export interface PromotionEnvAdd {
  file: string;
  key: string;
  sourceValue: string;
  value: string | null; // the source value, placeholders intact (the script fills them in on the server); null when not appended
  status: 'append' | 'secret' | 'multiline';
}

export interface PromotionInput {
  compare: CompareResult;
  role: string; // tracker role name
  patchId: string;
  sourceServer: RunbookServer | null;
  targetServer: RunbookServer | null;
  generatedAt?: Date;
}

export interface PromotionPlan {
  patchId: string;
  sourceEnv: string;
  targetEnv: string;
  role: string;
  images: PromotionImage[];
  envAdds: PromotionEnvAdd[];
  manual: string[]; // checklist items that need a person
  sourceScript: string | null;
  targetScript: string | null;
  errors: string[]; // why a script could not be generated
}

const PLAIN_FILE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;

export function tarFileName(image: string): string {
  const repo = scriptImageRepo(image);
  const name = repo.slice(repo.lastIndexOf('/') + 1) || 'image';
  const rest = image.slice(repo.length).replace(/^[:@]/, '') || 'latest';
  return `${name}_${rest}`.replace(/[^A-Za-z0-9._-]/g, '_') + '.tar';
}

export function buildPromotion(input: PromotionInput): PromotionPlan {
  const { compare } = input;
  const images: PromotionImage[] = [];
  const envAdds: PromotionEnvAdd[] = [];
  const manual: string[] = [];

  for (const item of classifyCompareItems(compare)) {
    if (item.kind === 'image-update') {
      const sameRepo = scriptImageRepo(item.previous) === scriptImageRepo(item.image);
      images.push({
        kind: 'update',
        container: item.container,
        image: item.image,
        previous: item.previous,
        file: tarFileName(item.image),
        manual: sameRepo ? null : `repository changed (${scriptImageRepo(item.previous)} → ${scriptImageRepo(item.image)}); alara patch matches by repository, so update the image: line by hand`,
      });
    } else if (item.kind === 'image-deploy') {
      images.push({
        kind: 'deploy',
        container: item.container,
        image: item.image,
        previous: null,
        file: tarFileName(item.image),
        manual: 'new service: add it to docker-compose.yml by hand (alara patch only updates existing image: lines)',
      });
    } else if (item.kind === 'env-add' && PLAIN_FILE.test(item.file)) {
      const { file, key, value: sourceValue } = item;
      if (sourceValue.startsWith('SHA256:')) envAdds.push({ file, key, sourceValue, value: null, status: 'secret' });
      else if (sourceValue.includes('\n')) envAdds.push({ file, key, sourceValue, value: null, status: 'multiline' });
      else envAdds.push({ file, key, sourceValue, value: sourceValue, status: 'append' });
    } else {
      manual.push(`CRITICAL ${item.raw}`);
    }
  }
  for (const item of compare.expected) manual.push(`EXPECTED ${item}`);
  for (const item of compare.notes) manual.push(`INFO ${item}`);

  const plan: PromotionPlan = {
    patchId: input.patchId,
    sourceEnv: compare.sourceEnv,
    targetEnv: compare.targetEnv,
    role: input.role,
    images,
    envAdds,
    manual,
    sourceScript: null,
    targetScript: null,
    errors: [],
  };

  if (!PATCH_ID_PATTERN.test(input.patchId)) {
    plan.errors.push('PATCH_ID must be letters, digits, dot, dash or underscore (it is a folder name).');
    return plan;
  }
  plan.sourceScript = sourceScript(plan, input);
  plan.targetScript = targetScript(plan, input);
  return plan;
}

function header(plan: PromotionPlan, input: PromotionInput, part: string, env: string, server: RunbookServer | null) {
  const generated = (input.generatedAt ?? new Date()).toISOString();
  return `#!/usr/bin/env bash
# ALARA release promotion ${plan.sourceEnv} -> ${plan.targetEnv} · ${plan.role}
# ${part} — run on the ${indexEnv(env)} ${plan.role} server${server?.runAs ? ` as ${server.runAs}` : ''}
# PATCH_ID ${plan.patchId}, generated by Release Tracker at ${generated}
# Run:  bash <this file> --env ${indexEnv(env)} [--dry-run] [--timeout SEC]${part.startsWith('PART 2') ? ' [--receipt RECORD_ID]' : ''}
#   --dry-run   show what would happen, change nothing${part.startsWith('PART 2') ? '\n#   --receipt   write the receipt for an existing patch record, nothing else\n# After a run it writes alara/receipts/<PATCH_ID>_<time>.json: copy it back and\n# upload it in Release Tracker (Health > Add reports) to close the records.' : ''}
# If you edited this file on Windows, run: sed -i 's/\\r$//' <this file>
set -euo pipefail
trap 'echo "ABORTED at line $LINENO. Nothing after this point ran." >&2' ERR

PATCH_ID=${shellQuote(plan.patchId)}
`;
}

const say = (text: string) => `echo ${shellQuote(text)}`;
const step = (text: string) => `echo\necho ${shellQuote(`==> ${text}`)}`;

function sourceScript(plan: PromotionPlan, input: PromotionInput): string {
  const server = input.sourceServer;
  const lines = [
    header(plan, input, 'PART 1: SOURCE EXPORT', plan.sourceEnv, server),
    scriptGuard({ environment: plan.sourceEnv, role: plan.role, server }),
    '# Compose folder, toolkit and server identity.',
    composeChecks({ patch: false }),
    'command -v docker >/dev/null 2>&1 || die "docker not found on PATH"',
    '',
  ];
  if (plan.images.length === 0) {
    lines.push(say(`No image changes between ${plan.sourceEnv} and ${plan.targetEnv}: nothing to export.`), say('Run Part 2 on the target for the env changes.'), 'exit 0', '');
    return lines.join('\n');
  }
  lines.push(
    'OUT="alara/patches/export/$PATCH_ID"',
    '[ "$DRY_RUN" = 1 ] || mkdir -p "$OUT"',
    '',
    'save_image() { # <image> <tar file>',
    '  docker image inspect "$1" >/dev/null 2>&1 || die "image $1 is not on this server (check: docker images)"',
    '  if [ "$DRY_RUN" = 1 ]; then echo "  would save $1 -> $OUT/$2"; return 0; fi',
    '  echo "  saving $1 -> $OUT/$2"',
    '  docker save -o "$OUT/$2" "$1"',
    '}',
    '',
    step(`Exporting ${plan.images.length} image(s) that ${plan.targetEnv} needs`),
    '[ "$DRY_RUN" = 1 ] || df -h "$OUT" | tail -1 | awk \'{print "  free space here: " $4}\''
  );
  for (const img of plan.images) {
    lines.push(`# ${img.container}: ${img.previous ? `${img.previous} -> ` : 'new on target: '}${img.image}`);
    lines.push(`save_image ${shellQuote(img.image)} ${shellQuote(img.file)}`);
  }
  lines.push(
    '',
    'if [ "$DRY_RUN" = 1 ]; then echo; echo "DRY RUN: nothing was written."; exit 0; fi',
    step('Writing SHA256SUMS (alara patch verifies the tars with it)'),
    '(cd "$OUT" && sha256sum -- *.tar > SHA256SUMS)',
    'ls -lh "$OUT"',
    '',
    step('Next'),
    `echo "1. Copy the whole folder $OUT to the ${plan.targetEnv} server (WinSCP)."`,
    `echo "   Put it at: <compose folder>/alara/patches/incoming/$PATCH_ID/"`,
    say(`2. On ${plan.targetEnv}, run Part 2 (target import).`),
    ''
  );
  return lines.join('\n');
}

function targetScript(plan: PromotionPlan, input: PromotionInput): string {
  const server = input.targetServer;
  const appends = plan.envAdds.filter((e) => e.status === 'append');
  const patchable = plan.images.filter((i) => !i.manual);
  const files = [...new Set(plan.envAdds.map((e) => e.file))];
  const prod = plan.targetEnv.toUpperCase() === 'PROD';
  const lines = [
    header(plan, input, 'PART 2: TARGET IMPORT', plan.targetEnv, server),
    scriptGuard({ environment: plan.targetEnv, role: plan.role, server, receipt: true }),
    '# Compose folder, toolkit and server identity.',
    composeChecks({ patch: patchable.length > 0 }),
    receiptHelpers('promotion-target'),
    'if [ -n "$RECEIPT_FOR" ]; then rebuild_receipt "$RECEIPT_FOR"; exit 0; fi',
  ];
  if (patchable.length) {
    lines.push('[ -d "alara/patches/incoming/$PATCH_ID" ] || die "copy the folder from Part 1 to alara/patches/incoming/$PATCH_ID/ first"');
  }
  if (plan.envAdds.length) {
    lines.push(
      '',
      'ensure_newline() { if [ -s "$1" ] && [ -n "$(tail -c1 "$1")" ]; then echo >> "$1"; fi; }',
      'has_key() { awk -F= -v k="$2" \'$1==k{found=1} END{exit !found}\' "$1"; }',
      '',
      '# Fill <IP:ROLE> / <DOMAIN:NAME> placeholders from the toolkit\'s own address tables',
      '# (alara_common.sh), for the environment this server is. Fails if one is unknown.',
      'resolve() { # <value with placeholders>',
      '  ( ALARA_WORKDIR="$PWD"; . alara/alara_common.sh >/dev/null 2>&1 || exit 1',
      '    v="$1"',
      '    while [[ "$v" =~ \\<IP:([A-Z_]+)\\> ]]; do',
      '      ip="$(alara_get_ip "${BASH_REMATCH[1]}" "$ALARA_ENV")" || exit 1; v="${v//"${BASH_REMATCH[0]}"/$ip}"',
      '    done',
      '    while [[ "$v" =~ \\<DOMAIN:([A-Z_]+)\\> ]]; do',
      '      d="$(alara_get_domain "${BASH_REMATCH[1]}" "$ALARA_ENV")" || exit 1; v="${v//"${BASH_REMATCH[0]}"/$d}"',
      '    done',
      '    printf \'%s\' "$v" )',
      '}',
      '',
      'add_env() { # <file> <key> <value, may hold placeholders>',
      '  if has_key "$1" "$2"; then echo "  skip   $2: already in $1 (left unchanged)"; return 0; fi',
      '  if ! val="$(resolve "$3")"; then echo "  MANUAL: \'$2\' not added: the toolkit has no address for a placeholder in: $3"; return 0; fi',
      '  if [ "$DRY_RUN" = 1 ]; then echo "  would add $2=$val to $1"; return 0; fi',
      '  ensure_newline "$1"',
      '  printf \'%s=%s\\n\' "$2" "$val" >> "$1"',
      '  ADDED+=("$1:$2")',
      '  echo "  added  $2 to $1"',
      '}',
      'backup_env() { # <file>',
      '  [ -f "$1" ] || die "$1 not found in $(pwd)"',
      '  if [ "$DRY_RUN" = 1 ]; then echo "  would back up $1 to alara/backups/"; return 0; fi',
      '  cp -p "$1" "alara/backups/promotion_${STAMP}_$1"',
      '  echo "  backup alara/backups/promotion_${STAMP}_$1"',
      '}'
    );
  }
  lines.push(
    '',
    step('What this script will do'),
    say(`Env keys to add (IP/domain placeholders are filled in from this server's toolkit tables): ${appends.length}`),
    ...appends.map((e) => say(`  ${e.file}: ${e.key}=${e.value}`)),
    say(`Images via ./alara_server.sh patch apply (it shows its own plan and asks for confirmation): ${patchable.length}`),
    ...patchable.map((i) => say(`  ${i.container}: ${i.previous} -> ${i.image}`))
  );

  // One preview and one confirmation. patch apply previews and confirms the
  // image change itself; this script confirms only what the toolkit does not
  // cover, the env-key edits, and shows the patch plan first when it makes them.
  if (appends.length && patchable.length) {
    lines.push('', step('Patch preview (changes nothing)'), './alara_server.sh patch plan "$PATCH_ID"');
  } else if (patchable.length) {
    lines.push('', 'if [ "$DRY_RUN" = 1 ]; then', '  ./alara_server.sh patch plan "$PATCH_ID"', 'fi');
  }
  if (appends.length) {
    lines.push(
      '',
      'if [ "$DRY_RUN" != 1 ]; then',
      `  read -r -p "Type '${prod ? 'PROD' : 'apply'}' to add these env keys${patchable.length ? '' : ' and restart'}: " answer`,
      `  [ "$answer" = "${prod ? 'PROD' : 'apply'}" ] || { echo "Stopped before any change."; exit 0; }`,
      'fi'
    );
  }

  if (plan.envAdds.length) {
    lines.push('', step('Step 1: env files'), 'STAMP="$(date +%Y%m%d_%H%M%S)"', '[ "$DRY_RUN" = 1 ] || mkdir -p alara/backups');
    for (const file of files) {
      const adds = plan.envAdds.filter((e) => e.file === file);
      const fileAppends = adds.filter((e) => e.status === 'append');
      const f = shellQuote(file);
      lines.push('', `# ${file}`);
      if (fileAppends.length) lines.push(`backup_env ${f}`);
      for (const e of adds) {
        if (e.status === 'append') {
          lines.push(`add_env ${f} ${shellQuote(e.key)} ${shellQuote(e.value ?? '')}`);
        } else if (e.status === 'secret') {
          lines.push(
            `# WARNING: '${e.key}' exists in source but is missing here. Add manually.`,
            say(`  WARNING: '${e.key}' (secret) exists on ${plan.sourceEnv} but is missing here. Add it to ${file} by hand, then: ./alara_server.sh encrypt`)
          );
        } else {
          lines.push(
            `# MANUAL: '${e.key}' is defined more than once on ${plan.sourceEnv}; decide which value ${plan.targetEnv} needs.`,
            say(`  MANUAL: '${e.key}' is defined more than once on ${plan.sourceEnv}; not added.`)
          );
        }
      }
    }
  }

  lines.push('', 'if [ "$DRY_RUN" = 1 ]; then echo; echo "DRY RUN: nothing was changed."; exit 0; fi');

  if (patchable.length) {
    lines.push(
      '',
      step('Step 2: images via alara patch (plan, confirmation, backup, health gate, auto-rollback)'),
      ...(prod ? [say('alara_server.sh will ask you to type PROD.')] : []),
      'APPLY_ARGS=()',
      '[ -z "$TIMEOUT" ] || APPLY_ARGS+=(--timeout "$TIMEOUT")',
      'BEFORE_RECORDS="$(patch_records)"',
      'set +e',
      './alara_server.sh patch apply "$PATCH_ID" ${APPLY_ARGS[@]+"${APPLY_ARGS[@]}"}',
      'rc=$?',
      'set -e',
      'NEW_RECORD="$(new_patch_record "$BEFORE_RECORDS")"',
      'if [ -n "$NEW_RECORD" ]; then outcome=recorded',
      'elif [ "$rc" = 0 ]; then outcome=nothing-applicable',
      'elif [ "$rc" = 2 ]; then outcome=refused',
      'else outcome=failed; fi',
      'write_receipt "$rc" "$outcome" "$NEW_RECORD"',
      'case "$rc" in',
      '  0) echo "Patch applied; containers restarted with the new images and env." ;;',
      '  1) echo "Health gate failed: rolled back to the old images. Env changes above are saved but not loaded; restore the backups in alara/backups/ or run ./alara_server.sh restart." ;;',
      '  2) echo "Patch refused before any change. Env changes above are saved but not loaded yet." ;;',
      '  3) echo "FAILED and rollback failed or was disabled: MANUAL ACTION NEEDED." ;;',
      '  *) echo "patch apply exited with $rc." ;;',
      'esac'
    );
  } else if (appends.length) {
    lines.push(
      '',
      step('Step 2: restart to load the env changes'),
      'set +e',
      './alara_server.sh restart',
      'rc=$?',
      'set -e',
      'if [ "$rc" = 0 ]; then outcome=env-restarted; else outcome=failed; fi',
      'write_receipt "$rc" "$outcome" ""'
    );
  }

  const manualLines = [
    ...plan.images.filter((i) => i.manual).map((i) => `IMAGE ${i.container} (${i.image}): ${i.manual}`),
    ...plan.manual,
  ];
  if (manualLines.length) {
    lines.push('', step(`Review by hand (${manualLines.length} item(s), not automated)`));
    for (const m of manualLines) lines.push(`# ${m.replace(/\n/g, ' ')}`, say(`  - ${m.replace(/\n/g, ' ')}`));
  }

  lines.push('', step('Result'), './alara_server.sh status || true');
  if (patchable.length || appends.length) lines.push('exit "$rc"');
  lines.push('');
  return lines.join('\n');
}
