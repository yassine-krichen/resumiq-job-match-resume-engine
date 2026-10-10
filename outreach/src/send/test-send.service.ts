import type { AppConfig } from '../config/app-config';
import { isValidEmailSyntax } from '../core/email-check';
import type { MimeSignature } from '../core/mime';
import type { OutreachStore } from '../db/outreach-store';
import type { RunLayout } from '../services/run-layout';

import type { GmailClient } from './gmail-client';
import { buildOutgoingMessage } from './outgoing-message';
import { listReviewableDrafts } from './review-drafts';

// `test-send` is the owner's end-to-end check: the real message, built by the real builder with the real
// signature and resume, goes through Gmail to an address of the owner's choosing instead of the company. It is
// not part of the pipeline: no send row, no status change, no follow-up scheduling, so nothing it does can make the
// tick send (or skip) anything later. The only trace is a `test_send` event.

export const TEST_SEND_EVENT = 'test_send';

export interface TestSendDeps {
  store: OutreachStore;
  gmail: GmailClient;
  layout: RunLayout;
  config: AppConfig;
  /** The only address that receives anything. */
  to: string;
  limit: number;
  slug?: string;
  /** Throws when signature.html is missing or empty: a test message must be as complete as a real one. */
  loadSignature: () => MimeSignature;
  readResume: (relativePath: string) => Promise<Buffer>;
  now: () => Date;
}

export interface TestSendReport {
  runId: string;
  to: string;
  sent: Array<{ slug: string; to: string; subject: string; gmailMessageId: string }>;
  failed: Array<{ slug: string; reason: string }>;
}

function senderEmailOf(config: AppConfig): string {
  const email = config.outreach.sender_email;
  if (!email) throw new Error('sender_email is missing in outreach.config.json (the Gmail address you send from)');
  return email;
}

/** Sends the first email of up to `limit` drafts awaiting review or approved to `to`, subject-marked as a test. */
export async function runTestSend(deps: TestSendDeps): Promise<TestSendReport> {
  const to = deps.to.trim();
  if (!isValidEmailSyntax(to)) throw new Error('--to must be one valid email address, the one that receives the test messages');

  const { items } = await listReviewableDrafts(deps.store, deps.layout.runId, deps.slug);
  const selected = items.slice(0, deps.limit);
  // A typo here would otherwise send a "[TEST]" message to a real contact.
  if (selected.some((item) => item.contact.email.toLowerCase() === to.toLowerCase())) {
    throw new Error('--to is the real recipient of a selected draft; use your own address');
  }

  const sender = { name: deps.config.outreach.sender_name, email: senderEmailOf(deps.config) };
  const signature = deps.loadSignature();
  await deps.gmail.checkAccess();

  const report: TestSendReport = { runId: deps.layout.runId, to, sent: [], failed: [] };
  for (const { company, contact, draft } of selected) {
    const subject = `[TEST → ${contact.email}] ${draft.subject}`;
    try {
      const message = buildOutgoingMessage({
        send: { kind: 'initial' },
        draft: { ...draft, subject },
        initial: null,
        contact: { email: to, name: null },
        sender,
        signature,
        resume: await deps.readResume(draft.resumePdfPath),
        now: deps.now(),
      });
      const result = await deps.gmail.sendMessage({ raw: message.raw });
      await deps.store.recordEvent(company.id, TEST_SEND_EVENT, { draftId: draft.id, to, gmailMessageId: result.id });
      report.sent.push({ slug: company.slug, to, subject, gmailMessageId: result.id });
    } catch (error) {
      report.failed.push({ slug: company.slug, reason: error instanceof Error ? error.message : String(error) });
      break;
    }
  }
  return report;
}
