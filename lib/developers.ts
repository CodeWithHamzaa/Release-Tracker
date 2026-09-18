import developersConfig from '@/config/developers.json';

/**
 * Canonical developer roster. Edit config/developers.json to change it — no
 * code change needed. Order here is the order shown in every dropdown.
 */
export const DEVELOPERS: readonly string[] = developersConfig as string[];

export const DEFAULT_DEVELOPER = DEVELOPERS[0] || '';

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
