import { buildOutgoingMessage, FollowUpNotThreadableError, resumeAttachmentName } from './outgoing-message';

const base = {
  draft: { subject: 'Your fleet scheduler', body: 'First body.', followUpBody: 'Second body.' },
  contact: { email: 'claire@acme.example', name: 'Claire Martin' },
  sender: { name: 'Jane Doe', email: 'jane.doe@example.com' },
  signature: { html: '<b>Jane</b>', text: 'Jane' },
  now: new Date('2026-10-12T06:30:00Z'),
};

const threaded = { providerMessageId: '<abc@mail.gmail.com>', providerThreadId: 'th-1' };

describe('resumeAttachmentName', () => {
  it('is Firstname-Lastname-Resume.pdf', () => {
    expect(resumeAttachmentName('Jane Doe')).toBe('Jane-Doe-Resume.pdf');
    expect(resumeAttachmentName('  Jane   Doe ')).toBe('Jane-Doe-Resume.pdf');
  });

  it('drops characters that are unsafe in a filename', () => {
    expect(resumeAttachmentName('Jane "J" Doe')).toBe('Jane-J-Doe-Resume.pdf');
  });
});

describe('buildOutgoingMessage', () => {
  it('attaches the resume to the first email and starts a new thread', () => {
    const message = buildOutgoingMessage({ ...base, send: { kind: 'initial' }, initial: null, resume: Buffer.from('%PDF') });
    expect(message.threadId).toBeUndefined();
    expect(message.raw).toContain('application/pdf');
    expect(message.raw).not.toContain('In-Reply-To');
  });

  it('refuses a first email without its resume', () => {
    expect(() => buildOutgoingMessage({ ...base, send: { kind: 'initial' }, initial: null, resume: null })).toThrow(
      /resume/,
    );
  });

  it('threads a follow-up on the stored Message-ID without an attachment', () => {
    const message = buildOutgoingMessage({ ...base, send: { kind: 'follow_up' }, initial: threaded, resume: null });
    expect(message.threadId).toBe('th-1');
    expect(message.raw).toContain('In-Reply-To: <abc@mail.gmail.com>');
    expect(message.raw).toContain('References: <abc@mail.gmail.com>');
    expect(message.raw).toContain('Subject: Re: Your fleet scheduler');
    expect(message.raw).not.toContain('application/pdf');
  });

  it('refuses a follow-up when the first email has no stored Message-ID', () => {
    const initial = { providerMessageId: null, providerThreadId: 'th-1' };
    expect(() => buildOutgoingMessage({ ...base, send: { kind: 'follow_up' }, initial, resume: null })).toThrow(
      FollowUpNotThreadableError,
    );
  });

  it('appends the signature to both kinds', () => {
    const first = buildOutgoingMessage({ ...base, send: { kind: 'initial' }, initial: null, resume: Buffer.from('%PDF') });
    const followUp = buildOutgoingMessage({ ...base, send: { kind: 'follow_up' }, initial: threaded, resume: null });
    for (const message of [first, followUp]) {
      expect(message.raw).toContain('<b>Jane</b>');
    }
  });
});
