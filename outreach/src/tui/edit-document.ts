// The temp file the reviewer edits: three marked sections in plain text. Pure, so the format is tested
// without an editor.

export interface EditableEmail {
  subject: string;
  body: string;
  followUpBody: string;
}

const MARKERS = { subject: '=== SUBJECT ===', body: '=== BODY ===', followUp: '=== FOLLOW-UP ===' } as const;

const INSTRUCTIONS = [
  '# Edit the subject, body and follow-up below, then save and close the editor.',
  '# Keep the three "=== ... ===" marker lines. Lines starting with # above the first marker are ignored.',
  '# The email checks re-run on save. If one fails nothing is stored and you see why.',
  '# Leave the file unchanged to cancel.',
];

export function formatEditDocument(email: EditableEmail): string {
  return [
    ...INSTRUCTIONS,
    '',
    MARKERS.subject,
    email.subject,
    '',
    MARKERS.body,
    email.body,
    '',
    MARKERS.followUp,
    email.followUpBody,
    '',
  ].join('\n');
}

export type ParsedEdit = { ok: true; email: EditableEmail } | { ok: false; errors: string[] };

export function parseEditDocument(text: string): ParsedEdit {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const sections = new Map<string, string[]>();
  const errors: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const marker = Object.values(MARKERS).find((candidate) => line.trim() === candidate);
    if (marker) {
      if (sections.has(marker)) errors.push(`the marker "${marker}" appears more than once`);
      current = [];
      sections.set(marker, current);
    } else if (current !== null) {
      current.push(line);
    }
  }

  for (const marker of Object.values(MARKERS)) {
    if (!sections.has(marker)) errors.push(`the marker "${marker}" is missing`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const section = (marker: string): string => (sections.get(marker) ?? []).join('\n').trim();
  const subject = section(MARKERS.subject);
  const body = section(MARKERS.body);
  const followUpBody = section(MARKERS.followUp);

  if (subject === '') errors.push('the subject is empty');
  if (/\n/.test(subject)) errors.push('the subject must be a single line');
  if (body === '') errors.push('the body is empty');
  if (followUpBody === '') errors.push('the follow-up is empty');
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, email: { subject, body, followUpBody } };
}

export function isUnchanged(before: EditableEmail, after: EditableEmail): boolean {
  return before.subject === after.subject && before.body === after.body && before.followUpBody === after.followUpBody;
}
