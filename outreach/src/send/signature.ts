import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { OutreachPaths } from '../config/paths';
import { signatureFromHtml } from '../core/mime';
import type { MimeSignature } from '../core/mime';

import type { GmailClient } from './gmail-client';

// The Gmail API does not add the mailbox signature to a message it sends, so it is fetched from the
// mailbox settings once, cached in signature.html (gitignored) and appended by the one MIME builder.

export class SignatureMissingError extends Error {}

export const SIGNATURE_HINT = 'Run: npm run outreach -- signature';

export function signatureFiles(paths: OutreachPaths): { html: string; text: string } {
  return { html: join(paths.root, 'signature.html'), text: join(paths.root, 'signature.txt') };
}

/** Reads the cached signature; throws when it is missing or blank so nothing is ever sent unsigned. */
export function loadSignature(paths: OutreachPaths): MimeSignature {
  const { html: file } = signatureFiles(paths);
  let html: string;
  try {
    html = readFileSync(file, 'utf-8');
  } catch {
    throw new SignatureMissingError(`No signature at ${file}. ${SIGNATURE_HINT}`);
  }
  const signature = signatureFromHtml(html);
  if (signature.html.trim() === '' || signature.text.trim() === '') {
    throw new SignatureMissingError(`The signature at ${file} is empty. Set one in Gmail settings, then: ${SIGNATURE_HINT}`);
  }
  return signature;
}

/** Fetches the send-as signature of `email` and caches it (HTML, plus a readable text copy). */
export async function fetchAndSaveSignature(
  gmail: GmailClient,
  email: string,
  paths: OutreachPaths,
): Promise<{ htmlFile: string; textFile: string; textPreview: string }> {
  const html = await gmail.getSendAsSignature(email);
  const signature = signatureFromHtml(html);
  if (signature.html.trim() === '' || signature.text.trim() === '') {
    throw new SignatureMissingError(
      `${email} has no signature in Gmail. Set one under Settings > General > Signature, then: ${SIGNATURE_HINT}`,
    );
  }
  const files = signatureFiles(paths);
  await mkdir(paths.root, { recursive: true });
  await writeFile(files.html, html, 'utf-8');
  await writeFile(files.text, `${signature.text.trim()}\n`, 'utf-8');
  return { htmlFile: files.html, textFile: files.text, textPreview: signature.text.trim() };
}
