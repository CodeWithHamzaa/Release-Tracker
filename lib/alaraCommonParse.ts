// Reads the toolkit's own alara_common.sh (the ALARA IP matrix, domain matrix,
// per-role env files, shared-key fingerprint and version) so the tracker's
// server registry can be checked against, or filled from, the toolkit instead
// of keeping a hand-maintained second copy. Pure text parsing: the file is
// never executed here.

import { trackerRole } from './toolkitParse.js';

export interface CommonRoleRow {
  code: string; // CHAT_BOT
  role: string; // tracker role name: ChatBot / NLU
  label: string;
  ips: { SIT: string; UAT: string; PROD: string };
}

export interface CommonDomainRow {
  name: string; // EVA
  domains: { SIT: string; UAT: string; PROD: string };
}

export interface ParsedCommon {
  version: string | null;
  roles: CommonRoleRow[];
  domains: CommonDomainRow[];
  envFiles: Record<string, string[]>; // role code -> files
  expectedKeyFp: string | null;
}

const ENVS = ['SIT', 'UAT', 'PROD'] as const;

// Contents of NAME=( ... ) between the parentheses, as the quoted entries.
function arrayEntries(text: string, name: string): string[] {
  const m = new RegExp(`^${name}=\\(([\\s\\S]*?)^\\)`, 'm').exec(text);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"\n]+)"/g)].map((x) => x[1]);
}

export function parseAlaraCommon(text: string): ParsedCommon {
  const version = /^#\s+v(\d+(?:\.\d+)*)\s*$/m.exec(text)?.[1] ?? null;

  const roles: CommonRoleRow[] = [];
  for (const entry of arrayEntries(text, 'ALARA_IP_TABLE')) {
    const [code, label, sit, uat, prod] = entry.split('|');
    if (!code || !label || ![sit, uat, prod].every((v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v ?? ''))) continue;
    roles.push({ code, role: trackerRole(code), label, ips: { SIT: sit, UAT: uat, PROD: prod } });
  }

  const domains: CommonDomainRow[] = [];
  for (const entry of arrayEntries(text, 'ALARA_DOMAIN_TABLE')) {
    const [name, sit, uat, prod] = entry.split('|');
    if (name && sit && uat && prod) domains.push({ name, domains: { SIT: sit, UAT: uat, PROD: prod } });
  }

  const envFiles: Record<string, string[]> = {};
  const fn = /alara_env_files_for_role\(\)\s*\{\s*case "\$1" in([\s\S]*?)esac/.exec(text);
  if (fn) {
    for (const m of fn[1].matchAll(/^\s*([A-Z_|]+)\)\s*echo "([^"]*)"/gm)) {
      if (m[1] === '*') continue;
      for (const code of m[1].split('|')) envFiles[code] = m[2].split(/\s+/).filter(Boolean);
    }
  }

  const fp = /^ALARA_EXPECTED_KEY_FP="([0-9a-f]*)"/m.exec(text)?.[1] ?? null;
  return { version, roles, domains, envFiles, expectedKeyFp: fp || null };
}

export interface RegistryNode {
  id: string;
  environment: string; // SIT | UAT | Prod
  role: string;
  ip: string | null;
  domain: string | null;
  envFiles: string[];
}

export interface RegistryChange {
  id: string;
  environment: string;
  role: string;
  field: 'ip' | 'domain' | 'envFiles';
  current: string | null;
  fromToolkit: string;
  patch: { ip?: string; domain?: string; envFiles?: string[] };
}

const envKey = (e: string): (typeof ENVS)[number] | null => {
  const u = e.trim().toUpperCase();
  return (ENVS as readonly string[]).includes(u) ? (u as (typeof ENVS)[number]) : null;
};

// What the toolkit says versus what the registry holds. Only differences are
// listed; a registry cell that already agrees produces nothing. The tracker
// never writes anything back to the toolkit.
export function registryChanges(common: ParsedCommon, nodes: RegistryNode[]): RegistryChange[] {
  const out: RegistryChange[] = [];
  const eva = common.domains.find((d) => d.name === 'EVA');
  for (const n of nodes) {
    const env = envKey(n.environment);
    const row = common.roles.find((r) => r.role === n.role);
    if (!env || !row) continue;
    const ip = row.ips[env];
    if (n.ip !== ip) out.push({ id: n.id, environment: n.environment, role: n.role, field: 'ip', current: n.ip, fromToolkit: ip, patch: { ip } });
    const domain = eva?.domains[env];
    if (domain && n.domain !== domain) {
      out.push({ id: n.id, environment: n.environment, role: n.role, field: 'domain', current: n.domain, fromToolkit: domain, patch: { domain } });
    }
    const files = common.envFiles[row.code];
    if (files && files.join(' ') !== n.envFiles.join(' ')) {
      out.push({ id: n.id, environment: n.environment, role: n.role, field: 'envFiles', current: n.envFiles.join(', ') || null, fromToolkit: files.join(', '), patch: { envFiles: files } });
    }
  }
  return out;
}
