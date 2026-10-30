// Validation for /api/releases writes: a release bundle (title, environment,
// date, status, config flag) plus one record per service. The service records
// go through lib/recordInput.ts, so a bundle enforces exactly the same record
// rules as POST /api/records.
//
// Backdating: unlike POST /api/records, a release takes an explicit
// `releasedAt` (validated by lib/recordDate.ts: a real date after 2000, at most
// a day ahead). Its records are stamped with that date, so a forgotten patch
// logged today still sorts, and sets current versions, as of when it happened.

import type { ReleaseRecord, ReleaseStatus } from './types.js';
import { details, environment, flag, isFail, label, normalizeNewRecords, RecordContext, status } from './recordInput.js';
import { parseRecordDate } from './recordDate.js';

const MAX_TITLE = 150;
const MAX_NOTE = 5_000;

type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });

export interface ReleaseFields {
  title: string;
  environment: string;
  status: ReleaseStatus;
  releasedAt: Date;
  hasConfigChange: boolean;
  configDetails: string | null;
  note: string | null;
}

export type NewRelease = { ok: true; release: ReleaseFields; records: ReleaseRecord[] } | Fail;

function title(body: any, required: boolean) {
  return label(body, 'title', required, MAX_TITLE);
}

function releaseNote(body: any): { ok: true; value: string | null | undefined } | Fail {
  if (body.note === undefined) return { ok: true, value: undefined };
  if (body.note === null) return { ok: true, value: null };
  if (typeof body.note !== 'string') return fail('note must be text.');
  const v = body.note.trim();
  if (v.length > MAX_NOTE) return fail(`note must be at most ${MAX_NOTE} characters.`);
  if (v.includes('\u0000')) return fail('note must not contain null characters.');
  return { ok: true, value: v || null };
}

function releasedAt(body: any, now: Date): { ok: true; value: Date | undefined } | Fail {
  const raw = body.releasedAt;
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined };
  const d = parseRecordDate(raw, now);
  return d ? { ok: true, value: d } : fail('Release date is invalid (must be a real date after 2000 and not in the future).');
}

// POST /api/releases body:
//   { title, environment, status?, releasedAt?, hasConfigChange?, configDetails?,
//     note, source?, services: [{ server, service, version, developerName?, ... }] }
// Shared record fields (note, source, env/config/command details and flags)
// sit at the top level and each service may override them, as in the
// existing { services: [...] } batch.
export function normalizeNewRelease(body: unknown, ctx: RecordContext): NewRelease {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Send the release as an object.');
  const b = body as any;
  if (!Array.isArray(b.services) || b.services.length === 0) return fail('A release needs at least one service.');
  const now = ctx.now ?? new Date();

  const t = title(b, true);
  if (isFail(t)) return t;
  const env = environment(b, true);
  if (isFail(env)) return env;
  const st = status(b);
  if (isFail(st)) return st;
  const at = releasedAt(b, now);
  if (isFail(at)) return at;
  const cfgFlag = flag(b, 'hasConfigChange');
  if (isFail(cfgFlag)) return cfgFlag;
  // The shared configDetails is the bundle's config summary and is also kept on
  // each record (as the batch form always did).
  const cfg = details(b, 'configDetails');
  if (isFail(cfg)) return cfg;

  const { title: _t, releasedAt: _r, hasConfigChange: _h, ...recordBody } = b;
  const parsed = normalizeNewRecords(recordBody, ctx);
  if (isFail(parsed)) return parsed;

  const when = at.value ?? now;
  const records = parsed.records.map((r) => ({ ...r, createdAt: when.toISOString() }));
  const hasConfigChange = cfgFlag.value ?? records.some((r) => r.isConfigUpdate || r.isEnvUpdate);

  return {
    ok: true,
    release: {
      title: t.value!,
      environment: env.value!,
      status: st.value ?? 'PENDING',
      releasedAt: when,
      hasConfigChange,
      configDetails: cfg.value ?? null,
      note: records[0].note ?? null, // mandatory, validated on every record by recordInput
    },
    records,
  };
}

export type ReleasePatch =
  | { ok: true; data: Partial<ReleaseFields>; applyStatusToRecords: boolean }
  | Fail;

// PATCH /api/releases/:id: only the fields present change.
// `applyStatusToRecords: true` also sets every service record in the bundle to
// the new status; without it the bundle status changes on its own.
export function normalizeReleasePatch(body: unknown, now: Date = new Date()): ReleasePatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Send the fields to change as an object.');
  const b = body as any;
  const data: Partial<ReleaseFields> = {};

  const t = title(b, false);
  if (isFail(t)) return t;
  if (t.value !== undefined) data.title = t.value;
  const st = status(b);
  if (isFail(st)) return st;
  if (st.value !== undefined) data.status = st.value;
  const at = releasedAt(b, now);
  if (isFail(at)) return at;
  if (at.value !== undefined) data.releasedAt = at.value;
  const cfgFlag = flag(b, 'hasConfigChange');
  if (isFail(cfgFlag)) return cfgFlag;
  if (cfgFlag.value !== undefined) data.hasConfigChange = cfgFlag.value;
  const cfg = details(b, 'configDetails');
  if (isFail(cfg)) return cfg;
  if (cfg.value !== undefined) data.configDetails = cfg.value;
  const n = releaseNote(b);
  if (isFail(n)) return n;
  if (n.value !== undefined) data.note = n.value;

  const apply = flag(b, 'applyStatusToRecords');
  if (isFail(apply)) return apply;
  if (apply.value && !data.status) return fail('applyStatusToRecords needs a status.');
  if (Object.keys(data).length === 0) return fail('Nothing to update.');
  return { ok: true, data, applyStatusToRecords: apply.value ?? false };
}
