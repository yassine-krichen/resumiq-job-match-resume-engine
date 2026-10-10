import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppConfig } from '../config/app-config';
import type { MimeSignature } from '../core/mime';
import type { OutreachStore } from '../db/outreach-store';
import { RunLayout, relativeToRoot } from '../services/run-layout';

import { buildOutgoingMessage } from './outgoing-message';
import { listReviewableDrafts } from './review-drafts';
import type { ReviewableDraft } from './review-drafts';
import { SignatureMissingError, SIGNATURE_HINT } from './signature';

// `preview` writes the exact messages the tick would send, as .eml files you can open in a mail client, without
// Gmail and without changing anything in the database. It is the only place a missing signature is tolerated, and
// then the placeholder is loud: the real builder still refuses to send unsigned.

export const PLACEHOLDER_SIGNATURE_TEXT = `[PREVIEW ONLY: placeholder signature. Your Gmail signature is not cached yet. ${SIGNATURE_HINT}]`;
const PLACEHOLDER_SIGNATURE: MimeSignature = {
  html: `<div style="border:2px dashed #c00;color:#c00;padding:4px">${PLACEHOLDER_SIGNATURE_TEXT}</div>`,
  text: PLACEHOLDER_SIGNATURE_TEXT,
};

/** Only used to fill the From address of a preview when the config has no sender_email. */
const PREVIEW_SENDER_EMAIL = 'sender@preview.invalid';
/** What a follow-up threads on in a preview: the first email was never really sent. */
const PREVIEW_INITIAL = { providerMessageId: '<preview-initial@preview.invalid>', providerThreadId: 'preview-thread' };

export interface PreviewDeps {
  store: OutreachStore;
  layout: RunLayout;
  config: AppConfig;
  /** Throws SignatureMissingError when signature.html is absent or empty. */
  loadSignature: () => MimeSignature;
  readResume: (relativePath: string) => Promise<Buffer>;
  now: () => Date;
  slug?: string;
}

export interface PreviewItem {
  slug: string;
  company: string;
  to: string;
  /** Path relative to outreach/, or null when the message could not be built (see errors). */
  initial: string | null;
  followUp: string | null;
  errors: string[];
}

export interface PreviewReport {
  runId: string;
  placeholderSignature: boolean;
  items: PreviewItem[];
}

function previewSignature(deps: PreviewDeps): { signature: MimeSignature; placeholder: boolean } {
  try {
    return { signature: deps.loadSignature(), placeholder: false };
  } catch (error) {
    if (error instanceof SignatureMissingError) return { signature: PLACEHOLDER_SIGNATURE, placeholder: true };
    throw error;
  }
}

async function previewOne(deps: PreviewDeps, item: ReviewableDraft, signature: MimeSignature): Promise<PreviewItem> {
  const { company, contact, draft } = item;
  const sender = { name: deps.config.outreach.sender_name, email: deps.config.outreach.sender_email ?? PREVIEW_SENDER_EMAIL };
  const dir = deps.layout.storageDir(company.slug);
  await mkdir(dir, { recursive: true });
  const result: PreviewItem = { slug: company.slug, company: company.name, to: contact.email, initial: null, followUp: null, errors: [] };
  const common = { draft, contact, sender, signature, now: deps.now() };

  try {
    const message = buildOutgoingMessage({
      ...common,
      send: { kind: 'initial' },
      initial: null,
      resume: await deps.readResume(draft.resumePdfPath),
    });
    await writeFile(join(dir, 'initial.eml'), message.raw, 'utf-8');
    result.initial = relativeToRoot(deps.layout.paths, join(dir, 'initial.eml'));
  } catch (error) {
    result.errors.push(`initial: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const message = buildOutgoingMessage({ ...common, send: { kind: 'follow_up' }, initial: PREVIEW_INITIAL, resume: null });
    await writeFile(join(dir, 'follow-up.eml'), message.raw, 'utf-8');
    result.followUp = relativeToRoot(deps.layout.paths, join(dir, 'follow-up.eml'));
  } catch (error) {
    result.errors.push(`follow-up: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

/** Writes initial.eml and follow-up.eml for every draft awaiting review or approved (or just `slug`). */
export async function previewRun(deps: PreviewDeps): Promise<PreviewReport> {
  const { items } = await listReviewableDrafts(deps.store, deps.layout.runId, deps.slug);
  const { signature, placeholder } = previewSignature(deps);
  const results: PreviewItem[] = [];
  for (const item of items) results.push(await previewOne(deps, item, signature));
  return { runId: deps.layout.runId, placeholderSignature: placeholder, items: results };
}

/** What `preview` prints: one block per company with the files to open, and a warning when the signature is a placeholder. */
export function formatPreview(report: PreviewReport): string {
  if (report.items.length === 0) return `Nothing to preview in ${report.runId}: no draft is awaiting review or approved.`;
  const lines = [`Preview of ${report.items.length} ${report.items.length === 1 ? 'draft' : 'drafts'} in ${report.runId}. Open the .eml files in a mail client:`];
  for (const item of report.items) {
    lines.push('', `${item.slug}  ${item.company} <${item.to}>`);
    if (item.initial) lines.push(`  ${item.initial}`);
    if (item.followUp) lines.push(`  ${item.followUp}`);
    for (const error of item.errors) lines.push(`  not written, ${error}`);
  }
  if (report.placeholderSignature) {
    lines.push('', `Note: your Gmail signature is not cached, so the messages carry a marked placeholder. ${SIGNATURE_HINT}`);
  }
  return lines.join('\n');
}
