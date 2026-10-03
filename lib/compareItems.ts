// One reading of a release checklist (lib/toolkitCompare.ts, a port of
// alara_release_compare.sh v2.1). The promotion script generator and the risk
// engine both need to know what each CRITICAL line means; this is the single
// place that parses the script's wording, so they cannot disagree.

import type { CompareResult } from './toolkitCompare.js';

export type CompareItem =
  | { kind: 'image-update'; container: string; previous: string; image: string; raw: string }
  | { kind: 'image-deploy'; container: string; image: string; raw: string }
  | { kind: 'image-target-only'; container: string; image: string; raw: string }
  | { kind: 'env-add'; file: string; key: string; value: string; raw: string }
  | { kind: 'env-target-only'; file: string; key: string; raw: string }
  | { kind: 'env-differs'; file: string; key: string; raw: string }
  | { kind: 'env-secret-differs'; file: string; key: string; raw: string }
  | { kind: 'env-duplicate'; file: string; key: string; raw: string }
  | { kind: 'other'; raw: string };

const UPDATE = /^\[IMAGE\] UPDATE (\S+) on (\S+): (.+) {2}-> {2}(.+)$/;
const DEPLOY = /^\[IMAGE\] DEPLOY (\S+) \((.+)\) to (\S+) — running on /;
const TARGET_ONLY = /^\[IMAGE\] REVIEW (\S+) \((.+)\) — running on \S+ only\./;
const ADD = /^\[([^\]]+)\] ADD (\S+) to (\S+) \(value on (\S+): ([\s\S]*)\)$/;
const ENV_ONLY_TARGET = /^\[([^\]]+)\] REVIEW (\S+) — present only on /;
const ENV_VERIFY = /^\[([^\]]+)\] VERIFY (\S+) — sensitive value differs/;
const ENV_CLEANUP = /^\[([^\]]+)\] CLEANUP (\S+) — defined /;
const ENV_DIFFERS = /^\[([^\]]+)\] REVIEW (\S+) — /;

export function classifyCompareItem(item: string): CompareItem {
  let m: RegExpExecArray | null;
  const single = !item.includes('\n');
  if (single && (m = UPDATE.exec(item))) return { kind: 'image-update', container: m[1], previous: m[3], image: m[4], raw: item };
  if (single && (m = DEPLOY.exec(item))) return { kind: 'image-deploy', container: m[1], image: m[2], raw: item };
  if (single && (m = TARGET_ONLY.exec(item))) return { kind: 'image-target-only', container: m[1], image: m[2], raw: item };
  if ((m = ADD.exec(item))) return { kind: 'env-add', file: m[1], key: m[2], value: m[5], raw: item };
  if (single && (m = ENV_ONLY_TARGET.exec(item))) return { kind: 'env-target-only', file: m[1], key: m[2], raw: item };
  if (single && (m = ENV_VERIFY.exec(item))) return { kind: 'env-secret-differs', file: m[1], key: m[2], raw: item };
  if (single && (m = ENV_CLEANUP.exec(item))) return { kind: 'env-duplicate', file: m[1], key: m[2], raw: item };
  if (single && (m = ENV_DIFFERS.exec(item))) return { kind: 'env-differs', file: m[1], key: m[2], raw: item };
  return { kind: 'other', raw: item };
}

export function classifyCompareItems(compare: CompareResult): CompareItem[] {
  return compare.critical.map(classifyCompareItem);
}
