// Turns release records into "Changes since last sync" lines for section 1.2
// of the ALARA knowledge index:
//   YYYY-MM-DD | ENV  | ROLE         | what changed
// Newest first. Records on the same day + env + role become one line. A
// PATCH id found in the note (e.g. "PATCH-2026-09-20") is shown as
// "patch <id>:". PENDING records are skipped: they haven't happened yet.

import type { ReleaseRecord } from './types.js';
import { indexEnv, indexRole } from './runbook.js';

const PATCH_IN_NOTE = /\bPATCH[-_][A-Za-z0-9._-]+/i;

function localDate(value: string | Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function syncLines(records: ReleaseRecord[], since?: string): string[] {
  type Group = { date: string; env: string; role: string; patch: string | null; items: string[]; latest: number };
  const groups = new Map<string, Group>();

  for (const r of records) {
    const status = String(r.status || '').toUpperCase();
    if (status !== 'SUCCESS' && status !== 'FAILED') continue;
    const date = localDate(r.createdAt);
    if (since && date < since) continue;

    const env = indexEnv(r.environment || '');
    const role = indexRole(r.server || '');
    const key = `${date}|${env}|${role}`;
    let g = groups.get(key);
    if (!g) {
      g = { date, env, role, patch: null, items: [], latest: 0 };
      groups.set(key, g);
    }
    const patch = r.note ? PATCH_IN_NOTE.exec(r.note)?.[0] ?? null : null;
    if (patch && !g.patch) g.patch = patch;
    const item = `${r.service} ${r.version}${status === 'FAILED' ? ' (FAILED)' : ''}`;
    if (!g.items.includes(item)) g.items.push(item);
    g.latest = Math.max(g.latest, new Date(r.createdAt).getTime());
  }

  return [...groups.values()]
    .sort((a, b) => (a.date === b.date ? b.latest - a.latest : a.date < b.date ? 1 : -1))
    .map((g) => {
      const what = `${g.patch ? `patch ${g.patch}: ` : 'release: '}${g.items.join(', ')}`;
      return `${g.date} | ${g.env.padEnd(4)} | ${g.role.padEnd(12)} | ${what}`;
    });
}
