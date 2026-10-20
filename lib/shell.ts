// Quoting for the bash commands the tracker writes (it never runs them).

// Always single-quoted: everything inside is literal.
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Left bare when it is plainly safe (paths, image refs, service names), so the
// commands read naturally; single-quoted otherwise.
export function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : shellQuote(value);
}
