// Drift between the same config file across environments (config vault).
//
// Env files: compared key by key. A value that differs only because each
// environment uses its own server IPs / domain (from the server registry) is
// "expected" -- the same idea as alara_env_generate.sh substituting IP/DNS.
// ENC[...] values can't be compared (random IV), only their presence.
//
// Compose files: compared service by service -- image tag (the per-environment
// baseline version), published host ports, env_file list and volumes.

import { parse } from 'yaml';
import { diffLines } from 'diff';
import { parseEnvFile } from './envFile.js';
import { parseCompose } from './compose.js';

export type DriftLabel = 'same' | 'missing' | 'differs' | 'expected' | 'encrypted';

// Per environment: the literal strings that are environment-specific (server
// IPs, domain) and the neutral placeholder each stands for.
export type EnvTokens = Record<string, { token: string; placeholder: string }[]>;

export interface EnvDriftRow {
  key: string;
  values: Record<string, { value: string; encrypted: boolean } | null>;
  label: DriftLabel;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replace each environment-specific token with its placeholder, matching
// whole tokens only (10.42.42.25 must not match inside 10.42.42.250).
export function normalizeValue(value: string, tokens: { token: string; placeholder: string }[] = []): string {
  let out = value;
  for (const { token, placeholder } of [...tokens].sort((a, b) => b.token.length - a.token.length)) {
    if (!token) continue;
    out = out.replace(new RegExp(`(?<![\\w.-])${escapeRegExp(token)}(?![\\w-]|\\.\\w)`, 'g'), placeholder);
  }
  return out;
}

// files: environment -> file content, or null when that environment has no copy.
export function envDrift(files: Record<string, string | null>, tokens: EnvTokens = {}): EnvDriftRow[] {
  const envs = Object.keys(files).filter((e) => files[e] !== null);
  const parsed: Record<string, Map<string, { value: string; encrypted: boolean }>> = {};
  for (const env of envs) {
    parsed[env] = new Map(parseEnvFile(files[env]!).entries.map((e) => [e.key, { value: e.value, encrypted: e.encrypted }]));
  }
  const keys = [...new Set(envs.flatMap((env) => [...parsed[env].keys()]))].sort();

  return keys.map((key) => {
    const values: EnvDriftRow['values'] = {};
    for (const env of Object.keys(files)) values[env] = files[env] === null ? null : parsed[env].get(key) ?? null;
    const present = envs.map((env) => values[env]).filter(Boolean) as { value: string; encrypted: boolean }[];

    let label: DriftLabel;
    if (present.length < envs.length) label = 'missing';
    else if (present.every((v) => v.encrypted)) label = 'encrypted';
    else if (present.some((v) => v.encrypted)) label = 'differs'; // encrypted in one env, plaintext in another
    else if (present.every((v) => v.value === present[0].value)) label = 'same';
    else {
      const normalized = envs.map((env) => normalizeValue(values[env]!.value, tokens[env]));
      label = normalized.every((v) => v === normalized[0]) ? 'expected' : 'differs';
    }
    return { key, values, label };
  });
}

// "registry/ldap-connector:2.4.2" -> "2.4.2"; no tag -> "latest".
export function imageTag(image: string | null): string | null {
  if (!image) return null;
  const at = image.indexOf('@');
  if (at !== -1) return image.slice(at + 1, at + 20); // digest
  const lastSlash = image.lastIndexOf('/');
  const colon = image.lastIndexOf(':');
  return colon > lastSlash ? image.slice(colon + 1) : 'latest';
}

export function imageRepo(image: string | null): string | null {
  if (!image) return null;
  const noDigest = image.split('@')[0];
  const lastSlash = noDigest.lastIndexOf('/');
  const colon = noDigest.lastIndexOf(':');
  const repo = colon > lastSlash ? noDigest.slice(0, colon) : noDigest;
  return repo.slice(repo.lastIndexOf('/') + 1);
}

export interface ComposeServiceSummary {
  name: string;
  containerName: string | null;
  image: string | null;
  tag: string | null;
  ports: string; // "80→80, 443→443"
  envFiles: string;
  volumes: string;
}

export function summarizeCompose(text: string): ComposeServiceSummary[] {
  const { services } = parseCompose(text);
  let doc: any = null;
  try {
    doc = parse(text, { merge: true });
  } catch {
    // parseCompose already reported it
  }
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.path ?? x?.source ?? JSON.stringify(x))) : typeof v === 'string' ? [v] : [];
  return services.map((s) => {
    const def = doc?.services?.[s.name] ?? {};
    return {
      name: s.name,
      containerName: s.containerName,
      image: s.image,
      tag: imageTag(s.image),
      ports: s.ports
        .map((p) => `${p.hostPort}→${p.containerPort}${p.protocol === 'tcp' ? '' : '/' + p.protocol}`)
        .join(', '),
      envFiles: list(def.env_file).join(', '),
      volumes: list(def.volumes).join(', '),
    };
  });
}

export interface ComposeDriftRow {
  service: string;
  perEnv: Record<string, ComposeServiceSummary | null>;
  labels: { image: DriftLabel; ports: DriftLabel; envFiles: DriftLabel; volumes: DriftLabel };
}

export function composeDrift(files: Record<string, string | null>): ComposeDriftRow[] {
  const envs = Object.keys(files).filter((e) => files[e] !== null);
  const summaries: Record<string, Map<string, ComposeServiceSummary>> = {};
  for (const env of envs) summaries[env] = new Map(summarizeCompose(files[env]!).map((s) => [s.name, s]));
  const names = [...new Set(envs.flatMap((env) => [...summaries[env].keys()]))].sort();

  const labelFor = (vals: (string | null)[]): DriftLabel => (vals.every((v) => v === vals[0]) ? 'same' : 'differs');
  return names.map((service) => {
    const perEnv: ComposeDriftRow['perEnv'] = {};
    for (const env of Object.keys(files)) perEnv[env] = files[env] === null ? null : summaries[env].get(service) ?? null;
    const present = envs.map((env) => perEnv[env]).filter(Boolean) as ComposeServiceSummary[];
    const missing = present.length < envs.length;
    return {
      service,
      perEnv,
      labels: missing
        ? { image: 'missing', ports: 'missing', envFiles: 'missing', volumes: 'missing' }
        : {
            image: labelFor(present.map((p) => p.tag)),
            ports: labelFor(present.map((p) => p.ports)),
            envFiles: labelFor(present.map((p) => p.envFiles)),
            volumes: labelFor(present.map((p) => p.volumes)),
          },
    };
  });
}

// Version of a catalog service in a compose file: matched by compose service
// key, container_name, or image repository name (container names differ
// between environments, e.g. alara-ui2 vs alara-ui).
export function versionOf(summaries: ComposeServiceSummary[], serviceName: string): ComposeServiceSummary | null {
  return (
    summaries.find((s) => s.name === serviceName) ||
    summaries.find((s) => s.containerName === serviceName) ||
    summaries.find((s) => imageRepo(s.image) === serviceName) ||
    null
  );
}

// Image tag changes between two versions of one compose file.
export function imageChanges(before: string | null, after: string): { service: string; from: string | null; to: string }[] {
  const old = new Map((before ? summarizeCompose(before) : []).map((s) => [s.name, s.tag]));
  return summarizeCompose(after)
    .filter((s) => s.tag && old.get(s.name) !== s.tag)
    .map((s) => ({ service: s.name, from: old.get(s.name) ?? null, to: s.tag! }));
}

export interface DiffLine {
  type: 'add' | 'del' | 'same';
  text: string;
}

export function lineDiff(a: string, b: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const part of diffLines(a, b)) {
    const type = part.added ? 'add' : part.removed ? 'del' : 'same';
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const text of lines) out.push({ type, text });
  }
  return out;
}
