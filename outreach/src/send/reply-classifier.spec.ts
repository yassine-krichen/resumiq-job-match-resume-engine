import type { GmailThreadMessage } from './gmail-client';
import { classifyThread, extractAddress, isOptOutText } from './reply-classifier';

const SELF = 'jane.doe@example.com';

function message(from: string, snippet = '', labelIds: string[] = []): GmailThreadMessage {
  return { id: 'm', from, labelIds, snippet, rfcMessageId: null };
}

describe('extractAddress', () => {
  it('lower-cases the address inside angle brackets and accepts a bare address', () => {
    expect(extractAddress('Claire Martin <Claire@Acme.example>')).toBe('claire@acme.example');
    expect(extractAddress(' CLAIRE@acme.example ')).toBe('claire@acme.example');
  });
});

describe('classifyThread', () => {
  it('reports nothing while the thread holds only our own messages', () => {
    expect(classifyThread([message(`Jane Doe <${SELF}>`), message('alias@example.com', '', ['SENT'])], SELF)).toEqual({
      kind: 'none',
    });
  });

  it('reports a reply from anyone else', () => {
    expect(classifyThread([message(SELF), message('claire@acme.example', 'Sounds good')], SELF)).toEqual({
      kind: 'replied',
      optOut: false,
    });
  });

  it('reports a bounce for mailer-daemon and postmaster', () => {
    expect(classifyThread([message('Mail Delivery Subsystem <mailer-daemon@googlemail.com>')], SELF)).toEqual({
      kind: 'bounced',
    });
    expect(classifyThread([message('postmaster@acme.example')], SELF)).toEqual({ kind: 'bounced' });
  });

  it('prefers a human reply over a delivery notice in the same thread', () => {
    const verdict = classifyThread([message('mailer-daemon@googlemail.com'), message('claire@acme.example', 'ok')], SELF);
    expect(verdict.kind).toBe('replied');
  });

  it('flags an opt-out when any reply asks to stop', () => {
    expect(classifyThread([message('claire@acme.example', 'Please stop.')], SELF)).toEqual({
      kind: 'replied',
      optOut: true,
    });
  });
});

describe('isOptOutText', () => {
  it('matches the English and French opt-out phrases', () => {
    for (const text of ['stop', 'UNSUBSCRIBE', 'Not interested', 'merci de me désinscrire', 'je suis pas intéressée']) {
      expect(isOptOutText(text)).toBe(true);
    }
  });

  it('does not match ordinary replies', () => {
    // "stopped" is a different word from "stop": the pattern is whole-word on purpose.
    for (const text of ['Happy to talk Thursday', 'We stopped hiring last year but keep your CV', 'Interested, call me']) {
      expect(isOptOutText(text)).toBe(false);
    }
  });
});
