// Validation and normalisation for every /api/records write (POST single,
// POST array, POST { services: [...] } batch, PATCH), so all paths enforce the
// same rules.
//
// Never taken from the client: id, createdAt, updatedAt and added_by. The id
// and timestamps are generated here and added_by is the signed-in user, so the
// audit trail cannot be spoofed or backdated through POST. (A deployment date
// can still be corrected through PATCH, which has its own date check.)

import crypto from 'crypto';
import type { ReleaseRecord, ReleaseStatus } from './types.js';
import { validateNote } from './releaseNote.js';
import { canonicalEnvironment, ENVIRONMENTS } from './environments.js';

export { canonicalEnvironment };
export const RECORD_ENVIRONMENTS = ENVIRONMENTS;
export const RECORD_STATUSES: readonly ReleaseStatus[] = ['SUCCESS', 'FAILED', 'PENDING'];

export const MAX_RECORDS_PER_REQUEST = 100;
const MAX_LABEL = 100; // server, service, version, developer, source
const MAX_NOTE = 5_000;
const MAX_DETAILS = 20_000; // env / config / command blocks

export type RecordContext = {
  addedBy: string; // authenticated user, stamped on every new record
  defaultDeveloper: string;
  now?: Date;
};

type Fail = { ok: false; message: string };
type Field<T> = { ok: true; value: T } | Fail;

const fail = (message: string): Fail => ({ ok: false, message });

// A type guard, because this repo's tsconfig does not narrow unions on `.ok`.
export function isFail(x: { ok: boolean }): x is Fail {
  return x.ok === false;
}

function label(body: any, key: string, required: boolean, max = MAX_LABEL): Field<string | undefined> {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    return required ? fail(`${key} is required.`) : { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') return fail(`${key} must be text.`);
  const v = raw.trim();
  if (!v) return required ? fail(`${key} is required.`) : { ok: true, value: undefined };
  if (v.length > max) return fail(`${key} must be at most ${max} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return fail(`${key} must be a single line of plain text.`);
  return { ok: true, value: v };
}

function details(body: any, key: string): Field<string | null | undefined> {
  const raw = body[key];
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return fail(`${key} must be text.`);
  if (raw.includes('\u0000')) return fail(`${key} must not contain null characters.`);
  const v = raw.trim();
  if (v.length > MAX_DETAILS) return fail(`${key} must be at most ${MAX_DETAILS} characters.`);
  return { ok: true, value: v || null };
}

function flag(body: any, key: string): Field<boolean | undefined> {
  const raw = body[key];
  if (raw === undefined) return { ok: true, value: undefined };
  // Not Boolean(raw): Boolean("false") is true.
  if (typeof raw !== 'boolean') return fail(`${key} must be true or false.`);
  return { ok: true, value: raw };
}

function note(body: any): Field<string> {
  const err = validateNote(body.note);
  if (err) return fail(err);
  const v = String(body.note).trim();
  if (v.length > MAX_NOTE) return fail(`note must be at most ${MAX_NOTE} characters.`);
  if (v.includes('\u0000')) return fail('note must not contain null characters.');
  return { ok: true, value: v };
}

function status(body: any): Field<ReleaseStatus | undefined> {
  const raw = body.status;
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined };
  const v = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return (RECORD_STATUSES as readonly string[]).includes(v)
    ? { ok: true, value: v as ReleaseStatus }
    : fail(`status must be one of ${RECORD_STATUSES.join(', ')}.`);
}

function environment(body: any, required: boolean): Field<ReleaseRecord['environment'] | undefined> {
  const raw = body.environment;
  if (!required && (raw === undefined || raw === null)) return { ok: true, value: undefined };
  const env = canonicalEnvironment(raw);
  return env ? { ok: true, value: env as ReleaseRecord['environment'] } : fail(`environment must be one of ${RECORD_ENVIRONMENTS.join(', ')}.`);
}

// Validate a plain object into the shared record fields. `base` supplies batch
// defaults (the services[] form shares everything but server/service/version).
function buildOne(item: unknown, base: any, ctx: RecordContext): { ok: true; record: ReleaseRecord } | Fail {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return fail('Each record must be an object.');
  const body = { ...base, ...(item as object) };

  const checks = {
    environment: environment(body, true),
    server: label(body, 'server', true),
    service: label(body, 'service', true),
    version: label(body, 'version', true),
    developerName: label(body, 'developerName', false),
    source: label(body, 'source', false),
    status: status(body),
    note: note(body),
    envDetails: details(body, 'envDetails'),
    configDetails: details(body, 'configDetails'),
    commandDetails: details(body, 'commandDetails'),
    isBuildUpdate: flag(body, 'isBuildUpdate'),
    isEnvUpdate: flag(body, 'isEnvUpdate'),
    isConfigUpdate: flag(body, 'isConfigUpdate'),
    hasCommands: flag(body, 'hasCommands'),
  };
  for (const c of Object.values(checks)) if (isFail(c)) return c;
  const v = Object.fromEntries(Object.entries(checks).map(([k, c]) => [k, (c as { value: unknown }).value])) as any;

  const now = (ctx.now ?? new Date()).toISOString();
  return {
    ok: true,
    record: {
      id: `rel-${crypto.randomUUID()}`,
      environment: v.environment,
      server: v.server,
      service: v.service,
      version: v.version,
      developerName: v.developerName ?? ctx.defaultDeveloper,
      status: v.status ?? 'PENDING',
      isBuildUpdate: v.isBuildUpdate ?? true,
      isEnvUpdate: v.isEnvUpdate ?? false,
      envDetails: v.envDetails ?? null,
      isConfigUpdate: v.isConfigUpdate ?? false,
      configDetails: v.configDetails ?? null,
      hasCommands: v.hasCommands ?? false,
      commandDetails: v.commandDetails ?? null,
      note: v.note,
      source: v.source ?? 'Teams Group',
      added_by: ctx.addedBy,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export type NewRecords = { ok: true; records: ReleaseRecord[] } | Fail;

// POST /api/records body: one object, an array of objects, or an object with a
// services[] array whose entries override the shared top-level fields.
export function normalizeNewRecords(body: unknown, ctx: RecordContext): NewRecords {
  let items: unknown[];
  let base: any = {};
  if (Array.isArray(body)) {
    items = body;
  } else if (body && typeof body === 'object') {
    const services = (body as any).services;
    if (services !== undefined) {
      if (!Array.isArray(services)) return fail('services must be a list.');
      const { services: _drop, ...rest } = body as any;
      items = services;
      base = rest;
    } else {
      items = [body];
    }
  } else {
    return fail('Send a release record, a list of records, or { services: [...] }.');
  }

  if (items.length === 0) return fail('Send at least one record.');
  if (items.length > MAX_RECORDS_PER_REQUEST) return fail(`At most ${MAX_RECORDS_PER_REQUEST} records per request.`);

  const records: ReleaseRecord[] = [];
  for (let i = 0; i < items.length; i++) {
    const built = buildOne(items[i], base, ctx);
    if (isFail(built)) return fail(items.length > 1 ? `Record ${i + 1}: ${built.message}` : built.message);
    records.push(built.record);
  }
  return { ok: true, records };
}

export type RecordPatch = { ok: true; data: Record<string, unknown> } | Fail;

// PATCH /api/records/:id body: only the fields that are present are changed and
// each goes through the same check as on create. id, added_by and unknown keys
// are ignored (createdAt is handled by the route's date check).
export function normalizeRecordPatch(body: unknown): RecordPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Send the fields to change as an object.');
  const b = body as any;
  const data: Record<string, unknown> = {};
  const take = (key: string, f: Field<unknown>) => {
    if (isFail(f)) return f;
    if (f.value !== undefined) data[key] = f.value;
    return null;
  };

  const checks: Array<[string, Field<unknown>]> = [
    ['environment', environment(b, false)],
    ['server', label(b, 'server', false)],
    ['service', label(b, 'service', false)],
    ['version', label(b, 'version', false)],
    ['developerName', label(b, 'developerName', false)],
    ['source', label(b, 'source', false)],
    ['status', status(b)],
    ['envDetails', details(b, 'envDetails')],
    ['configDetails', details(b, 'configDetails')],
    ['commandDetails', details(b, 'commandDetails')],
    ['isBuildUpdate', flag(b, 'isBuildUpdate')],
    ['isEnvUpdate', flag(b, 'isEnvUpdate')],
    ['isConfigUpdate', flag(b, 'isConfigUpdate')],
    ['hasCommands', flag(b, 'hasCommands')],
  ];
  // A PATCH that does not touch the note keeps working; one that sends it must
  // not blank it out.
  if (b.note !== undefined) checks.push(['note', note(b)]);

  for (const [key, f] of checks) {
    const err = take(key, f);
    if (err) return err;
  }
  return { ok: true, data };
}
