import { randomBytes } from 'node:crypto';

import { DateTime } from 'luxon';

import { isValidEmailSyntax } from './email-check';
import { htmlToText } from './snapshot-text';

// Builds the raw RFC 5322 message the sender adapters hand to Gmail, Graph or
// SMTP. Deliberately no List-Unsubscribe or other bulk headers (SPEC section 5):
// they make a personal email look like marketing.

export interface MimeAddress {
  name?: string;
  email: string;
}

export interface MimeSignature {
  html: string;
  text: string;
}

export interface MimeAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface BuildMimeInput {
  from: MimeAddress;
  to: MimeAddress;
  subject: string;
  textBody: string;
  /**
   * The mailbox signature. API sends do not add it, so it is mandatory here:
   * appended to both the HTML and the text part of every message (initial and
   * follow-up). Building throws when it is missing or blank.
   */
  signature: MimeSignature;
  attachment?: MimeAttachment;
  /** Message-ID of the email being followed up; sets In-Reply-To. */
  inReplyTo?: string;
  /** Message-IDs of the earlier messages in the thread, oldest first. Defaults to `[inReplyTo]` when only that is given. */
  references?: readonly string[];
  date?: Date;
  /** Overrides the generated Message-ID (angle brackets included). */
  messageId?: string;
  /** Returns a unique boundary token; injectable for tests. */
  generateBoundary?: () => string;
}

export interface BuiltMimeMessage {
  /** CRLF-only message, ready to base64url for the Gmail API or pipe to SMTP. */
  raw: string;
  /**
   * The Message-ID this builder put in the message. Gmail may rewrite it on
   * send, so the sender must read the Message-ID back from the sent message
   * (e.g. `users.messages.get`, header "Message-ID") and store that one: the
   * follow-up's In-Reply-To and References must match what recipients received.
   */
  messageId: string;
}

const CRLF = '\r\n';

// A bare CR or LF in any header value would let an attacker-influenced string
// (a subject, a company name) inject headers.
function assertSingleLine(value: string, field: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`${field} must not contain line breaks`);
  return value;
}

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7E]*$/.test(value);
}

/** RFC 2047 B-encoded words, each at most 75 characters, split on character boundaries. */
function encodeWords(value: string): string {
  // 48 base64 chars + 12 for "=?UTF-8?B?" and "?=" keeps the first header line under 78 with its field name.
  const maxBytes = 36;
  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, 'utf8') > maxBytes) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

// Encoded words are already split into header-safe pieces; only plain ASCII
// needs folding.
function subjectHeader(subject: string): string {
  return isPrintableAscii(subject) ? foldHeader('Subject', subject) : `Subject: ${encodeWords(subject)}`;
}

function foldHeader(name: string, value: string): string {
  const tokens = value.split(' ');
  const lines: string[] = [];
  let line = `${name}:`;
  for (const token of tokens) {
    if (line.length + 1 + token.length > 78 && line !== `${name}:`) {
      lines.push(line);
      line = ` ${token}`;
    } else {
      line += ` ${token}`;
    }
  }
  lines.push(line);
  return lines.join(CRLF);
}

function formatAddress(address: MimeAddress, field: string): string {
  assertSingleLine(address.email, field);
  if (!isValidEmailSyntax(address.email)) throw new Error(`${field} is not a valid email address: ${address.email}`);
  if (!address.name) return address.email;
  assertSingleLine(address.name, `${field} name`);
  const display = isPrintableAscii(address.name)
    ? `"${address.name.replace(/(["\\])/g, '\\$1')}"`
    : encodeWords(address.name);
  return `${display} <${address.email}>`;
}

function assertMessageId(id: string): string {
  assertSingleLine(id, 'Message-ID');
  if (!/^<[^<>\s]+@[^<>\s]+>$/.test(id)) throw new Error(`Invalid Message-ID: ${id}`);
  return id;
}

/** "Re: " prefix for a follow-up in the same thread; not duplicated when already present. */
export function replySubject(subject: string): string {
  return /^re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

// ── Bodies ──────────────────────────────────────────────────────────────────

function toCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, CRLF);
}

function encodeQuotedPrintableLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  const tokens = [...bytes].map((byte, index) => {
    const isLast = index === bytes.length - 1;
    const isWhitespace = byte === 0x20 || byte === 0x09;
    if (isWhitespace && !isLast) return String.fromCharCode(byte);
    if (byte >= 33 && byte <= 126 && byte !== 61) return String.fromCharCode(byte);
    return `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  });

  const output: string[] = [];
  let current = '';
  for (const token of tokens) {
    // 75 + the soft-break "=" keeps every line within 76 characters.
    if (current.length + token.length > 75) {
      output.push(`${current}=`);
      current = '';
    }
    current += token;
  }
  output.push(current);
  return output.join(CRLF);
}

/** Quoted-printable (RFC 2045) of UTF-8 text; hard line breaks are preserved as CRLF. */
export function encodeQuotedPrintable(text: string): string {
  return toCrlf(text).split(CRLF).map(encodeQuotedPrintableLine).join(CRLF);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textToHtmlParagraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function buildHtmlBody(textBody: string, signatureHtml: string): string {
  const paragraphs = textToHtmlParagraphs(textBody.replace(/\r\n?/g, '\n'));
  return `<!DOCTYPE html>\n<html><body>\n${paragraphs}\n<br>\n${signatureHtml}\n</body></html>`;
}

/** Plain-text version of an HTML signature, for callers that only have the HTML. */
export function signatureFromHtml(html: string): MimeSignature {
  return { html, text: htmlToText(html) };
}

function assertSignature(signature: MimeSignature | undefined): MimeSignature {
  if (!signature || typeof signature.html !== 'string' || typeof signature.text !== 'string') {
    throw new Error('A signature (html and text) is required to build a message');
  }
  if (signature.html.trim() === '' || signature.text.trim() === '') {
    throw new Error('The signature must not be empty');
  }
  return signature;
}

function wrapBase64(content: Buffer): string {
  return (content.toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);
}

/** `Name: value; param; param`, moving a parameter to a continuation line when it would pass 78 characters. */
function parameterHeader(name: string, value: string, parameters: readonly string[]): string {
  const lines = [`${name}: ${value}`];
  for (const parameter of parameters) {
    const last = lines[lines.length - 1];
    if (last.length + 2 + parameter.length > 78) {
      lines[lines.length - 1] = `${last};`;
      lines.push(` ${parameter}`);
    } else {
      lines[lines.length - 1] = `${last}; ${parameter}`;
    }
  }
  return lines.join(CRLF);
}

function multipartHeader(subtype: 'mixed' | 'alternative', boundary: string): string {
  return parameterHeader('Content-Type', `multipart/${subtype}`, [`boundary="${boundary}"`]);
}

function attachmentHeaders(attachment: MimeAttachment): string[] {
  assertSingleLine(attachment.contentType, 'attachment content type');
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(attachment.contentType)) {
    throw new Error(`Invalid attachment content type: ${attachment.contentType}`);
  }
  const filename = assertSingleLine(attachment.filename, 'attachment filename').replace(/["\\/]/g, '_');
  const nameParams = isPrintableAscii(filename)
    ? `filename="${filename}"`
    : `filename*=UTF-8''${encodeURIComponent(filename)}`;
  return [
    parameterHeader('Content-Type', attachment.contentType, [nameParams.replace('filename', 'name')]),
    'Content-Transfer-Encoding: base64',
    parameterHeader('Content-Disposition', 'attachment', [nameParams]),
  ];
}

function defaultBoundary(): string {
  return `=_outreach_${randomBytes(12).toString('hex')}`;
}

/**
 * multipart/mixed (when there is an attachment) around multipart/alternative
 * (text + HTML). Every line ends in CRLF, headers are RFC 2047 encoded when
 * non-ASCII, and the follow-up threads through In-Reply-To / References.
 */
export function buildMimeMessage(input: BuildMimeInput): BuiltMimeMessage {
  const generateBoundary = input.generateBoundary ?? defaultBoundary;
  const fromDomain = input.from.email.slice(input.from.email.lastIndexOf('@') + 1);
  const messageId = assertMessageId(input.messageId ?? `<${randomBytes(16).toString('hex')}@${fromDomain}>`);
  const date = DateTime.fromJSDate(input.date ?? new Date(), { zone: 'utc' }).toRFC2822();
  if (date === null) throw new Error('Invalid message date');

  const headers = [
    `From: ${formatAddress(input.from, 'From')}`,
    `To: ${formatAddress(input.to, 'To')}`,
    subjectHeader(assertSingleLine(input.subject, 'Subject')),
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${assertMessageId(input.inReplyTo)}`);
  // A reply without a References chain would not thread in every client.
  const references = input.references?.length ? input.references : input.inReplyTo ? [input.inReplyTo] : [];
  if (references.length > 0) {
    headers.push(foldHeader('References', references.map(assertMessageId).join(' ')));
  }

  const signature = assertSignature(input.signature);
  const textPart = `${input.textBody.trim()}\n\n${signature.text.trim()}`;
  const htmlPart = buildHtmlBody(input.textBody, signature.html);

  const alternativeBoundary = generateBoundary();
  const alternative = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    encodeQuotedPrintable(textPart),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    encodeQuotedPrintable(htmlPart),
    `--${alternativeBoundary}--`,
  ];

  let lines: string[];
  if (input.attachment) {
    const mixedBoundary = generateBoundary();
    lines = [
      ...headers,
      multipartHeader('mixed', mixedBoundary),
      '',
      `--${mixedBoundary}`,
      multipartHeader('alternative', alternativeBoundary),
      '',
      ...alternative,
      `--${mixedBoundary}`,
      ...attachmentHeaders(input.attachment),
      '',
      wrapBase64(input.attachment.content),
      `--${mixedBoundary}--`,
    ];
  } else {
    lines = [...headers, multipartHeader('alternative', alternativeBoundary), '', ...alternative];
  }

  return { raw: `${lines.join(CRLF)}${CRLF}`, messageId };
}
