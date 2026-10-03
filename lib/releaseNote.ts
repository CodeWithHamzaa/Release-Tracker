// The release note is mandatory on every release record: it is what the Audit
// Log shows on each collapsed row, so a record without one is unreadable.
// Shared by the Add form, the Edit modal and the API so all three agree.

export const NOTE_LABEL = 'Release Notes / Status Update Notes';
export const NOTE_REQUIRED_MESSAGE = `${NOTE_LABEL} are required. Describe what was released or why the status changed.`;

// Returns an error message, or null when the note is acceptable.
export function validateNote(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return NOTE_REQUIRED_MESSAGE;
  return null;
}
