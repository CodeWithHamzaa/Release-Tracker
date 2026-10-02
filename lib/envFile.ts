// Minimal .env parser for the config vault: KEY=VALUE lines, optional
// `export`, single/double quotes, full-line and trailing ` #` comments.
// ENC[...] values (alara_env_encrypt.sh) are kept verbatim and flagged.

export interface EnvEntry {
  key: string;
  value: string;
  line: number; // 1-based
  encrypted: boolean;
}

export interface EnvParseResult {
  entries: EnvEntry[];
  duplicates: string[]; // keys set more than once (the last one wins)
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

export function isEncrypted(value: string): boolean {
  return /^ENC\[.*\]$/s.test(value.trim());
}

function unquote(raw: string): string {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    if (end > 0) return v.slice(1, end);
  }
  // Unquoted: " #" starts a comment; a # inside a URL (no space) does not.
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

export function parseEnvFile(text: string): EnvParseResult {
  const byKey = new Map<string, EnvEntry>();
  const duplicates = new Set<string>();
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      if (!raw.trim() || raw.trim().startsWith('#')) return;
      const m = LINE.exec(raw);
      if (!m) return;
      const value = unquote(m[2]);
      if (byKey.has(m[1])) duplicates.add(m[1]);
      byKey.set(m[1], { key: m[1], value, line: i + 1, encrypted: isEncrypted(value) });
    });
  return { entries: [...byKey.values()], duplicates: [...duplicates] };
}

// Keys whose plaintext values the viewer blurs until "Reveal". Display only:
// files are stored exactly as uploaded.
export function isSecretKey(key: string): boolean {
  return /(PASS(WORD|WD)?|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|(^|_)AUTH($|_)|(^|_)KEY$|CONN(ECTION)?_?STR)/i.test(key);
}

// True when a file name looks like an env file rather than YAML/conf.
export function isEnvFileName(path: string): boolean {
  return /^\.?env/i.test(path) || /\.env$/i.test(path) || /^\.[a-z]+_env$/i.test(path);
}
