// Validation for a release record's deployment date (createdAt) when it is
// edited. Backdating is the point; the guard is against typos: an
// unparseable value, a year before 2000, or more than a day in the future.

const EARLIEST = Date.UTC(2000, 0, 1);
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

export function parseRecordDate(value: unknown, now: Date = new Date()): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const d = new Date(value);
  const t = d.getTime();
  if (Number.isNaN(t) || t < EARLIEST || t > now.getTime() + FUTURE_SLACK_MS) return null;
  return d;
}
