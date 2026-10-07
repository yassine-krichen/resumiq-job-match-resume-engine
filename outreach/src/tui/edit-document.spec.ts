import { formatEditDocument, isUnchanged, parseEditDocument } from './edit-document';

const email = {
  subject: 'Your fleet scheduler',
  body: 'First paragraph.\n\nSecond paragraph.',
  followUpBody: 'One more thought.',
};

describe('edit document', () => {
  it('round-trips an email through the file format', () => {
    const parsed = parseEditDocument(formatEditDocument(email));

    expect(parsed).toEqual({ ok: true, email });
  });

  it('keeps paragraph breaks and ignores the instruction lines above the first marker', () => {
    const parsed = parseEditDocument(formatEditDocument(email));

    expect(parsed.ok && parsed.email.body).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('accepts Windows line endings from the editor', () => {
    const parsed = parseEditDocument(formatEditDocument(email).replace(/\n/g, '\r\n'));

    expect(parsed).toEqual({ ok: true, email });
  });

  it('reports every missing marker', () => {
    const parsed = parseEditDocument('=== SUBJECT ===\nHello\n');

    expect(parsed).toEqual({
      ok: false,
      errors: ['the marker "=== BODY ===" is missing', 'the marker "=== FOLLOW-UP ===" is missing'],
    });
  });

  it('rejects a duplicated marker', () => {
    const text = `${formatEditDocument(email)}\n=== BODY ===\nagain\n`;

    const parsed = parseEditDocument(text);

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.errors[0]).toMatch(/more than once/);
  });

  it('rejects empty sections and a multi-line subject', () => {
    const empty = parseEditDocument(formatEditDocument({ ...email, body: '   ' }));
    expect(!empty.ok && empty.errors).toContain('the body is empty');

    const multiline = parseEditDocument(formatEditDocument({ ...email, subject: 'Line one\nLine two' }));
    expect(!multiline.ok && multiline.errors).toContain('the subject must be a single line');
  });

  it('detects an unchanged email', () => {
    expect(isUnchanged(email, { ...email })).toBe(true);
    expect(isUnchanged(email, { ...email, subject: 'Other' })).toBe(false);
  });
});
