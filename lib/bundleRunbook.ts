// Runbook and Bank IT / Ops brief for one release bundle, deployed into one
// target environment. Like every generator in this tracker it only writes
// text: nothing here connects to or runs anything on a server.
//
//   Runbook, standard  the commands a deployment needs: back up, load images,
//                      set the new tags, apply config, restart, verify, roll back.
//   Runbook, detailed  standard plus pre-flight safety checks: disk space, tar
//                      hashes, compose validity, current image IDs as the
//                      rollback point, health and logs after the restart.
//   Ops brief          one page for the bank's IT / Ops team: which servers,
//                      what happens in what order, downtime, rollback. No code
//                      changes, versions per developer, notes or config values.
//
// Unknown facts (IP, compose folder, tar folder, image name) are written as
// <PLACEHOLDERS> and listed at the end, never guessed. Config values go
// through lib/redact.ts, so secrets never land in a generated document.

import { shellArg as quote } from './shell.js';
import { redactText } from './redact.js';
import { envLabel } from './environments.js';
import { serverOrder } from './releaseFeed.js';

export type RunbookMode = 'standard' | 'detailed';

export interface RunbookService {
  server: string; // role
  service: string; // catalog name
  version: string;
  developerName: string;
  composeKey?: string | null; // key under services: in the target compose file, when known
  image?: string | null; // image repository (without tag) in the target, when known
  envDetails?: string | null;
  configDetails?: string | null;
  commandDetails?: string | null;
}

export interface RunbookServer {
  role: string;
  ip: string | null;
  composePath: string | null;
  runAs: string | null;
  access: string | null;
}

export interface RunbookInput {
  releaseId: string;
  title: string;
  sourceEnvironment: string | null; // where the builds were tested (null: not a promotion)
  targetEnvironment: string;
  hasConfigChange: boolean;
  configDetails: string | null;
  services: RunbookService[];
  servers: RunbookServer[]; // registry rows for the target environment
  mode: RunbookMode;
  generatedAt: Date;
}

// Placeholders stay bare so they read as "fill me in"; real values are quoted
// when they need it.
const shellArg = (v: string) => (/^<[A-Z0-9_]+>$/.test(v) ? v : quote(v));
const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fence = (lines: string[]) => ['```bash', ...lines, '```'];
const hasText = (s?: string | null): s is string => typeof s === 'string' && s.trim().length > 0;

export function patchId(releaseId: string, at: Date): string {
  const d = at.toISOString().slice(0, 10).replace(/-/g, '');
  return `REL-${d}-${releaseId.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase()}`;
}

// Env/config lines that look like KEY=value, for the ops brief (keys only).
export function changedKeys(text: string | null | undefined): string[] {
  if (!hasText(text)) return [];
  const keys = text
    .split('\n')
    .map((l) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]/.exec(l)?.[1])
    .filter((k): k is string => !!k);
  return [...new Set(keys)];
}

interface ServerPlan {
  role: string;
  server: RunbookServer | null;
  services: RunbookService[];
  host: string;
  folder: string;
  login: string;
}

function plans(input: RunbookInput, unknowns: Set<string>): ServerPlan[] {
  const env = envLabel(input.targetEnvironment);
  return serverOrder(input.services.map((s) => s.server)).map((role) => {
    const server = input.servers.find((s) => s.role === role) ?? null;
    const tag = role.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    const host = server?.ip ?? `<${env}_${tag}_IP>`;
    const folder = server?.composePath ?? `<${env}_${tag}_COMPOSE_DIR>`;
    const login = server?.runAs ?? `<${env}_${tag}_USER>`;
    if (!server?.ip) unknowns.add(`${role} (${env}): server IP is not in the server registry.`);
    if (!server?.composePath) unknowns.add(`${role} (${env}): compose folder is not in the server registry.`);
    if (!server?.runAs) unknowns.add(`${role} (${env}): run-as account is not in the server registry.`);
    return { role, server, host, folder, login, services: input.services.filter((s) => s.server === role) };
  });
}

const keyOf = (s: RunbookService) => s.composeKey || s.service;
const tarOf = (s: RunbookService) => `${'<TAR_DIR>'}/${s.service}_${s.version}.tar`;
const imageRef = (s: RunbookService) => `${s.image ?? `<${s.service.toUpperCase()}_IMAGE>`}:${s.version}`;

export function renderRunbook(input: RunbookInput): string {
  const detailed = input.mode === 'detailed';
  const unknowns = new Set<string>(['<TAR_DIR>: the folder the image tars were copied to on each server.']);
  const servers = plans(input, unknowns);
  const id = patchId(input.releaseId, input.generatedAt);
  const target = envLabel(input.targetEnvironment);
  const out: string[] = [];
  let n = 0;
  const step = (title: string) => out.push('', `### [ ] ${++n}. ${title}`, '');

  out.push(
    `# Runbook: ${input.title}`,
    '',
    `- **Patch ID:** \`${id}\``,
    `- **Target environment:** ${target}${input.sourceEnvironment ? ` (promoted from ${envLabel(input.sourceEnvironment)})` : ''}`,
    `- **Mode:** ${detailed ? 'Detailed (with pre-flight safety checks)' : 'Standard (deployment commands only)'}`,
    `- **Generated:** ${input.generatedAt.toISOString()}`,
    `- **Servers:** ${servers.map((s) => s.role).join(' → ')} (in this order)`,
    ''
  );
  if (input.hasConfigChange) {
    out.push('> **⚠ Config change required.** This release changes environment variables or configuration. Apply the config steps below before restarting the services.', '');
  }

  out.push('## 1. Builds in this release', '', '| Server | Service | Version | Image | Owner |', '|---|---|---|---|---|');
  for (const s of input.services) {
    out.push(`| ${md(s.server)} | \`${md(keyOf(s))}\` | \`${md(s.version)}\` | \`${md(imageRef(s))}\` | ${md(s.developerName || '—')} |`);
    if (!s.image) unknowns.add(`${s.service}: image repository is unknown (no compose file for ${target} in the Config Vault); fill in <${s.service.toUpperCase()}_IMAGE>.`);
    if (!s.composeKey) unknowns.add(`${s.service}: compose service key not confirmed from the ${target} compose file; the commands use "${s.service}".`);
  }

  if (hasText(input.configDetails)) {
    out.push('', '## 2. Configuration summary', '', '```', redactText(input.configDetails.trim()), '```');
  }

  out.push('', '## 3. Deployment steps');
  for (const p of servers) {
    const keys = p.services.map((s) => shellArg(keyOf(s))).join(' ');
    out.push('', `## ${p.role} — ${p.host}`);

    step(`Log in to ${p.role} and open the compose folder`);
    if (p.server?.access) out.push(`Access: ${p.server.access}`, '');
    out.push(...fence([`ssh ${shellArg(p.login)}@${shellArg(p.host)}`, `cd ${shellArg(p.folder)}`]));

    if (detailed) {
      step('Pre-flight checks');
      out.push(
        ...fence([
          `hostname; hostname -I   # expect ${p.host}`,
          `df -h ${shellArg(p.folder)} /var/lib/docker   # expect enough free space for the new images`,
          'docker compose config -q && echo "compose OK"',
          ...p.services.map((s) => `ls -lh ${tarOf(s)}`),
          ...p.services.map((s) => `sha256sum ${tarOf(s)}   # compare with the hash the developer supplied`),
          `docker compose ps ${keys}`,
          `docker compose images ${keys}   # write down the current image IDs: they are the rollback point`,
        ]),
        '- **Stop if:** the host or IP is not the expected one, disk is short, compose is invalid, a tar is missing or a hash differs.'
      );
    }

    step('Back up the compose and env files');
    out.push(
      ...fence([
        `cp -p docker-compose.yml docker-compose.yml.before-${id}`,
        ...(detailed || p.services.some((s) => hasText(s.envDetails))
          ? [`for f in .env*; do [ -f "$f" ] && cp -p "$f" "$f.before-${id}"; done`]
          : []),
      ])
    );

    step('Load the new images');
    out.push(...fence(p.services.map((s) => `docker load -i ${tarOf(s)}`)));
    if (detailed) out.push(...fence(p.services.map((s) => `docker image inspect ${shellArg(imageRef(s))} --format '{{.Id}}'`)));

    step('Set the new image tags in docker-compose.yml');
    out.push('Edit the `image:` line of each service (a manual edit: one compose file can name the same image more than once).', '');
    for (const s of p.services) out.push(`- \`${keyOf(s)}\` → \`image: ${imageRef(s)}\``);
    out.push('', ...fence([...p.services.map((s) => `grep -n ${shellArg(`${s.image ?? s.service}:`)} docker-compose.yml`), 'docker compose config -q && echo "compose OK"']));

    const envServices = p.services.filter((s) => hasText(s.envDetails) || hasText(s.configDetails));
    if (envServices.length) {
      step('Apply environment / configuration changes');
      out.push('Set these in the env file the service reads. Values shown as [redacted] are secrets: set them by hand from the secure channel.', '');
      for (const s of envServices) {
        out.push(`**${s.service}**`, '');
        if (hasText(s.envDetails)) out.push('```env', redactText(s.envDetails.trim()), '```');
        if (hasText(s.configDetails)) out.push('```', redactText(s.configDetails.trim()), '```');
      }
    }

    const commandServices = p.services.filter((s) => hasText(s.commandDetails));
    if (commandServices.length) {
      step('Commands supplied with the release');
      out.push('Review before running: these were written by the release author, not generated.', '');
      for (const s of commandServices) out.push(`**${s.service}**`, '', ...fence(redactText(s.commandDetails!.trim()).split('\n')));
    }

    step('Restart the updated services');
    out.push(...fence([`docker compose up -d --no-deps ${keys}`]));

    step('Verify');
    out.push(
      ...fence([
        `docker compose ps ${keys}   # expect: Up${detailed ? ' (healthy)' : ''}`,
        `docker compose images ${keys}   # expect the new tags`,
        ...(detailed
          ? [
              ...p.services.map((s) => `docker inspect --format '{{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' $(docker compose ps -q ${shellArg(keyOf(s))})`),
              `docker compose logs --tail=100 ${keys}   # expect no errors`,
            ]
          : []),
      ])
    );
    out.push(`- **Expected:** ${p.services.map((s) => `${keyOf(s)} on ${s.version}`).join(', ')}.`, '- **If it fails:** roll this server back (below) and stop.');
  }

  out.push('', '## 4. Rollback (per server, only if needed)');
  for (const p of servers) {
    const keys = p.services.map((s) => shellArg(keyOf(s))).join(' ');
    out.push(
      '',
      `### ${p.role} — ${p.host}`,
      '',
      ...fence([
        `cd ${shellArg(p.folder)}`,
        `cp -p docker-compose.yml.before-${id} docker-compose.yml`,
        `for f in .env*.before-${id}; do [ -f "$f" ] && cp -p "$f" "\${f%.before-${id}}"; done`,
        `docker compose up -d --no-deps ${keys}`,
        `docker compose images ${keys}   # expect the previous tags`,
      ])
    );
  }

  out.push('', '## 5. Checklist', '');
  for (const p of servers) {
    out.push(`- [ ] ${p.role}: images loaded, tags set${p.services.some((s) => hasText(s.envDetails) || hasText(s.configDetails)) ? ', config applied' : ''}, services restarted and verified`);
  }
  out.push('- [ ] Upload `./alara_server.sh status` (or the deployment receipt) to the tracker as evidence', '- [ ] Set the release status in the tracker');

  out.push('', '## 6. Unknowns (fill in before running)', '', ...[...unknowns].map((u) => `- ${u}`), '');
  return out.join('\n');
}

export function renderOpsBrief(input: RunbookInput): string {
  const unknowns = new Set<string>();
  const servers = plans(input, unknowns);
  const id = patchId(input.releaseId, input.generatedAt);
  const target = envLabel(input.targetEnvironment);
  const keys = [...new Set(input.services.flatMap((s) => [...changedKeys(s.envDetails), ...changedKeys(s.configDetails)]))];
  const owners = [...new Set(input.services.map((s) => s.developerName).filter(Boolean))];

  const out = [
    `# Deployment brief — ${target}`,
    '',
    `**Change:** ${input.title}  `,
    `**Reference:** \`${id}\`  `,
    `**Environment:** ${target}  `,
    `**Maintenance window:** <DATE / TIME>  `,
    '**Expected downtime:** a short restart of each updated service (about 1–2 minutes per service); other services stay up.',
    '',
    '## Servers involved (in this order)',
    '',
    '| # | Server | Address | Services restarted |',
    '|---|---|---|---|',
    ...servers.map((p, i) => `| ${i + 1} | ${md(p.role)} | ${md(p.host)} | ${p.services.length} |`),
    '',
    '## What the operator does on each server',
    '',
    '1. Back up the current `docker-compose.yml` and env files.',
    '2. Load the supplied image files (`docker load`).',
    '3. Update the image versions in `docker-compose.yml`.',
    ...(input.hasConfigChange ? ['4. Apply the configuration / environment changes listed below.'] : []),
    `${input.hasConfigChange ? 5 : 4}. Restart only the updated services (\`docker compose up -d --no-deps\`).`,
    `${input.hasConfigChange ? 6 : 5}. Check that the services are up and on the new versions.`,
    '',
    '## Configuration change required',
    '',
    input.hasConfigChange
      ? keys.length
        ? `**Yes.** Settings to change: ${keys.map((k) => `\`${k}\``).join(', ')}. Values are supplied separately by the release owner.`
        : '**Yes.** The release owner will supply the settings and values separately.'
      : 'No.',
    '',
    '## Rollback',
    '',
    'Each server is rolled back on its own by restoring the backed-up `docker-compose.yml` and env files and restarting the same services. The previous images stay on the server, so no download is needed.',
    '',
    '## Prerequisites from Bank IT',
    '',
    '- Access to the servers above through the usual jump server, with the deployment account.',
    '- The image files copied to each server before the window.',
    '- Enough free disk space for the new images.',
    '',
    '## Contacts',
    '',
    `- Release owner(s): ${owners.length ? owners.join(', ') : '<NAME>'}`,
    '- Bank IT on call: <NAME / NUMBER>',
    '',
  ];
  return out.join('\n');
}
