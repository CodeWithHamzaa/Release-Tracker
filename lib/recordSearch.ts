// Search for the Audit Log's main text box. A record matches when every word
// of the query is found somewhere in it: service, server, environment,
// developer, status, version, release note, logged-by, source, or its date.
//
// Dates use the record's createdAt in LOCAL time (what the app displays) and
// can be typed as 2026-10-03, 2026-10, 2026, a month name (Oct / October), or
// a month + day phrase (Oct 3 / October 03).

import type { ReleaseRecord } from './types.js';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// "oct 3", "October 03", "sept. 9". The day is 1-2 digits on a word boundary.
const MONTH_DAY_PHRASE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\b/gi;

type SearchableRecord = Pick<
  ReleaseRecord,
  'service' | 'server' | 'environment' | 'developerName' | 'status' | 'version' | 'note' | 'added_by' | 'source' | 'createdAt'
>;

const pad = (n: number) => String(n).padStart(2, '0');

function localDateParts(input: unknown): { year: number; month: number; day: number } | null {
  if (typeof input !== 'string' && typeof input !== 'number' && !(input instanceof Date)) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

// Lowercase searchable terms for a record's date; empty for an invalid date.
// A bare day number is left out on purpose: "3" would match far too much.
export function recordDateTerms(createdAt: unknown): string[] {
  const p = localDateParts(createdAt);
  if (!p) return [];
  const long = MONTHS[p.month];
  return [`${p.year}-${pad(p.month + 1)}-${pad(p.day)}`, `${p.year}-${pad(p.month + 1)}`, String(p.year), long.slice(0, 3), long];
}

// Pull "oct 3" style phrases out of the query. Returns the phrases as
// month/day pairs plus the query with them removed.
function extractMonthDayPhrases(query: string): { phrases: Array<{ month: number; day: number }>; rest: string } {
  const phrases: Array<{ month: number; day: number }> = [];
  const rest = query.replace(MONTH_DAY_PHRASE, (_all, monthName: string, day: string) => {
    const month = MONTHS.findIndex((m) => m.startsWith(monthName.toLowerCase().slice(0, 3)));
    phrases.push({ month, day: Number(day) });
    return ' ';
  });
  return { phrases, rest };
}

export function matchesSearch(record: SearchableRecord, query: string): boolean {
  const { phrases, rest } = extractMonthDayPhrases(query.trim().toLowerCase());
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (phrases.length === 0 && tokens.length === 0) return true;

  if (phrases.length > 0) {
    const p = localDateParts(record.createdAt);
    if (!p) return false;
    if (!phrases.every((ph) => ph.month === p.month && ph.day === p.day)) return false;
  }

  if (tokens.length === 0) return true;
  const haystack = [
    record.service,
    record.server,
    record.environment,
    record.developerName,
    record.status,
    record.version,
    record.note,
    record.added_by,
    record.source,
    ...recordDateTerms(record.createdAt),
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase();

  return tokens.every((t) => haystack.includes(t));
}
