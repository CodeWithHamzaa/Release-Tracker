import developersConfig from '@/config/developers.json';

// Used only if config/developers.json is missing, empty, or malformed, so the
// Add/Edit forms always have at least one selectable, submittable option.
const FALLBACK_DEVELOPERS: readonly string[] = ['Unassigned'];

/**
 * Validate the roster JSON into a clean array of non-empty, trimmed, unique
 * strings. The file is meant to be editable by non-developers (see the doc
 * comment on DEVELOPERS below), so it gets no compile-time guarantee: a typo
 * like a trailing comma, a stray number, or an emptied-out file is a runtime
 * risk, not a build failure.
 */
function parseDeveloperRoster(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

const parsedRoster = parseDeveloperRoster(developersConfig);

/**
 * Canonical developer roster. Edit config/developers.json to change it — no
 * code change needed. Order here is the order shown in every dropdown.
 * Falls back to FALLBACK_DEVELOPERS if the file is empty or malformed, so a
 * bad edit degrades to one selectable option instead of breaking every form
 * that renders this list as a <select>.
 */
export const DEVELOPERS: readonly string[] =
  parsedRoster.length > 0 ? parsedRoster : FALLBACK_DEVELOPERS;

export const DEFAULT_DEVELOPER = DEVELOPERS[0];

/**
 * Roster plus `current`, when `current` is a name the roster doesn't carry.
 *
 * Records created before the roster existed (or via the API) can hold any
 * name. Rendering a <select> whose value isn't among its options silently
 * blanks the field, so an edit would rewrite the developer without the user
 * touching it. Keeping the stray value as an extra option preserves it.
 */
export function developerOptions(current?: string | null): string[] {
  const value = (current || '').trim();
  if (!value || DEVELOPERS.includes(value)) return [...DEVELOPERS];
  return [value, ...DEVELOPERS];
}
