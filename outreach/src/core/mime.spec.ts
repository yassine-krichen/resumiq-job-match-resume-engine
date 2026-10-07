import { randomBytes } from 'node:crypto';

import { buildMimeMessage, encodeQuotedPrintable, replySubject, signatureFromHtml } from './mime';
import type { BuildMimeInput } from './mime';

const signature = signatureFromHtml(
  '<div><strong>Jane Doe</strong><br>Software engineering student, Example University<br>' +
    '<a href="https://github.com/jane-doe-example">github.com/jane-doe-example</a></div>',
);

const pdf = randomBytes(40_000);

function baseInput(overrides: Partial<BuildMimeInput> = {}): BuildMimeInput {
  let boundaryCount = 0;
  return {
    from: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    to: { email: 'claire@acme-robotics.fr' },
    subject: 'Votre planificateur de flotte',
    textBody: "Bonjour Claire,\n\nJ'ai vu votre annonce.\n\nCordialement",
    signature,
    attachment: { filename: 'Jane-Doe-Resume.pdf', contentType: 'application/pdf', content: pdf },
    date: new Date('2026-10-06T08:30:00Z'),
    generateBoundary: () => `BOUNDARY${(boundaryCount += 1)}`,
    ...overrides,
  };
}

function decodeQuotedPrintable(text: string): string {
  const joined = text.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    if (joined[i] === '=' && /^[0-9A-F]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The raw text between a part's blank line and the next boundary. */
function partBody(raw: string, contentType: string): string {
  const start = raw.indexOf(`Content-Type: ${contentType}`);
  const bodyStart = raw.indexOf('\r\n\r\n', start) + 4;
  const bodyEnd = raw.indexOf('\r\n--', bodyStart);
  return raw.slice(bodyStart, bodyEnd);
}

describe('buildMimeMessage', () => {
  it('uses CRLF everywhere with no bare LF or CR', () => {
    const { raw } = buildMimeMessage(baseInput());

    expect(raw).not.toMatch(/(?<!\r)\n/);
    expect(raw).not.toMatch(/\r(?!\n)/);
    expect(raw.endsWith('\r\n')).toBe(true);
  });

  it('round-trips the PDF attachment through base64 with lines of at most 76 characters', () => {
    const { raw } = buildMimeMessage(baseInput());

    const header = raw.indexOf('Content-Disposition: attachment');
    const bodyStart = raw.indexOf('\r\n\r\n', header) + 4;
    const encoded = raw.slice(bodyStart, raw.indexOf('\r\n--BOUNDARY1--', bodyStart));
    const lines = encoded.split('\r\n');

    expect(lines.every((line) => line.length <= 76)).toBe(true);
    expect(Buffer.from(lines.join(''), 'base64').equals(pdf)).toBe(true);
    expect(raw).toContain('filename="Jane-Doe-Resume.pdf"');
    expect(raw).toContain('Content-Type: application/pdf; name="Jane-Doe-Resume.pdf"');
  });

  it('encodes a non-ASCII subject as RFC 2047 words that decode back to the original', () => {
    const subject = 'Développeur à temps partiel chez Acmé : planificateur de flotte open source et migration';
    const { raw } = buildMimeMessage(baseInput({ subject }));

    const header = raw.match(/^Subject: ([\s\S]*?)\r\n(?=[A-Z][A-Za-z-]*:)/m);
    expect(header).not.toBeNull();
    const words = [...header![1].matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)];
    expect(words.length).toBeGreaterThan(1);
    expect(words.every((word) => word[0].length <= 75)).toBe(true);
    expect(words.map((word) => Buffer.from(word[1], 'base64').toString('utf8')).join('')).toBe(subject);
  });

  it('keeps a plain ASCII subject readable', () => {
    const { raw } = buildMimeMessage(baseInput({ subject: 'Your open-sourced fleet scheduler' }));

    expect(raw).toContain('\r\nSubject: Your open-sourced fleet scheduler\r\n');
  });

  it('puts the signature in both the text and the HTML part of the first email', () => {
    const { raw } = buildMimeMessage(baseInput());

    const text = decodeQuotedPrintable(partBody(raw, 'text/plain'));
    const html = decodeQuotedPrintable(partBody(raw, 'text/html'));

    expect(text).toContain("J'ai vu votre annonce.");
    expect(text).toContain('Jane Doe');
    expect(text).toContain('Software engineering student, Example University');
    expect(html).toContain(signature.html);
    expect(html).toContain('<p>Bonjour Claire,</p>');
  });

  it('puts the signature in both parts of a follow-up too, with threading headers and no attachment', () => {
    const { raw, messageId } = buildMimeMessage(
      baseInput({
        attachment: undefined,
        subject: replySubject('Votre planificateur de flotte'),
        textBody: 'Bonjour Claire, un dernier point.',
        inReplyTo: '<first-id@example.com>',
        references: ['<first-id@example.com>'],
      }),
    );

    expect(decodeQuotedPrintable(partBody(raw, 'text/plain'))).toContain('Software engineering student, Example University');
    expect(decodeQuotedPrintable(partBody(raw, 'text/html'))).toContain(signature.html);
    expect(raw).toContain('\r\nIn-Reply-To: <first-id@example.com>\r\n');
    expect(raw).toContain('\r\nReferences: <first-id@example.com>\r\n');
    expect(raw).toContain('\r\nSubject: Re: Votre planificateur de flotte\r\n');
    expect(raw).not.toMatch(/application\/pdf|Content-Disposition/);
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="BOUNDARY1"');
    expect(messageId).toMatch(/^<[0-9a-f]{32}@example.com>$/);
  });

  it('references the replied-to message when only In-Reply-To is given', () => {
    const { raw } = buildMimeMessage(
      baseInput({ attachment: undefined, inReplyTo: '<first-id@example.com>' }),
    );

    expect(raw).toContain('\r\nReferences: <first-id@example.com>\r\n');
  });

  it('keeps every header line within 78 characters, including multipart and attachment parameters', () => {
    const { raw } = buildMimeMessage(
      baseInput({
        generateBoundary: undefined,
        subject: 'Développeur à temps partiel chez Acmé : planificateur de flotte open source',
        attachment: {
          filename: 'Jane-Doe-Resume-for-a-very-long-company-name-here.pdf',
          contentType: 'application/pdf',
          content: pdf,
        },
      }),
    );

    const tooLong = raw.split('\r\n').filter((line) => line.length > 78);

    expect(tooLong).toEqual([]);
    expect(raw).toMatch(/Content-Type: multipart\/alternative;\r\n boundary="/);
  });

  it('builds multipart/mixed around multipart/alternative when there is an attachment', () => {
    const { raw } = buildMimeMessage(baseInput());

    expect(raw).toContain('Content-Type: multipart/mixed; boundary="BOUNDARY2"');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="BOUNDARY1"');
    expect(raw.indexOf('text/plain')).toBeLessThan(raw.indexOf('text/html'));
    expect(raw.indexOf('text/html')).toBeLessThan(raw.indexOf('application/pdf'));
  });

  it('round-trips accented text and keeps quoted-printable lines within 76 characters', () => {
    const long = `${"Ça fait déjà plusieurs mois que j'étudie votre planificateur de flotte, ".repeat(6)}fin.`;
    const encoded = encodeQuotedPrintable(`${long}\nLigne = deux  `);

    expect(encoded.split('\r\n').every((line) => line.length <= 76)).toBe(true);
    expect(decodeQuotedPrintable(encoded)).toBe(`${long}\r\nLigne = deux  `);
    expect(encoded.endsWith('=20')).toBe(true);
  });

  it('adds no bulk-mail headers: no List-Unsubscribe, Precedence or auto-submitted markers', () => {
    const { raw } = buildMimeMessage(baseInput());

    expect(raw).not.toMatch(/list-unsubscribe|precedence:|auto-submitted|x-mailer/i);
  });

  it('writes a valid RFC 5322 date, Message-ID and MIME-Version', () => {
    const { raw, messageId } = buildMimeMessage(baseInput());

    expect(raw).toContain('\r\nDate: Tue, 06 Oct 2026 08:30:00 +0000\r\n');
    expect(raw).toContain(`\r\nMessage-ID: ${messageId}\r\n`);
    expect(raw).toContain('\r\nMIME-Version: 1.0\r\n');
  });

  it('encodes a non-ASCII sender name and quotes an ASCII one', () => {
    const ascii = buildMimeMessage(baseInput({ from: { name: 'Jane "J" Doe', email: 'j@example.com' } })).raw;
    const accented = buildMimeMessage(baseInput({ from: { name: 'Jane Doé', email: 'j@example.com' } })).raw;

    expect(ascii).toContain('From: "Jane \\"J\\" Doe" <j@example.com>');
    expect(accented).toMatch(/From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <j@example.com>/);
  });

  it('refuses header injection through the subject, the addresses, the message ids and the filename', () => {
    expect(() => buildMimeMessage(baseInput({ subject: 'Hi\r\nBcc: victim@example.com' }))).toThrow(/line breaks/);
    expect(() => buildMimeMessage(baseInput({ to: { email: 'a@acme.com\r\nBcc: x@y.com' } }))).toThrow();
    expect(() => buildMimeMessage(baseInput({ from: { name: 'Eve\nBcc: x@y.com', email: 'e@acme.com' } }))).toThrow(
      /line breaks/,
    );
    expect(() => buildMimeMessage(baseInput({ inReplyTo: '<a@b.com>\r\nBcc: x@y.com' }))).toThrow();
    expect(() =>
      buildMimeMessage(baseInput({ attachment: { filename: 'a.pdf\r\nX: y', contentType: 'application/pdf', content: pdf } })),
    ).toThrow(/line breaks/);
  });

  it('rejects an invalid recipient address', () => {
    expect(() => buildMimeMessage(baseInput({ to: { email: 'not-an-email' } }))).toThrow(/valid email/);
  });

  it('escapes HTML in the body so a company name cannot inject markup', () => {
    const { raw } = buildMimeMessage(baseInput({ textBody: 'Bonjour <script>alert(1)</script> & co' }));

    const html = decodeQuotedPrintable(partBody(raw, 'text/html'));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).not.toContain('<script>');
  });
});

describe('signature requirement', () => {
  it.each([
    ['an empty html signature', { html: '', text: 'Jane' }],
    ['a whitespace-only html signature', { html: '  \n ', text: 'Jane' }],
    ['an empty text signature', { html: '<b>Jane</b>', text: '' }],
    ['a whitespace-only text signature', { html: '<b>Jane</b>', text: ' \r\n' }],
  ])('refuses to build a message with %s', (_label, bad) => {
    expect(() => buildMimeMessage(baseInput({ signature: bad }))).toThrow(/signature/i);
  });

  it('refuses to build a follow-up with no signature at all', () => {
    const input = baseInput({ attachment: undefined });

    expect(() => buildMimeMessage({ ...input, signature: undefined } as unknown as BuildMimeInput)).toThrow(/signature/i);
  });

  it('derives the plain-text signature from HTML', () => {
    expect(signatureFromHtml('<div>Jane<br>Example University</div>').text).toBe('Jane\nExample University');
  });
});

describe('replySubject', () => {
  it('prefixes "Re: " once', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('Re: Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
  });
});
