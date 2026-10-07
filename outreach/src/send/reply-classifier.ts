import type { GmailThreadMessage } from './gmail-client';

// Decides what the messages of a sent thread mean. Pure: the tick feeds it what Gmail returned.

export type InboundVerdict =
  | { kind: 'none' }
  | { kind: 'replied'; optOut: boolean }
  | { kind: 'bounced' };

// Matched against the reply's snippet (the first lines of the new text), so a quoted copy of our own
// email further down cannot trigger it. A false positive only suppresses an address, never emails one.
const OPT_OUT_PATTERNS: readonly RegExp[] = [
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\bnot interested\b/i,
  /d[ée]sinscri/i,
  /pas int[ée]ress[ée]/i,
];

const DELIVERY_AGENT_LOCAL_PARTS = new Set(['mailer-daemon', 'postmaster']);

/** `Claire Martin <Claire@Acme.example>` -> `claire@acme.example`. */
export function extractAddress(from: string): string {
  const angled = from.match(/<([^<>]+)>/);
  return (angled ? angled[1] : from).trim().toLowerCase();
}

export function isOptOutText(text: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text));
}

function isDeliveryAgent(address: string): boolean {
  return DELIVERY_AGENT_LOCAL_PARTS.has(address.split('@')[0] ?? '');
}

/**
 * A human reply wins over a delivery notice in the same thread (the mailbox received the answer); otherwise a
 * notice from mailer-daemon or postmaster means a bounce. Messages we sent ourselves are ignored.
 */
export function classifyThread(messages: readonly GmailThreadMessage[], selfEmail: string): InboundVerdict {
  const self = selfEmail.trim().toLowerCase();
  const incoming = messages.filter((message) => {
    return extractAddress(message.from) !== self && !message.labelIds.includes('SENT');
  });

  const humans = incoming.filter((message) => !isDeliveryAgent(extractAddress(message.from)));
  if (humans.length > 0) {
    return { kind: 'replied', optOut: humans.some((message) => isOptOutText(message.snippet)) };
  }
  if (incoming.length > 0) return { kind: 'bounced' };
  return { kind: 'none' };
}
