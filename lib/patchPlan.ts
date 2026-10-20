// The patch plan: one ordered list of manual steps for the TARGET servers,
// built from a resolved scope (lib/patchScope.ts). Both outputs, the concise
// Deployment Steps and the full Runbook (lib/patchRender.ts), are views of
// this one object, so they cannot disagree.
//
// Boundaries (by design, and tested):
//   - Target servers only. The plan starts with the image tar ALREADY on the
//     target: no docker save, no export, no file transfer of any kind.
//   - Plain docker + compose: docker load, edit the image: line, up -d.
//   - Every path, service name and image comes from the tracker's data (the
//     vault compose file, the server registry, the comparison). Anything
//     missing stays a visible <PLACEHOLDER> and is listed under unknowns;
//     nothing is invented.
//   - Config values are the redacted ones from the comparison; secrets are
//     never written here, only "set it by hand".
//   - Generating a plan or ticking a step proves nothing: verification steps
//     say what to check, and the evidence section is left for the operator.

import { parse } from 'yaml';
import type { ConfigKeyDiff, EnvironmentComparison, RoleComparison, ServerRef } from './envCompare.js';
import type { ResolvedScope, ScopeItem } from './patchScope.js';
import { envLabel } from './environments.js';
import { redactText } from './redact.js';
import { shellArg } from './shell.js';

export const PATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SAFE_DIR = /^\/[A-Za-z0-9._\/-]{0,250}$/;

export type StepPhase = 'access' | 'precheck' | 'backup' | 'load' | 'config' | 'compose' | 'deploy' | 'verify' | 'rollback' | 'record';

export interface PlanStep {
  id: string; // stable within a plan, e.g. "uat-chatbot-load-memento"
  phase: StepPhase;
  role: string;
  server: string; // "UAT / ChatBot / NLU (10.2.2.5)"
  title: string;
  commands: string[];
  file: string | null; // full path of the file this step changes
  setting: string | null; // exact key / YAML path and new value
  expected: string;
  onFailure: string;
  unknowns: string[]; // placeholders in this step that need real values
  manual: boolean; // a person must decide or edit; no command does it all
}

export interface PlanService {
  service: string;
  composeKey: string;
  from: ScopeItem['from'];
  to: ScopeItem['to'];
  tarFile: string;
  newService: boolean;
  changes: ScopeItem['changes'];
  skippedBuilds: string[];
  warnings: string[];
  blocking: string[];
}

export interface PlanConfigChange {
  file: string; // file name in the compose folder
  path: string; // full path on the target
  key: string;
  change: ConfigKeyDiff['change'];
  action: ConfigKeyDiff['action'];
  value: string | null; // redacted proposal; null: set by hand
  secret: boolean;
  reason: string;
}

export interface PlanServer {
  role: string;
  label: string;
  server: ServerRef;
  composeDir: string; // real path or <PLACEHOLDER>
  composeFile: string; // file name, e.g. docker-compose.yml
  tarDir: string;
  services: PlanService[];
  config: PlanConfigChange[];
  reviewOnly: PlanConfigChange[]; // kept / needs judgment, no step changes them
  missingRequired: string[];
}

export interface PatchPlan {
  patchId: string;
  title: string;
  sourceEnv: string;
  targetEnv: string;
  mode: ResolvedScope['mode'];
  generatedAt: string;
  servers: PlanServer[];
  steps: PlanStep[]; // execution order, rollback steps last
  skipped: ResolvedScope['skipped'];
  changes: { key: string; title: string | null; services: { service: string; tag: string | null; inclusion: string; detail: string }[] }[];
  unknowns: string[];
  assumptions: string[];
  risks: string[];
  errors: string[]; // from the scope: the plan should not be used until fixed
}

export interface PlanInput {
  comparison: EnvironmentComparison;
  scope: ResolvedScope;
  patchId: string;
  tarDir?: string | null; // override for every server; default: toolkit convention
  // Raw vault compose files per role (server side only; never returned). Used
  // to tell whether an image: line can be edited with one exact command.
  composeTexts?: Record<string, { source: string | null; target: string | null }>;
  generatedAt?: Date;
}

// Tar name the image is expected under (the toolkit's naming): repo:tag ->
// repo_tag.tar. The operator may have named it differently; the plan says so.
export function tarFileName(image: string): string {
  const noDigest = image.split('@')[0];
  const lastSlash = noDigest.lastIndexOf('/');
  const colon = noDigest.lastIndexOf(':');
  const repo = colon > lastSlash ? noDigest.slice(0, colon) : noDigest;
  const name = repo.slice(repo.lastIndexOf('/') + 1) || 'image';
  const rest = image.slice(repo.length).replace(/^[:@]/, '') || 'latest';
  return `${name}_${rest}`.replace(/[^A-Za-z0-9._-]/g, '_') + '.tar';
}

export function defaultPatchId(sourceEnv: string, targetEnv: string, date: Date = new Date()): string {
  return `PATCH-${envLabel(sourceEnv)}-${envLabel(targetEnv)}-${date.toISOString().slice(0, 10).replace(/-/g, '')}`;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Basic-regex pattern and replacement text for sed with # as the delimiter.
const escapeSed = (s: string) => s.replace(/[\\#.*[\]^$]/g, '\\$&');
const escapeSedReplacement = (s: string) => s.replace(/[\\#&]/g, '\\$&');

interface ComposeDef {
  rawImage: string | null;
  envFiles: string[];
  dependsOn: string[];
  ports: number[];
  yaml: string | null; // the service block, redacted
}

function composeDefs(text: string | null): { defs: Record<string, ComposeDef>; imageCount: Map<string, number> } {
  const defs: Record<string, ComposeDef> = {};
  const imageCount = new Map<string, number>();
  if (!text) return { defs, imageCount };
  let doc: any = null;
  try {
    doc = parse(text, { merge: true });
  } catch {
    return { defs, imageCount };
  }
  for (const line of text.split('\n')) {
    // Only plain, unquoted, comment-free lines: the exact sed edit matches those.
    const m = /^\s*image:\s*([^"'\s#]+)\s*$/.exec(line);
    if (m) imageCount.set(m[1], (imageCount.get(m[1]) ?? 0) + 1);
  }
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.path ?? '')).filter(Boolean) : typeof v === 'string' ? [v] : [];
  for (const [name, def] of Object.entries<any>(doc?.services ?? {})) {
    if (!def || typeof def !== 'object') continue;
    const ports = (Array.isArray(def.ports) ? def.ports : [])
      .map((p: any) => (typeof p === 'string' ? /^(?:[\d.]+:)?(\d+):\d+/.exec(p)?.[1] : p?.published))
      .map((p: any) => Number(p))
      .filter((p: number) => Number.isInteger(p) && p > 0);
    let yaml: string | null = null;
    const start = text.split('\n').findIndex((l) => new RegExp(`^\\s{2}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`).test(l));
    if (start >= 0) {
      const lines = text.split('\n');
      const block = [lines[start]];
      for (let i = start + 1; i < lines.length && (/^\s{3,}/.test(lines[i]) || !lines[i].trim()); i++) block.push(lines[i]);
      yaml = redactText(block.join('\n').trimEnd());
    }
    defs[name] = {
      rawImage: typeof def.image === 'string' ? def.image : null,
      envFiles: list(def.env_file),
      dependsOn: Array.isArray(def.depends_on) ? def.depends_on.map(String) : def.depends_on && typeof def.depends_on === 'object' ? Object.keys(def.depends_on) : [],
      ports,
      yaml,
    };
  }
  return { defs, imageCount };
}

// Services in dependency order (depends_on inside the plan first), stable.
function dependencyOrder(keys: string[], defs: Record<string, ComposeDef>): string[] {
  const out: string[] = [];
  const visiting = new Set<string>();
  const visit = (k: string) => {
    if (out.includes(k) || visiting.has(k)) return;
    visiting.add(k);
    for (const d of defs[k]?.dependsOn ?? []) if (keys.includes(d)) visit(d);
    out.push(k);
  };
  keys.forEach(visit);
  return out;
}

export function buildPatchPlan(input: PlanInput): PatchPlan {
  const { comparison, scope } = input;
  const S = envLabel(comparison.sourceEnv);
  const T = envLabel(comparison.targetEnv);
  const patchId = input.patchId.trim();
  const unknowns: string[] = [];
  const assumptions: string[] = [];
  const risks: string[] = [];
  const errors = [...scope.errors];
  if (!PATCH_ID_PATTERN.test(patchId)) errors.push('Patch ID must be letters, digits, dot, dash or underscore (it names backup files and the tar folder).');
  const tarOverride = input.tarDir?.trim() || null;
  if (tarOverride && !SAFE_DIR.test(tarOverride)) errors.push('Tar folder must be an absolute path of letters, digits, dot, dash, underscore and slash.');

  // A bad patch ID or tar folder would end up inside every command: emit none.
  const unusable = errors.length > scope.errors.length;
  const roleOf = new Map(comparison.roles.map((r) => [r.role, r]));
  const roles = [...new Set([...scope.items.map((i) => i.role), ...scope.configRoles])].filter((r) => roleOf.has(r));
  roles.sort((a, b) => comparison.roles.findIndex((r) => r.role === a) - comparison.roles.findIndex((r) => r.role === b));

  const servers: PlanServer[] = [];
  const steps: PlanStep[] = [];
  const rollback: PlanStep[] = [];

  for (const role of roles) {
    const rc = roleOf.get(role) as RoleComparison;
    const srv = rc.targetServer;
    const label = `${T} / ${role}${srv.ip ? ` (${srv.ip})` : ''}`;
    const sid = `${slug(T)}-${slug(role)}`;
    const dirKnown = !!srv.composePath;
    const composeDir = srv.composePath || `<COMPOSE_DIR:${T}/${role}>`;
    const composeFile = rc.composeFile.target?.path || rc.composeFile.source?.path || 'docker-compose.yml';
    const tarDir = tarOverride || `${dirKnown ? srv.composePath!.replace(/\/+$/, '') : composeDir}/alara/patches/incoming/${patchId}`;
    const dirU = dirKnown ? [] : [`Compose folder on ${T} / ${role} (set it in Infrastructure → Servers)`];
    if (!dirKnown) unknowns.push(`Compose folder on ${T} / ${role}: not in the server registry.`);
    if (!srv.known) unknowns.push(`No server registry entry for ${T} / ${role}: IP, account and folder are unknown.`);
    if (!rc.composeFile.target) unknowns.push(`${T} / ${role} has no compose file in the vault: compose file name and service names are taken from ${S} and must be checked on the server.`);
    if (!srv.ip) unknowns.push(`IP of ${T} / ${role} is unknown: the server identity check cannot be confirmed.`);
    if (!srv.runAs) unknowns.push(`Run-as account on ${T} / ${role} is unknown.`);
    const F = shellArg(composeFile);
    const DC = `docker compose -f ${F}`;
    const { defs: tDefs, imageCount } = composeDefs(input.composeTexts?.[role]?.target ?? null);
    const { defs: sDefs } = composeDefs(input.composeTexts?.[role]?.source ?? null);

    const items = scope.items.filter((i) => i.role === role);
    const services: PlanService[] = items.map((i) => {
      const row = rc.services.find((s) => s.key === i.key);
      const composeKey = row?.target.composeKey || row?.source.composeKey || i.service;
      return {
        service: i.service,
        composeKey,
        from: i.from,
        to: i.to,
        tarFile: i.to.image ? tarFileName(i.to.image) : `<TAR:${i.service}>`,
        newService: i.newService,
        changes: i.changes,
        skippedBuilds: i.skippedBuilds,
        warnings: i.warnings,
        blocking: i.blocking,
      };
    });
    for (const s of services) {
      for (const b of s.blocking) unknowns.push(`${role} / ${s.service}: ${b}`);
      for (const w of s.warnings) risks.push(`${role} / ${s.service}: ${w}`);
    }

    // Config: only keys the comparison marked 'add' get a step. Secrets and
    // review items are listed for a person; removals never happen here.
    const config: PlanConfigChange[] = [];
    const reviewOnly: PlanConfigChange[] = [];
    if (scope.configRoles.includes(role)) {
      for (const f of rc.config) {
        const path = `${composeDir.replace(/\/+$/, '')}/${f.path}`;
        if (f.presence === 'source-only') {
          reviewOnly.push({ file: f.path, path, key: '(whole file)', change: 'added', action: 'review', value: null, secret: false, reason: `${f.path} exists on ${S} only: create it on ${T} by hand if the services need it.` });
          continue;
        }
        for (const k of f.keys) {
          const entry: PlanConfigChange = { file: f.path, path, key: k.key, change: k.change, action: k.action, value: k.proposedValue, secret: k.secret, reason: k.reason };
          if (k.change === 'added' && (k.action === 'add' || k.secret || k.proposedValue === null)) config.push(entry);
          else reviewOnly.push(entry);
        }
        for (const d of f.duplicates.target) risks.push(`${T} ${f.path}: ${d} is defined more than once (last line wins).`);
        if (f.targetEncrypted && f.keys.some((k) => k.change === 'added')) {
          risks.push(`${T} ${f.path} holds toolkit-encrypted values (ENC[...]): after adding keys, re-encrypt it the way you normally do (e.g. ./alara_server.sh encrypt) before the deploy step.`);
        }
      }
      for (const v of rc.missingRequired) unknowns.push(`${T} / ${role}: compose needs \${${v}} but ${T}'s .env does not define it.`);
    }

    const changedFiles = [...new Set(config.map((c) => c.file))];
    const svcByKey = new Map(services.map((s) => [s.composeKey, s]));
    // Services that read a changed env file are recreated too.
    const envReaders = Object.entries(tDefs)
      .filter(([, d]) => d.envFiles.some((f) => changedFiles.includes(f.replace(/^\.\//, ''))))
      .map(([k]) => k);
    const deployKeys = dependencyOrder([...new Set([...services.map((s) => s.composeKey), ...envReaders])], tDefs);
    if (changedFiles.length && !Object.keys(tDefs).length) unknowns.push(`${T} / ${role}: which services read ${changedFiles.join(', ')} is unknown (no ${T} compose file in the vault); recreate them by hand.`);

    servers.push({ role, label, server: srv, composeDir, composeFile, tarDir, services, config, reviewOnly, missingRequired: rc.missingRequired });
    if (unusable || (!services.length && !config.length)) continue;

    const step = (s: Omit<PlanStep, 'role' | 'server' | 'unknowns' | 'manual' | 'file' | 'setting'> & Partial<Pick<PlanStep, 'unknowns' | 'manual' | 'file' | 'setting'>>) =>
      ({ role, server: label, file: null, setting: null, unknowns: [], manual: false, ...s }) as PlanStep;

    // 1. Access and identity.
    steps.push(step({
      id: `${sid}-access`,
      phase: 'access',
      title: `Open a session on ${label}${srv.access ? ` via ${srv.access}` : ''} and go to the compose folder`,
      commands: [...(srv.runAs ? ['whoami'] : []), ...(srv.ip ? ['hostname -I'] : []), `cd ${shellArg(composeDir)}`, `ls -l ${F}`],
      expected: [srv.runAs ? `whoami prints ${srv.runAs}` : 'whoami: account unknown (unverified)', srv.ip ? `hostname -I includes ${srv.ip}` : 'IP unknown (unverified)', `${composeFile} is listed`].join('; ') + '.',
      onFailure: `Stop. You are on the wrong server, account or folder; change nothing.`,
      unknowns: [...dirU, ...(srv.ip ? [] : [`IP of ${T} / ${role}`]), ...(srv.runAs ? [] : [`Run-as account on ${T} / ${role}`])],
    }));

    // 2. Pre-checks.
    const pre: string[] = [`${DC} config --quiet`, `${DC} ps`];
    for (const s of services.filter((x) => !x.newService)) {
      pre.push(`docker inspect --format '{{.Config.Image}} {{.Image}}' $(${DC} ps -q ${shellArg(s.composeKey)})`);
      if (s.from?.image) pre.push(`docker image inspect --format '{{.Id}}' ${shellArg(s.from.image)}`);
    }
    for (const s of services) pre.push(`ls -l ${shellArg(`${tarDir}/${s.tarFile}`)}`);
    pre.push('df -h /var/lib/docker');
    steps.push(step({
      id: `${sid}-precheck`,
      phase: 'precheck',
      title: 'Pre-checks (change nothing): compose file valid, current images recorded, tars present, disk space',
      commands: pre,
      expected: [
        'config --quiet prints nothing',
        ...services.filter((x) => !x.newService).map((s) => `${s.composeKey} runs ${s.from?.image ?? 'its current image'}${s.from?.imageId ? ` (${s.from.imageId.slice(0, 19)}…)` : ''}; note the image ID as the rollback point`),
        'every tar is listed',
        'enough free space for the loaded images',
      ].join('; ') + '.',
      onFailure: 'Stop before any change. A different running image means the comparison is out of date: upload a fresh status report and re-plan. A missing tar: transfer it first (outside this plan).',
      unknowns: [...dirU, ...services.filter((s) => !s.to.image).map((s) => `Tar file for ${s.service}`)],
    }));

    // 3. Backups.
    const backups = [`cp -p ${F} ${shellArg(`${composeFile}.before-${patchId}`)}`, ...changedFiles.map((f) => `cp -p ${shellArg(f)} ${shellArg(`${f}.before-${patchId}`)}`)];
    steps.push(step({
      id: `${sid}-backup`,
      phase: 'backup',
      title: 'Back up the files this patch edits',
      commands: [...backups, `ls -l *.before-${patchId}`],
      expected: `Backups exist next to the originals: ${[composeFile, ...changedFiles].map((f) => `${f}.before-${patchId}`).join(', ')}.`,
      onFailure: 'Stop. Do not edit anything without a backup.',
      unknowns: dirU,
    }));

    // 4. Load images (already transferred).
    for (const s of services) {
      const tar = `${tarDir}/${s.tarFile}`;
      steps.push(step({
        id: `${sid}-load-${slug(s.composeKey)}`,
        phase: 'load',
        title: `Load ${s.service} ${s.to.tag ?? '<BUILD>'} from the tar already on this server`,
        commands: [`docker load -i ${shellArg(tar)}`, ...(s.to.image ? [`docker image inspect --format '{{.Id}} {{.RepoTags}}' ${shellArg(s.to.image)}`] : [])],
        expected: `docker load prints "Loaded image: ${s.to.image ?? '<IMAGE>'}"${s.to.imageId ? `; the image ID is ${s.to.imageId}` : '; write the image ID down as evidence (no recorded ID to compare against)'}.`,
        onFailure: `Stop for ${s.service}: do not edit the compose file. A different tag or ID means the wrong tar; a load error means a damaged copy. Re-transfer and retry.`,
        unknowns: [...(s.to.image ? [] : [`Image reference for ${s.service}`]), ...(tarOverride ? [] : dirU)],
      }));
    }

    // 5. Config changes.
    for (const c of config) {
      const add = c.action === 'add' && c.value !== null && !c.secret;
      steps.push(step({
        id: `${sid}-env-${slug(c.file)}-${slug(c.key)}`,
        phase: 'config',
        title: add ? `Add ${c.key} to ${c.file}` : `Set ${c.key} in ${c.file} by hand`,
        commands: add
          ? [`grep -c '^${c.key}=' ${shellArg(c.file)}`, `printf '%s\\n' ${shellArg(`${c.key}=${c.value}`)} >> ${shellArg(c.file)}`, `grep -n '^${c.key}=' ${shellArg(c.file)}`]
          : [`grep -c '^${c.key}=' ${shellArg(c.file)}`],
        file: c.path,
        setting: add ? `${c.key}=${c.value}` : `${c.key}=<${T} value>`,
        expected: add ? `The first grep prints 0; the last shows exactly one ${c.key} line.` : `${c.key} is set once, to ${T}'s own value.`,
        onFailure: add ? `If the key already exists, do not append: compare the value by hand. Restore ${c.file}.before-${patchId} if the file was damaged.` : `Leave it unset and stop if you do not know the ${T} value.`,
        manual: !add,
        unknowns: add ? dirU : [`${T} value for ${c.key}${c.secret ? ' (secret: never copy it from ' + S + ')' : ''}`],
      }));
    }

    // 6. Compose edits.
    for (const s of services) {
      const def = tDefs[s.composeKey];
      const file = `${composeDir.replace(/\/+$/, '')}/${composeFile}`;
      if (s.newService) {
        const block = sDefs[s.composeKey]?.yaml;
        steps.push(step({
          id: `${sid}-compose-${slug(s.composeKey)}`,
          phase: 'compose',
          title: `Add the ${s.composeKey} service to ${composeFile} by hand`,
          commands: [`${DC} config --services`],
          file,
          setting: `services.${s.composeKey} (new), image: ${s.to.image ?? '<IMAGE>'}`,
          expected: `config --services lists ${s.composeKey}. ${block ? `Start from the ${S} definition below and replace every ${S} address, port and file with ${T}'s:\n${block}` : `No ${S} definition is in the vault: write it from the service's documentation.`}`,
          onFailure: `Restore ${composeFile}.before-${patchId}.`,
          manual: true,
          unknowns: [`${T} ports, volumes and env_file for ${s.composeKey}`],
        }));
        continue;
      }
      const old = s.from?.image ?? def?.rawImage ?? null;
      const viaVariable = !!def?.rawImage && def.rawImage.includes('$');
      const exact = !viaVariable && !!old && !!s.to.image && imageCount.get(old) === 1;
      const commands = exact
        ? [`sed -i 's#^\\(\\s*image:\\s*\\)${escapeSed(old!)}\\s*$#\\1${escapeSedReplacement(s.to.image!)}#' ${F}`, `grep -n ${shellArg(`image: ${s.to.image}`)} ${F}`, `${DC} config --quiet`]
        : [`grep -n 'image:' ${F}`, `${DC} config --quiet`];
      steps.push(step({
        id: `${sid}-compose-${slug(s.composeKey)}`,
        phase: 'compose',
        title: `Point ${s.composeKey} at ${s.to.tag ?? '<BUILD>'} in ${composeFile}`,
        commands,
        file,
        setting: viaVariable
          ? `services.${s.composeKey}.image is "${def!.rawImage}": change the variable it uses (in .env) to ${s.to.tag}`
          : `services.${s.composeKey}.image: ${old ?? '<CURRENT IMAGE>'} → ${s.to.image ?? '<IMAGE>'}`,
        expected: exact ? `grep shows one line with image: ${s.to.image}; config --quiet prints nothing.` : `Only the ${s.composeKey} image line changed; config --quiet prints nothing.`,
        onFailure: `Restore ${composeFile}.before-${patchId} and stop.`,
        manual: !exact,
        unknowns: [...(old ? [] : [`Current image line of ${s.composeKey}`]), ...(s.to.image ? [] : [`Image reference for ${s.service}`])],
      }));
      if (!exact && !viaVariable && old && imageCount.get(old)! > 1) risks.push(`${role}: ${old} appears on more than one image: line; edit only the ${s.composeKey} service by hand.`);
      if (!exact && !old) unknowns.push(`${role} / ${s.composeKey}: current image line unknown; edit by hand after checking the file.`);
    }

    // 7. Deploy.
    if (deployKeys.length) {
      const extra = deployKeys.filter((k) => !svcByKey.has(k));
      steps.push(step({
        id: `${sid}-deploy`,
        phase: 'deploy',
        title: `Recreate ${deployKeys.join(', ')}${extra.length ? ` (${extra.join(', ')} only to load the env change)` : ''}`,
        commands: [`${DC} up -d --no-deps ${deployKeys.map(shellArg).join(' ')}`],
        expected: `Each listed container is recreated or started; no other container restarts.`,
        onFailure: 'Go to the rollback steps for this server.',
        unknowns: dirU,
      }));
    }

    // 8. Verify.
    const verify: string[] = [];
    for (const k of deployKeys) {
      verify.push(`${DC} ps ${shellArg(k)}`);
      verify.push(`docker inspect --format '{{.Config.Image}} {{.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}}' $(${DC} ps -q ${shellArg(k)})`);
      verify.push(`${DC} logs --since 10m --tail 200 ${shellArg(k)}`);
    }
    const appChecks = services.flatMap((s) => (tDefs[s.composeKey]?.ports ?? []).slice(0, 1).map((p) => `curl -sS -o /dev/null -w '%{http_code}\\n' http://localhost:${p}/`));
    if (srv.toolkitVersion) verify.push('./alara_server.sh status');
    steps.push(step({
      id: `${sid}-verify`,
      phase: 'verify',
      title: 'Verify version, container health and logs',
      commands: [...verify, ...appChecks],
      expected: [
        ...services.map((s) => `${s.composeKey} runs ${s.to.image ?? '<IMAGE>'}${s.to.imageId ? ` with ID ${s.to.imageId}` : ''}, state running${tDefs[s.composeKey] ? '' : ''}, healthy if it has a healthcheck, restarts=0`),
        'logs show a clean start (no errors, no restart loop)',
        appChecks.length ? 'curl answers with an HTTP status (the endpoint is the published port root; replace it with the service\'s real health URL if you have one)' : 'application check: no published port or health URL is recorded; use the check you normally run',
      ].join('; ') + '.',
      onFailure: 'Go to the rollback steps for this server. Do not mark anything SUCCESS.',
      unknowns: appChecks.length ? [] : [`Application health check for ${services.map((s) => s.composeKey).join(', ') || role}`],
    }));

    // 9. Record evidence (never automatic).
    steps.push(step({
      id: `${sid}-record`,
      phase: 'record',
      title: 'Record the evidence in the tracker',
      commands: srv.toolkitVersion ? ['./alara_server.sh status'] : [`${DC} ps`],
      expected: `Upload the output on the Health page (it becomes the observed version), then set the release records for ${services.map((s) => `${s.service} ${s.to.tag}`).join(', ') || 'the config change'} to SUCCESS — or FAILED if you rolled back.`,
      onFailure: 'Leave the records PENDING and note what happened.',
      manual: true,
    }));

    // Rollback (kept apart, run only on failure).
    const restores = [`cp -p ${shellArg(`${composeFile}.before-${patchId}`)} ${F}`, ...changedFiles.map((f) => `cp -p ${shellArg(`${f}.before-${patchId}`)} ${shellArg(f)}`)];
    const newOnes = services.filter((s) => s.newService).map((s) => s.composeKey);
    const back = deployKeys.filter((k) => !newOnes.includes(k));
    rollback.push(step({
      id: `${sid}-rollback`,
      phase: 'rollback',
      title: `Roll back ${label}`,
      commands: [
        ...(newOnes.length ? [`${DC} stop ${newOnes.map(shellArg).join(' ')}`, `${DC} rm -f ${newOnes.map(shellArg).join(' ')}`] : []),
        ...restores,
        `${DC} config --quiet`,
        ...(back.length ? [`${DC} up -d --no-deps ${back.map(shellArg).join(' ')}`] : []),
        ...back.map((k) => `docker inspect --format '{{.Config.Image}} {{.Image}}' $(${DC} ps -q ${shellArg(k)})`),
      ],
      expected: `Each service runs its previous image again: ${services.filter((s) => !s.newService).map((s) => `${s.composeKey} ${s.from?.image ?? '(see pre-check output)'}${s.from?.imageId ? ` ${s.from.imageId.slice(0, 19)}…` : ''}`).join(', ') || 'no image change'}. Keep the new images until the patch is signed off; never docker image prune during a rollback.`,
      onFailure: 'Previous image missing (docker image inspect fails): it was pruned; load it again from your own archive. Escalate before trying anything else.',
      unknowns: dirU,
    }));
  }

  // Shared notes.
  assumptions.push(
    `The image tars are already on each ${T} server${tarOverride ? ` in ${tarOverride}` : ' in <compose folder>/alara/patches/incoming/<PATCH_ID>/ (the toolkit\'s folder convention)'} and named repo_tag.tar. Change the paths in the commands if you put them elsewhere.`,
    'docker compose v2 (`docker compose`). On a server with only the old binary, use `docker-compose` with the same arguments.',
    `Versions come from the ${S} expected build (vault compose file or a newer build record) unless a specific build was chosen.`,
  );
  if (comparison.valuesIncluded === false) assumptions.push('Config values were withheld (not an admin): every config step says to set the value by hand.');
  for (const r of comparison.roles.filter((x) => roles.includes(x.role))) {
    for (const n of r.notes) unknowns.push(n);
    if (r.observedAt.target === null) risks.push(`${T} / ${r.role}: no health report, so the pre-check output is the only proof of what runs now.`);
  }
  for (const w of scope.warnings) risks.push(w);

  const changeMap = new Map<string, PatchPlan['changes'][number]>();
  for (const s of scope.items) {
    for (const c of s.changes) {
      const e = changeMap.get(c.key) ?? { key: c.key, title: c.title, services: [] };
      e.services.push({ service: s.service, tag: s.to.tag, inclusion: c.inclusion, detail: c.detail });
      changeMap.set(c.key, e);
    }
  }

  return {
    patchId,
    title: `${patchId}: ${S} → ${T}`,
    sourceEnv: S,
    targetEnv: T,
    mode: scope.mode,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    servers,
    steps: [...steps, ...rollback],
    skipped: scope.skipped,
    changes: [...changeMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    unknowns: [...new Set(unknowns)],
    assumptions,
    risks: [...new Set(risks)],
    errors,
  };
}
