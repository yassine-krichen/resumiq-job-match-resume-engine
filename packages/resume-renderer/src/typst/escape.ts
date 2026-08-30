/**
 * Escapes Typst markup special characters. Different set from LaTeX's:
 * `# * _ \` [ ] < @ $` all have syntactic meaning in Typst markup mode.
 * Backslash must be escaped first so subsequently-inserted backslashes
 * aren't re-escaped.
 */
export function typ(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/#/g, '\\#')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '\\<')
    .replace(/@/g, '\\@')
    .replace(/\$/g, '\\$');
}

/**
 * Escapes a value for interpolation inside a Typst double-quoted string
 * literal, e.g. `#link("${typStr(url)}")`. Only backslash and `"` are
 * syntactically meaningful inside a Typst string literal — unlike `typ()`,
 * this must NOT escape markup characters (`#`, `*`, etc.), since those are
 * meaningless (and would corrupt the value, e.g. a URL fragment `#section`)
 * inside a string. Without this, an untrusted URL/email containing a `"` or
 * `}` could break out of the string literal and inject arbitrary Typst markup.
 */
export function typStr(str: string | undefined | null): string {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
