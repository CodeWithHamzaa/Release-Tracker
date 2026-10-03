// Deployment receipts: the small JSON file a generated script writes after
// `alara_server.sh patch apply` (see receiptHelpers in lib/runbook.ts). It
// carries the toolkit's own patch record (alara/patches/applied/<STAMP>_<ID>/:
// RESULT, plan.txt, images.txt, tars.sha256, state.after, compose.diff) word
// for word, plus who/where/when. This parser turns that into what the tracker
// needs: a verdict for the matching release records, the images that changed,
// and the containers as they were after the run.
//
// Nothing here trusts the file: it is size-limited, every field is validated,
// and the status is DERIVED from the toolkit's RESULT line, never read from a
// field the script could have set to anything.

import { containerState, trackerEnv, trackerRole, ToolkitContainer } from './toolkitParse.js';
import { PATCH_ID_PATTERN } from './runbook.js';

export const RECEIPT_FORMAT_PREFIX = 'alara-receipt/';
export const RECEIPT_MAX_BYTES = 1_000_000;
const FILE_MAX_BYTES = 200_000;
const bytes = (t: string) => new TextEncoder().encode(t).length; // browser and server

export type ReceiptOutcome = 'recorded' | 'nothing-applicable' | 'refused' | 'env-restarted' | 'failed';
export type ReceiptVerdict = 'success' | 'failed' | 'pending';

export interface ReceiptImage {
  service: string;
  oldRef: string;
  newRef: string;
  oldId: string | null;
  newId: string | null;
}

export interface ParsedReceipt {
  kind: 'receipt';
  format: string;
  script: 'runbook' | 'promotion-target';
  patchId: string;
  environment: string; // tracker name: SIT | UAT | Prod
  role: string; // tracker name
  roleCode: string;
  host: string | null;
  user: string | null;
  scriptSha256: string | null;
  startedAt: string | null;
  finishedAt: string;
  exitCode: number;
  outcome: ReceiptOutcome;
  recordId: string | null; // alara/patches/applied/<recordId>
  result: string | null; // last RESULT= line of the toolkit's record
  images: ReceiptImage[];
  tars: { sha256: string; file: string }[];
  containers: ToolkitContainer[]; // state.after
  envAdded: string[]; // "file:KEY" appended by a promotion script
  composeDiff: string | null;
  verdict: ReceiptVerdict;
  reason: string; // one plain sentence for the review screen and the record note
}

const ROLE_CODES = ['BOT_BUILDER', 'CHAT_BOT', 'DATABASE', 'CHAT_SERVICE'];
const OUTCOMES: ReceiptOutcome[] = ['recorded', 'nothing-applicable', 'refused', 'env-restarted', 'failed'];
const FILES = ['RESULT', 'plan.txt', 'images.txt', 'tars.sha256', 'state.after', 'compose.diff'] as const;

export function looksLikeReceipt(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') && new RegExp(`"format"\\s*:\\s*"${RECEIPT_FORMAT_PREFIX}`).test(t.slice(0, 400));
}

function fail(message: string): never {
  throw new Error(`Not a valid deployment receipt: ${message}`);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

// "KEY=value" lines; later lines win (the toolkit appends RESULT on rollback).
function lastValue(text: string | null, key: string): string | null {
  if (!text) return null;
  let out: string | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith(`${key}=`)) out = line.slice(key.length + 1).trim();
  }
  return out;
}

function rows(text: string | null): string[][] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('|'));
}

export function receiptVerdict(r: {
  outcome: ReceiptOutcome;
  result: string | null;
  exitCode: number;
}): { verdict: ReceiptVerdict; reason: string } {
  switch (r.outcome) {
    case 'nothing-applicable':
      return { verdict: 'pending', reason: 'Nothing in the patch applies to this server, so no change was made.' };
    case 'refused':
      return { verdict: 'pending', reason: 'The patch was refused or not confirmed before any change (exit 2).' };
    case 'env-restarted':
      return { verdict: 'pending', reason: 'Env keys were added and the services restarted. There was no health gate, so check status before closing the record.' };
    case 'failed':
      return { verdict: 'failed', reason: `The run failed (exit ${r.exitCode}) and the toolkit left no patch record.` };
    case 'recorded':
      break;
  }
  const res = r.result;
  if (res === 'SUCCESS') {
    return r.exitCode === 0
      ? { verdict: 'success', reason: 'Applied: images loaded, services restarted and the health gate passed.' }
      : { verdict: 'pending', reason: `The toolkit record says SUCCESS but the script exited ${r.exitCode}; check the server before closing the record.` };
  }
  if (res === 'ROLLED_BACK') return { verdict: 'failed', reason: 'The health gate failed and the toolkit rolled back automatically; the server is on the old images.' };
  if (res === 'ROLLED_BACK_MANUAL') return { verdict: 'failed', reason: 'The patch was applied and later rolled back by hand; the server is on the old images.' };
  if (res === 'ROLLBACK_FAILED') return { verdict: 'failed', reason: 'The health gate failed and the rollback also failed: manual action is needed.' };
  if (res === 'FAILED_NO_ROLLBACK') return { verdict: 'failed', reason: 'The health gate failed and automatic rollback was disabled.' };
  if (res === 'FAILED_LOAD') return { verdict: 'failed', reason: 'Loading an image failed; the compose file was not changed.' };
  if (res === 'INTERRUPTED') return { verdict: 'failed', reason: 'The run was interrupted; the server state may be partial.' };
  return { verdict: 'failed', reason: res ? `The toolkit record ended as ${res}.` : 'The toolkit left no result for this run.' };
}

export function parseReceipt(text: string): ParsedReceipt {
  if (bytes(text) > RECEIPT_MAX_BYTES) fail('the file is larger than 1 MB');
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('it is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('it is not a JSON object');
  if (typeof raw.format !== 'string' || !raw.format.startsWith(RECEIPT_FORMAT_PREFIX)) fail('the format field is missing');
  if (raw.format !== `${RECEIPT_FORMAT_PREFIX}1`) fail(`unsupported format ${raw.format} (this tracker reads ${RECEIPT_FORMAT_PREFIX}1)`);

  const script = raw.script === 'runbook' || raw.script === 'promotion-target' ? raw.script : fail('unknown script kind');
  const patchId = str(raw.patchId);
  if (!patchId || !PATCH_ID_PATTERN.test(patchId)) fail('the PATCH_ID is missing or invalid');
  const envName = str(raw.environment)?.toUpperCase();
  if (!envName || !['SIT', 'UAT', 'PROD'].includes(envName)) fail('the environment must be SIT, UAT or PROD');
  const roleCode = str(raw.role);
  if (!roleCode || !ROLE_CODES.includes(roleCode)) fail('the role is not a known ALARA role');
  const exitCode = raw.exitCode;
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) fail('the exit code is not a number between 0 and 255');
  const outcome = OUTCOMES.find((o) => o === raw.outcome) ?? fail('unknown outcome');
  const finishedAt = str(raw.finishedAt);
  if (!finishedAt || Number.isNaN(new Date(finishedAt).getTime())) fail('the finish time is missing or invalid');
  const startedAt = str(raw.startedAt) && !Number.isNaN(new Date(raw.startedAt).getTime()) ? (raw.startedAt as string) : null;
  const recordId = str(raw.recordId);
  if (recordId && !/^[\w.-]{1,120}$/.test(recordId)) fail('the record id has unexpected characters');

  const files: Record<string, string | null> = {};
  for (const f of FILES) {
    const v = raw.files?.[f];
    if (v !== null && v !== undefined && typeof v !== 'string') fail(`files.${f} must be text`);
    if (typeof v === 'string' && bytes(v) > FILE_MAX_BYTES) fail(`files.${f} is too large`);
    files[f] = typeof v === 'string' ? v : null;
  }
  if (outcome === 'recorded' && !files.RESULT) fail('it says a patch record exists but RESULT is missing');

  const envAdded: string[] = Array.isArray(raw.envAdded) ? raw.envAdded.filter((x: unknown): x is string => typeof x === 'string' && /^[\w.-]+:[\w.-]+$/.test(x)).slice(0, 500) : [];

  const images: ReceiptImage[] = rows(files['images.txt'])
    .filter((c) => c[0] !== 'service' && c.length >= 3)
    .map((c) => ({ service: c[0], oldRef: c[1], newRef: c[2], oldId: c[3] && c[3] !== 'MISSING' ? c[3] : null, newId: c[4] || null }));

  const tars = (files['tars.sha256'] ?? '')
    .split('\n')
    .map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ sha256: m[1], file: m[2] }));

  // state.after: service|container|image|status|health|restarts
  const containers: ToolkitContainer[] = rows(files['state.after'])
    .filter((c) => c.length >= 5)
    .map((c) => {
      const health = c[4] === 'healthy' || c[4] === 'unhealthy' || c[4] === 'starting' ? c[4] : null;
      const status = c[3] === 'running' ? `Up${health ? ` (${health})` : ''}` : c[3] === 'exited' ? 'Exited' : c[3] === 'restarting' ? 'Restarting' : c[3];
      return { name: c[1], service: c[0] || null, image: c[2], status, ports: null, state: containerState(status).state, health: health as ToolkitContainer['health'] };
    });

  const result = lastValue(files.RESULT, 'RESULT');
  const { verdict, reason } = receiptVerdict({ outcome, result, exitCode });

  return {
    kind: 'receipt',
    format: raw.format,
    script,
    patchId,
    environment: trackerEnv(envName),
    role: trackerRole(roleCode),
    roleCode,
    host: str(raw.host),
    user: str(raw.user),
    scriptSha256: /^[0-9a-f]{64}$/.test(raw.scriptSha256 ?? '') ? raw.scriptSha256 : null,
    startedAt,
    finishedAt: new Date(finishedAt).toISOString(),
    exitCode,
    outcome,
    recordId,
    result,
    images,
    tars,
    containers,
    envAdded,
    composeDiff: files['compose.diff'],
    verdict,
    reason,
  };
}
