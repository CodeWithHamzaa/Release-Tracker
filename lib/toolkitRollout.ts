// Runbook for rolling the ALARA toolkit itself (alara_deploy.sh v1.5 + payload)
// out to one environment's four servers. Mirrors the bundle's README and the
// deployer's real options: --env (required), --dry-run, --key-file, --old-key,
// --no-encrypt, never --yes on PROD. Containers are NOT restarted by the
// deployer, so restarts are a separate phase. The tracker only writes the
// steps; nothing is executed from here.

import { indexEnv, shellQuote } from './runbook.js';

export interface RolloutServer {
  environment: string;
  role: string;
  runAs: string | null;
  composePath: string | null;
  access: string | null;
}

export interface RolloutOptions {
  environment: string; // SIT | UAT | Prod
  bundle: string; // alara-deploy-v2.6-sit.tar.gz
  keyFile: string | null; // e.g. ~/alara_shared.key for the shared-key pass; null = toolkit only
  servers: RolloutServer[];
}

export interface RolloutStep {
  title: string;
  commands: string[];
  notes: string[];
}

export interface RolloutServerPlan {
  role: string;
  steps: RolloutStep[];
}

export interface RolloutPhase {
  title: string;
  intro: string[];
  servers: RolloutServerPlan[];
}

export interface ToolkitRollout {
  title: string;
  warnings: string[];
  phases: RolloutPhase[];
}

export const INSTALL_ORDER = ['Chat-Service', 'Database', 'ChatBot / NLU', 'Bot-Builder'] as const;
export const RESTART_ORDER = ['Database', 'ChatBot / NLU', 'Chat-Service', 'Bot-Builder'] as const;

// Same shape as the README: keep the last 5000 log lines of every container
// before a restart, privately (umask 077).
const PRESERVE_LOGS = `( umask 077; L=alara/logs/pre_restart_$(date +%Y%m%d_%H%M%S); mkdir -p "$L"
  for c in $(docker compose ps -a -q 2>/dev/null || docker-compose ps -q); do
    docker logs --timestamps --tail 5000 "$c" > "$L/$(docker inspect -f '{{.Name}}' "$c" | sed 's#^/##').log" 2>&1
  done; ls -l "$L" )`;

export function buildToolkitRollout(opts: RolloutOptions): ToolkitRollout {
  const env = indexEnv(opts.environment);
  const prod = env === 'PROD';
  const bundleDir = '~/alara-deploy';
  const warnings: string[] = [];
  if (prod) warnings.push('PROD: the deployer asks you to type PROD and refuses --yes. Run it interactively.');
  if (env !== 'SIT') warnings.push('UAT/PROD servers are reached through bank sessions without root: run as the account that owns the compose folder (it needs no sudo). Plan every step so one session covers it.');
  if (opts.keyFile) warnings.push('Shared-key pass: the key file travels separately (WinSCP), is never inside the bundle, and the payload must be stamped with its fingerprint (alara_key.sh stamp). The deployer deletes the transferred copy afterwards.');
  if (opts.servers.some((s) => !s.composePath)) warnings.push('Compose folder unknown for some servers (unverified): the deployer must be started from the folder holding docker-compose.yml.');

  const by = (role: string) => opts.servers.find((s) => s.role === role && indexEnv(s.environment) === env) ?? null;
  const keyArg = opts.keyFile ? ` --key-file ${shellQuote(opts.keyFile)}` : '';

  const install: RolloutPhase = {
    title: `Phase A: install the toolkit on each ${env} server (no restart)`,
    intro: [
      `Order: ${INSTALL_ORDER.join(' → ')}. The same bundle goes to all four servers.`,
      'Copy the bundle with WinSCP first. Run the dry run on every server before the live run on any of them.',
    ],
    servers: INSTALL_ORDER.map((role) => {
      const s = by(role);
      const cd = s?.composePath ? `cd ${shellQuote(s.composePath)}` : 'cd <compose folder>';
      return {
        role,
        steps: [
          {
            title: 'Unpack and check the bundle',
            commands: [`cd ~ && tar xzf ${shellQuote(opts.bundle)} && (cd alara-deploy && sha256sum -c SHA256SUMS)`],
            notes: [s?.runAs ? `Run as ${s.runAs}.` : 'Run as the account that owns the compose folder.'],
          },
          {
            title: 'Dry run (writes nothing)',
            commands: [cd, `${bundleDir}/alara_deploy.sh --env ${env}${keyArg} --dry-run`],
            notes: [
              `Must show: "Environment matches: ${env}" and the right role.`,
              'With encrypted values: "All N value(s) decrypt with the new toolkit — compatible." Any failure is a stop.',
              ...(opts.keyFile ? ['Key file: fingerprint must match the one stamped in the payload; a rekey dry run must pass.'] : []),
            ],
          },
          {
            title: 'Live run',
            commands: [`${bundleDir}/alara_deploy.sh --env ${env}${keyArg}`],
            notes: [
              prod ? 'Type PROD when asked. Never --yes (refused).' : "Type yes when asked.",
              'Must end with "Preflight passed.", "verified OK." and "Toolkit v2.6 installed", exit code 0.',
              'Exit codes: 0 done · 1 failed (read the message) · 2 refused, nothing changed.',
              'If it ends with "Post-install verify FAILED": do NOT restart. Run the rollback line it prints.',
            ],
          },
          {
            title: 'Verify',
            commands: ['./alara_server.sh doctor | head -12   # Server control : v2.6', "grep -m1 -E '^#\\s+v[0-9]' alara/alara_release_compare.sh   # v2.1", './alara_server.sh key check'],
            notes: [opts.keyFile ? 'Key check must show the shared key.' : '"EXPECTED NOT SET" is normal until the shared-key pass.'],
          },
          {
            title: 'If you need to undo (no restart needed)',
            commands: [
              'cp -a ~/alara-old-<stamp>/alara_*.sh ./ && cp -a ~/alara-old-<stamp>/alara/*.sh ./alara/',
              ...(opts.keyFile ? ['./alara_server.sh key rollback   # only after a --key-file run'] : []),
            ],
            notes: ['Env files and the master key are not modified by a toolkit-only run.'],
          },
        ],
      };
    }),
  };

  const restart: RolloutPhase = {
    title: `Phase B: restart each ${env} server (logs preserved first)`,
    intro: [
      `Order: ${RESTART_ORDER.join(' → ')}.`,
      'The deployer never restarts containers. Do this only after Phase A passed everywhere, and not during an incident.',
    ],
    servers: RESTART_ORDER.map((role) => {
      const s = by(role);
      const cd = s?.composePath ? `cd ${shellQuote(s.composePath)}` : 'cd <compose folder>';
      return {
        role,
        steps: [
          { title: 'Preserve logs, restart, check', commands: [cd, PRESERVE_LOGS, './alara_server.sh restart', './alara_server.sh status'], notes: ['Pass: every service running or healthy, nothing under "Exited Containers", env files still "encrypted (N values)", no *.alara_enc or *.dec files left.'] },
          ...(role === 'Database'
            ? [{ title: 'Database only: check the DR replica', commands: [], notes: ['On the DR server, once this database is back: SHOW REPLICA STATUS\\G (IO and SQL = Yes) and rs.status() (DR = SECONDARY). Unverified until a real restart: the replica should catch up by itself within about 10 minutes.'] }]
            : []),
        ],
      };
    }),
  };

  return { title: `ALARA toolkit rollout to ${env}`, warnings, phases: [install, restart] };
}

export function toolkitRolloutMarkdown(r: ToolkitRollout): string {
  const lines = [`# ${r.title}`, ''];
  for (const w of r.warnings) lines.push(`> ⚠ ${w}`);
  if (r.warnings.length) lines.push('');
  for (const phase of r.phases) {
    lines.push(`## ${phase.title}`, '', ...phase.intro.map((i) => `- ${i}`), '');
    for (const srv of phase.servers) {
      lines.push(`### ${srv.role}`, '');
      srv.steps.forEach((step, i) => {
        lines.push(`${i + 1}. **${step.title}**`);
        if (step.commands.length) lines.push('', '```bash', ...step.commands, '```');
        for (const n of step.notes) lines.push(`   - ${n}`);
        lines.push('');
      });
    }
  }
  return lines.join('\n');
}
