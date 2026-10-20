// Secret redaction for anything the planner shows, returns from the API or
// writes into a generated document. Comparison screens, steps and runbooks
// only ever see the output of these functions, never a raw vault value.
//
// A value is withheld when its KEY looks sensitive (the vault viewer's list
// plus the snapshot tool's list, so REDIS_URL / MONGO_URI count too), or when
// the VALUE itself carries a secret: an ENC[...] blob, a SHA256:<hash> from a
// snapshot, a private key, a JWT, or credentials inside a URL.

import { isEncrypted, isSecretKey } from './envFile.js';

export const REDACTED = '[redacted]';

// Same list as alara_release_snapshot.sh v2.0 (substring, upper-cased).
const SNAPSHOT_SENSITIVE = [
  'PASSWORD', 'SECRET', 'ACCESS_KEY', 'SESSION_KEY', 'MASTER_KEY', 'API_KEY', 'TOKEN',
  'REDIS_URL', 'MONGO_URI', 'MONGODB_URL', 'DATABASE_URL', 'DSN', 'CONNECTION_STRING',
];

export function isSensitiveKey(key: string): boolean {
  const k = key.toUpperCase();
  return isSecretKey(key) || SNAPSHOT_SENSITIVE.some((p) => k.includes(p));
}

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
// A sensitive-looking name followed by = or : inside a line, e.g.
// `command: --db-password=xyz` or `-e API_TOKEN=abc`.
const INLINE_SECRET = /([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*\s*[=:]\s*)[^\s'"]+/gi;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi;

// True when the value alone shows it is secret, whatever its key.
export function isSensitiveValue(value: string): boolean {
  return isEncrypted(value) || value.startsWith('SHA256:') || PRIVATE_KEY.test(value) || JWT.test(value);
}

export function isSecret(key: string, value: string | null | undefined): boolean {
  return isSensitiveKey(key) || (!!value && isSensitiveValue(value));
}

// The value safe to show for `key`, or REDACTED. URL passwords are masked in
// place so a non-secret URL stays readable: amqp://app:[redacted]@10.0.0.5.
export function redactValue(key: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (isSecret(key, value)) return REDACTED;
  return value.replace(URL_CREDENTIALS, (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`);
}

// Free text (an error message, a compose line) with any KEY=value secrets and
// URL passwords masked. Used for text that is not a single key/value pair.
export function redactText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\s*(?:-\s*)?(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)(.*)$/.exec(line);
      if (m && m[4] && isSecret(m[2], m[4].trim())) return `${m[1]}${m[2]}${m[3]}${REDACTED}`;
      if (PRIVATE_KEY.test(line) || JWT.test(line)) return REDACTED;
      return line
        .replace(URL_CREDENTIALS, (_x, scheme, user) => `${scheme}${user}:${REDACTED}@`)
        .replace(INLINE_SECRET, (_x, name) => `${name}${REDACTED}`);
    })
    .join('\n');
}
