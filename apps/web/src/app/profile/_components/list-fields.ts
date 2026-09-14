/** Parses a comma-separated input value into a trimmed, non-empty string list.
 * Used for short tag-like array fields (e.g. `technologies_used`). */
export function parseCommaList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Joins a string list back into its comma-separated input representation. */
export function joinCommaList(values: string[]): string {
  return values.join(', ');
}

/** Parses a newline-separated textarea value into a trimmed, non-empty string
 * list. Used for longer freeform entries (e.g. `raw_achievements`,
 * `quantifiable_metrics`) where splitting on commas would incorrectly break
 * on commas that appear inside the text itself. */
export function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Joins a string list back into its newline-separated textarea representation. */
export function joinLines(values: string[]): string {
  return values.join('\n');
}
