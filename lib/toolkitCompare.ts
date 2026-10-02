// A faithful port of alara_release_compare.sh v2.1: two .snapshot files of
// the same role -> a tiered release checklist (CRITICAL / EXPECTED / INFO),
// with the script's exact wording and ordering. Verified item-for-item
// against the real script's output (lib/fixtures/toolkit/compare_*.txt).
//
// Ordering follows the script's `sort`/`comm`, i.e. byte order (C locale).
// On a server with a UTF-8 locale the script may list items in a different
// order; the items themselves are the same.

import { parseSnapshot, ParsedSnapshot } from './toolkitParse.js';

// Same list as the script: routinely per-environment key names.
const EXPECTED_ENV_KEY_PATTERNS = ['_URL', '_ENDPOINT', '_DOMAIN', '_HOST', '_URI', '_PORT', '_REGION'];

export interface CompareResult {
  role: string; // role code, e.g. CHAT_BOT
  sourceEnv: string;
  targetEnv: string;
  critical: string[];
  expected: string[];
  notes: string[];
  warnings: string[]; // e.g. both snapshots report the same environment
}

const byteSort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortUnique = (xs: string[]) => [...new Set(xs)].sort(byteSort);

function isExpectedPatternKey(key: string): boolean {
  const k = key.toUpperCase();
  return EXPECTED_ENV_KEY_PATTERNS.some((p) => k.includes(p));
}

// image_repo(): drop @digest, then a trailing :tag (not a registry :port).
export function scriptImageRepo(image: string): string {
  const img = image.split('@')[0];
  const m = /^(.*)(:[^/:]+)$/.exec(img);
  return m ? m[1] : img;
}

// The value(s) after "<key>=" on matching lines, joined like $(grep ... | cut).
function valuesOf(lines: string[], key: string): string[] {
  return lines.filter((l) => l.startsWith(`${key}=`)).map((l) => l.slice(key.length + 1));
}

// Ignore-keys file: one key per line, blank and # lines skipped, kept verbatim.
export function parseIgnoreKeys(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l !== '' && !/^\s*#/.test(l));
}

export function compareSnapshots(source: ParsedSnapshot | string, target: ParsedSnapshot | string, ignoreKeys: string[] = []): CompareResult {
  const src = typeof source === 'string' ? parseSnapshot(source) : source;
  const tgt = typeof target === 'string' ? parseSnapshot(target) : target;
  if (src.roleCode !== tgt.roleCode) {
    throw new Error(`Role mismatch: ${src.roleCode} vs ${tgt.roleCode} — refusing to compare snapshots from different server roles.`);
  }
  const SRC_ENV = src.environment.toUpperCase();
  const TGT_ENV = tgt.environment.toUpperCase();
  const warnings: string[] = [];
  if (SRC_ENV === TGT_ENV) {
    warnings.push(`Both snapshots report the same environment (${SRC_ENV}). Double-check you picked the right files.`);
  }
  const ignored = new Set(ignoreKeys);
  const CRITICAL: string[] = [];
  const EXPECTED: string[] = [];
  const NOTES: string[] = [];

  // ── Images ──
  const clean = (s: ParsedSnapshot) => [...(s.sections.IMAGES ?? [])].sort(byteSort).map((l) => l.replace(/\|.*$/, ''));
  const srcImages = clean(src);
  const tgtImages = clean(tgt);
  const nameOf = (l: string) => l.split('=')[0];
  const imgOf = (lines: string[], name: string) =>
    lines.filter((l) => l.startsWith(`${name}=`)).map((l) => l.slice(l.indexOf('=') + 1)).join('\n');
  const srcNames = sortUnique(srcImages.map(nameOf));
  const tgtNames = sortUnique(tgtImages.map(nameOf));
  const tgtSet = new Set(tgtNames);
  const srcSet = new Set(srcNames);

  for (const name of srcNames.filter((n) => tgtSet.has(n))) {
    const srcImg = imgOf(srcImages, name);
    const tgtImg = imgOf(tgtImages, name);
    if (srcImg !== tgtImg) CRITICAL.push(`[IMAGE] UPDATE ${name} on ${TGT_ENV}: ${tgtImg}  ->  ${srcImg}`);
  }

  const srcOnly = srcNames.filter((n) => !tgtSet.has(n));
  const tgtOnly = tgtNames.filter((n) => !srcSet.has(n));
  const used = new Set<number>();
  for (const srcName of srcOnly) {
    const srcImg = imgOf(srcImages, srcName);
    const srcRepo = scriptImageRepo(srcImg);
    const idx = tgtOnly.findIndex((t, i) => !used.has(i) && scriptImageRepo(imgOf(tgtImages, t)) === srcRepo);
    if (idx >= 0) {
      used.add(idx);
      NOTES.push(
        `[IMAGE] '${srcName}' on ${SRC_ENV} and '${tgtOnly[idx]}' on ${TGT_ENV} share the same image repo (${srcRepo}) — likely just a naming difference, not a missing service. Verify before assuming, don't rename blindly.`
      );
    } else {
      CRITICAL.push(`[IMAGE] DEPLOY ${srcName} (${srcImg}) to ${TGT_ENV} — running on ${SRC_ENV}, nothing with this image found on ${TGT_ENV}`);
    }
  }
  tgtOnly.forEach((tgtName, i) => {
    if (used.has(i)) return;
    CRITICAL.push(
      `[IMAGE] REVIEW ${tgtName} (${imgOf(tgtImages, tgtName)}) — running on ${TGT_ENV} only. Confirm this is intentional (e.g. target-only service) and not stale/leftover before releasing.`
    );
  });

  // ── Env files ──
  const envSections = (s: ParsedSnapshot) => Object.keys(s.sections).filter((k) => k.startsWith('ENV:')).map((k) => k.slice(4));
  const allFiles = sortUnique([...envSections(src), ...envSections(tgt)]).filter(Boolean);

  for (const envfile of allFiles) {
    const srcLines = [...(src.sections[`ENV:${envfile}`] ?? [])].sort(byteSort);
    const tgtLines = [...(tgt.sections[`ENV:${envfile}`] ?? [])].sort(byteSort);
    const srcKeys = sortUnique(srcLines.map((l) => l.split('=')[0]));
    const tgtKeys = sortUnique(tgtLines.map((l) => l.split('=')[0]));
    const tgtKeySet = new Set(tgtKeys);
    const srcKeySet = new Set(srcKeys);

    for (const key of srcKeys.filter((k) => !tgtKeySet.has(k))) {
      if (ignored.has(key)) continue;
      const val = valuesOf(srcLines, key).join('\n');
      CRITICAL.push(`[${envfile}] ADD ${key} to ${TGT_ENV} (value on ${SRC_ENV}: ${val})`);
    }
    for (const key of tgtKeys.filter((k) => !srcKeySet.has(k))) {
      if (ignored.has(key)) continue;
      CRITICAL.push(`[${envfile}] REVIEW ${key} — present only on ${TGT_ENV}, confirm it should stay`);
    }
    for (const key of srcKeys.filter((k) => tgtKeySet.has(k))) {
      if (ignored.has(key)) continue;
      const srcVals = valuesOf(srcLines, key);
      const tgtVals = valuesOf(tgtLines, key);
      if (srcVals.length > 1 || tgtVals.length > 1) {
        CRITICAL.push(
          `[${envfile}] CLEANUP ${key} — defined ${srcVals.length}x in ${SRC_ENV}, ${tgtVals.length}x in ${TGT_ENV}. 'Last line wins' at runtime — remove the extra line(s) rather than leaving both.`
        );
      }
      const srcVal = srcVals[srcVals.length - 1] ?? '';
      const tgtVal = tgtVals[tgtVals.length - 1] ?? '';
      if (srcVal === tgtVal) continue;
      if (srcVal.startsWith('SHA256:') || tgtVal.startsWith('SHA256:')) {
        CRITICAL.push(
          `[${envfile}] VERIFY ${key} — sensitive value differs; confirm target's own secret is intentional (do not blindly copy from source)`
        );
      } else if (isExpectedPatternKey(key)) {
        EXPECTED.push(
          `[${envfile}] ${key} — ${SRC_ENV}='${srcVal}' vs ${TGT_ENV}='${tgtVal}'. Key name matches a routinely-per-env pattern — verify it's the correct ${TGT_ENV} value, not drift.`
        );
      } else {
        CRITICAL.push(
          `[${envfile}] REVIEW ${key} — ${SRC_ENV}='${srcVal}' vs ${TGT_ENV}='${tgtVal}'. Confirm whether ${TGT_ENV} should match ${SRC_ENV} or this is an intentional per-env value before changing anything.`
        );
      }
    }
  }

  return { role: src.roleCode, sourceEnv: SRC_ENV, targetEnv: TGT_ENV, critical: CRITICAL, expected: EXPECTED, notes: NOTES, warnings };
}

// Plain-text checklist in the script's summary layout, for copy/paste.
export function checklistText(r: CompareResult): string {
  const out = [
    `Release Checklist — ${r.role}: ${r.sourceEnv} -> ${r.targetEnv}`,
    `${r.critical.length} critical action item(s), ${r.expected.length} expected per-env difference(s) to verify, ${r.notes.length} informational note(s)`,
  ];
  const block = (title: string, items: string[]) => {
    if (!items.length) return;
    out.push('', title, ...items.map((t, i) => `  ${i + 1}. ${t}`));
  };
  block('CRITICAL - action required before release', r.critical);
  block('EXPECTED - routinely per-environment, verify only', r.expected);
  block('INFO - non-blocking', r.notes);
  return out.join('\n');
}
