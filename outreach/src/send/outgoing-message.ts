import { buildMimeMessage, replySubject } from '../core/mime';
import type { BuiltMimeMessage, MimeSignature } from '../core/mime';
import type { ContactRecord, DraftRecord, SendRecord } from '../db/outreach-store';

// Turns one send row into the message Gmail gets. Both kinds go through buildMimeMessage, which is what
// guarantees the signature, so there is no second way to produce an outgoing email.

export class FollowUpNotThreadableError extends Error {}

export interface OutgoingInput {
  send: Pick<SendRecord, 'kind'>;
  draft: Pick<DraftRecord, 'subject' | 'body' | 'followUpBody'>;
  /** The initial send of the same draft; required for a follow-up (its thread and Message-ID). */
  initial: Pick<SendRecord, 'providerMessageId' | 'providerThreadId'> | null;
  contact: Pick<ContactRecord, 'email' | 'name'>;
  sender: { name: string; email: string };
  signature: MimeSignature;
  /** The resume PDF of the initial email; follow-ups carry no attachment. */
  resume: Buffer | null;
  now: Date;
}

export interface OutgoingMessage extends BuiltMimeMessage {
  /** Present for a follow-up: the Gmail conversation it joins. */
  threadId?: string;
}

/** `Jane Doe` -> `Jane-Doe-Resume.pdf` (SPEC section 5). Characters that are unsafe in a filename are dropped. */
export function resumeAttachmentName(senderName: string): string {
  const words = senderName
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((word) => word !== '');
  return words.length > 0 ? `${words.join('-')}-Resume.pdf` : 'Resume.pdf';
}

export function buildOutgoingMessage(input: OutgoingInput): OutgoingMessage {
  const { send, draft, contact, sender, signature, now } = input;
  const to = { email: contact.email, ...(contact.name ? { name: contact.name } : {}) };
  const from = { name: sender.name, email: sender.email };

  if (send.kind === 'initial') {
    if (input.resume === null) throw new Error('The first email needs its resume attached');
    return buildMimeMessage({
      from,
      to,
      subject: draft.subject,
      textBody: draft.body,
      signature,
      attachment: { filename: resumeAttachmentName(sender.name), contentType: 'application/pdf', content: input.resume },
      date: now,
    });
  }

  const { initial } = input;
  if (!initial?.providerMessageId || !initial.providerThreadId) {
    throw new FollowUpNotThreadableError('The first email has no stored Message-ID or thread, so the follow-up cannot be threaded');
  }
  const built = buildMimeMessage({
    from,
    to,
    subject: replySubject(draft.subject),
    textBody: draft.followUpBody,
    signature,
    inReplyTo: initial.providerMessageId,
    references: [initial.providerMessageId],
    date: now,
  });
  return { ...built, threadId: initial.providerThreadId };
}
