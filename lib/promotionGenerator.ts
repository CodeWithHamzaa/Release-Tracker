// Promotion scripts from a release checklist (Health tab).
//
// Consumes the CompareResult of compareSnapshots() (lib/toolkitCompare.ts,
// unchanged) and writes two bash scripts:
//   Part 1 (source server): docker save the images the target needs, plus
//          SHA256SUMS, into alara/patches/export/<PATCH_ID>/.
//   Part 2 (target server): add missing plain env keys (with the target's
//          own IPs/domain filled in), then apply the images through the
//          toolkit's own patch flow (./alara_server.sh patch plan/apply:
//          compose backup, health gate, auto-rollback), or restart when
//          there are no images.
// Anything the scripts must not decide alone (secrets, changed values,
// target-only keys, new services...) is listed for manual review, never
// dropped.

import type { CompareResult } from './toolkitCompare.js';
import { scriptImageRepo } from './toolkitCompare.js';
import { composeChecks, indexEnv, PATCH_ID_PATTERN, RunbookServer, scriptGuard, shellQuote } from './runbook.js';

const ROLE_CODE_BY_NAME: Record<string, string> = {
  'Bot-Builder': 'BOT_BUILDER',
  'ChatBot / NLU': 'CHAT_BOT',
  Database: 'DATABASE',
  'Chat-Service': 'CHAT_SERVICE',
};

// Values the snapshot normalised (<IP:ROLE>, <DOMAIN:EVA>) mapped back to the
// TARGET environment's real ones.
export interface TargetTokens {
  ips: Record<string, string>; // role code -> IP
  domain: string | null;
}

export function targetTokensFrom(
  servers: { environment: string; role: string; ip: string | null; domain: string | null }[],
  environment: string
): TargetTokens {
  const ips: Record<string, string> = {};
  let domain: string | null = null;
  for (const s of servers) {
    if (s.environment.toUpperCase() !== environment.toUpperCase()) continue;
    const code = ROLE_CODE_BY_NAME[s.role];
    if (code && s.ip) ips[code] = s.ip;
    if (!domain && s.domain) domain = s.domain;
  }
  return { ips, domain };
}

// Fill placeholders; null when any of them can't be resolved.
export function resolvePlaceholders(value: string, tokens: TargetTokens): string | null {
  let unresolved = false;
  const out = value.replace(/<IP:([A-Z_]+)>|<DOMAIN:([A-Z_]+)>/g, (m, ipRole: string | undefined, domainName: string | undefined) => {
    if (ipRole) {
      const ip = tokens.ips[ipRole];
      if (ip) return ip;
    } else if (domainName === 'EVA' && tokens.domain) {
      return tokens.domain;
    }
    unresolved = true;
    return m;
  });
  return unresolved ? null : out;
}

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
  value: string | null; // resolved for the target; null when not appended
  status: 'append' | 'secret' | 'unresolved' | 'multiline';
}

export interface PromotionInput {
  compare: CompareResult;
  role: string; // tracker role name
  patchId: string;
  sourceServer: RunbookServer | null;
  targetServer: RunbookServer | null;
  targetTokens: TargetTokens;
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

const UPDATE = /^\[IMAGE\] UPDATE (\S+) on (\S+): (.+)  ->  (.+)$/;
const DEPLOY = /^\[IMAGE\] DEPLOY (\S+) \((.+)\) to (\S+) — running on /;
const ADD = /^\[([^\]]+)\] ADD (\S+) to (\S+) \(value on (\S+): ([\s\S]*)\)$/;
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

  for (const item of compare.critical) {
    let m: RegExpExecArray | null;
    if (!item.includes('\n') && (m = UPDATE.exec(item))) {
      const [, container, , previous, image] = m;
      const sameRepo = scriptImageRepo(previous) === scriptImageRepo(image);
      images.push({
        kind: 'update',
        container,
        image,
        previous,
        file: tarFileName(image),
        manual: sameRepo ? null : `repository changed (${scriptImageRepo(previous)} → ${scriptImageRepo(image)}); alara patch matches by repository, so update the image: line by hand`,
      });
    } else if (!item.includes('\n') && (m = DEPLOY.exec(item))) {
      const [, container, image] = m;
      images.push({
        kind: 'deploy',
        container,
        image,
        previous: null,
        file: tarFileName(image),
        manual: 'new service: add it to docker-compose.yml by hand (alara patch only updates existing image: lines)',
      });
    } else if ((m = ADD.exec(item)) && PLAIN_FILE.test(m[1])) {
      const [, file, key, , , sourceValue] = m;
      if (sourceValue.startsWith('SHA256:')) envAdds.push({ file, key, sourceValue, value: null, status: 'secret' });
      else if (sourceValue.includes('\n')) envAdds.push({ file, key, sourceValue, value: null, status: 'multiline' });
      else {
        const value = resolvePlaceholders(sourceValue, input.targetTokens);
        envAdds.push({ file, key, sourceValue, value, status: value === null ? 'unresolved' : 'append' });
      }
    } else {
      manual.push(`CRITICAL ${item}`);
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
  if (input.sourceServer?.ip) plan.sourceScript = sourceScript(plan, input);
  else plan.errors.push(`Source script needs the ${compare.sourceEnv} / ${input.role} IP in the server registry (Catalog → Servers).`);
  if (input.targetServer?.ip) plan.targetScript = targetScript(plan, input);
  else plan.errors.push(`Target script needs the ${compare.targetEnv} / ${input.role} IP in the server registry (Catalog → Servers).`);
  return plan;
}

function header(plan: PromotionPlan, input: PromotionInput, part: string, server: RunbookServer) {
  const generated = (input.generatedAt ?? new Date()).toISOString();
  return `#!/usr/bin/env bash
# ALARA release promotion ${plan.sourceEnv} -> ${plan.targetEnv} · ${plan.role}
# ${part} — run on ${server.ip}${server.runAs ? ` as ${server.runAs}` : ''}
# PATCH_ID ${plan.patchId}, generated by Release Tracker at ${generated}
# If you edited this file on Windows, run: sed -i 's/\\r$//' <this file>
set -euo pipefail
trap 'echo "ABORTED at line $LINENO. Nothing after this point ran." >&2' ERR

PATCH_ID=${shellQuote(plan.patchId)}
`;
}

const say = (text: string) => `echo ${shellQuote(text)}`;
const step = (text: string) => `echo\necho ${shellQuote(`==> ${text}`)}`;

function sourceScript(plan: PromotionPlan, input: PromotionInput): string {
  const server = input.sourceServer!;
  const where = `${indexEnv(plan.sourceEnv)} / ${plan.role}`;
  const lines = [
    header(plan, input, 'PART 1: SOURCE EXPORT', server),
    scriptGuard(server, where),
    '# 2. Compose folder and toolkit present.',
    composeChecks(),
    'command -v docker >/dev/null 2>&1 || die "docker not found on PATH"',
    '',
  ];
  if (plan.images.length === 0) {
    lines.push(say(`No image changes between ${plan.sourceEnv} and ${plan.targetEnv}: nothing to export.`), say('Run Part 2 on the target for the env changes.'), 'exit 0', '');
    return lines.join('\n');
  }
  lines.push(
    'OUT="alara/patches/export/$PATCH_ID"',
    'mkdir -p "$OUT"',
    '',
    'save_image() { # <image> <tar file>',
    '  docker image inspect "$1" >/dev/null 2>&1 || die "image $1 is not on this server (check: docker images)"',
    '  echo "  saving $1 -> $OUT/$2"',
    '  docker save -o "$OUT/$2" "$1"',
    '}',
    '',
    step(`Exporting ${plan.images.length} image(s) that ${plan.targetEnv} needs`),
    'df -h "$OUT" | tail -1 | awk \'{print "  free space here: " $4}\''
  );
  for (const img of plan.images) {
    lines.push(`# ${img.container}: ${img.previous ? `${img.previous} -> ` : 'new on target: '}${img.image}`);
    lines.push(`save_image ${shellQuote(img.image)} ${shellQuote(img.file)}`);
  }
  lines.push(
    '',
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
  const server = input.targetServer!;
  const where = `${indexEnv(plan.targetEnv)} / ${plan.role}`;
  const appends = plan.envAdds.filter((e) => e.status === 'append');
  const patchable = plan.images.filter((i) => !i.manual);
  const files = [...new Set(plan.envAdds.map((e) => e.file))];
  const lines = [
    header(plan, input, 'PART 2: TARGET IMPORT', server),
    scriptGuard(server, where),
    '# 2. Compose folder and toolkit present.',
    composeChecks(),
  ];
  if (patchable.length) {
    lines.push('[ -d "alara/patches/incoming/$PATCH_ID" ] || die "copy the folder from Part 1 to alara/patches/incoming/$PATCH_ID/ first"');
  }
  lines.push(
    '',
    'ensure_newline() { if [ -s "$1" ] && [ -n "$(tail -c1 "$1")" ]; then echo >> "$1"; fi; }',
    'has_key() { awk -F= -v k="$2" \'$1==k{found=1} END{exit !found}\' "$1"; }',
    'add_env() { # <file> <key> <KEY=VALUE line>',
    '  if has_key "$1" "$2"; then echo "  skip   $2: already in $1 (left unchanged)"; return 0; fi',
    '  ensure_newline "$1"',
    '  printf \'%s\\n\' "$3" >> "$1"',
    '  echo "  added  $2 to $1"',
    '}',
    '',
    step('What this script will do'),
    say(`Env keys to add (plain values, ${plan.targetEnv} IPs/domain filled in): ${appends.length}`),
    ...appends.map((e) => say(`  ${e.file}: ${e.key}=${e.value}`)),
    say(`Images via ./alara_server.sh patch: ${patchable.length}`),
    ...patchable.map((i) => say(`  ${i.container}: ${i.previous} -> ${i.image}`))
  );
  if (patchable.length) {
    lines.push('', step('Patch preview (changes nothing)'), './alara_server.sh patch plan "$PATCH_ID"');
  }
  if (!appends.length && !patchable.length) {
    lines.push('', say('Nothing for this script to apply automatically. See the manual items below.'));
  } else {
    lines.push(
      '',
      `read -r -p "Type 'apply' to make these changes on $EXPECTED_IP: " answer`,
      '[ "$answer" = "apply" ] || { echo "Stopped before any change."; exit 0; }'
    );
  }

  if (plan.envAdds.length) {
    lines.push('', step('Step 1: env files'), 'STAMP="$(date +%Y%m%d_%H%M%S)"', 'mkdir -p alara/backups');
    for (const file of files) {
      const adds = plan.envAdds.filter((e) => e.file === file);
      const fileAppends = adds.filter((e) => e.status === 'append');
      const f = shellQuote(file);
      lines.push('', `# ${file}`);
      if (fileAppends.length) {
        lines.push(
          `[ -f ${f} ] || die "${file} not found in $(pwd)"`,
          `cp -p ${f} "alara/backups/promotion_\${STAMP}_${file}"`,
          `echo "  backup alara/backups/promotion_\${STAMP}_${file}"`
        );
      }
      for (const e of adds) {
        if (e.status === 'append') {
          lines.push(`add_env ${f} ${shellQuote(e.key)} ${shellQuote(`${e.key}=${e.value}`)}`);
        } else if (e.status === 'secret') {
          lines.push(
            `# WARNING: '${e.key}' exists in source but is missing here. Add manually.`,
            say(`  WARNING: '${e.key}' (secret) exists on ${plan.sourceEnv} but is missing here. Add it to ${file} by hand, then: ./alara_server.sh encrypt`)
          );
        } else if (e.status === 'unresolved') {
          lines.push(
            `# MANUAL: '${e.key}' value has a placeholder this tracker could not fill for ${plan.targetEnv}: ${e.sourceValue.replace(/\n/g, ' ')}`,
            say(`  MANUAL: '${e.key}' not added: its ${plan.sourceEnv} value has an IP/domain placeholder with no ${plan.targetEnv} entry in the server registry.`)
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

  if (patchable.length) {
    lines.push(
      '',
      step('Step 2: images via alara patch (backup, health gate, auto-rollback)'),
      ...(plan.targetEnv.toUpperCase() === 'PROD' ? [say('alara_server.sh will ask you to type PROD. Do not use --yes (refused on PROD).')] : []),
      'set +e',
      './alara_server.sh patch apply "$PATCH_ID"',
      'rc=$?',
      'set -e',
      'case "$rc" in',
      '  0) echo "Patch applied; containers restarted with the new images and env." ;;',
      '  1) echo "Health gate failed: rolled back to the old images. Env changes above are saved but not loaded; restore the backups in alara/backups/ or run ./alara_server.sh restart." ;;',
      '  2) echo "Patch refused before any change. Env changes above are saved but not loaded yet." ;;',
      '  3) echo "FAILED and rollback failed or was disabled: MANUAL ACTION NEEDED." ;;',
      '  *) echo "patch apply exited with $rc." ;;',
      'esac'
    );
  } else if (appends.length) {
    lines.push('', step('Step 2: restart to load the env changes'), './alara_server.sh restart');
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
  if (patchable.length) lines.push('exit "$rc"');
  lines.push('');
  return lines.join('\n');
}
