import type { GmailClient, GmailThreadMessage } from '../send/gmail-client';

export interface FakeSentMessage {
  gmailId: string;
  threadId: string;
  /** The thread the caller asked for (undefined for a first email). */
  requestedThreadId?: string;
  raw: string;
  /** The Message-ID Gmail "rewrote" the message to, as read back later. */
  rfcMessageId: string;
}

/** In-memory Gmail: records what was sent, keeps threads, and can inject replies and failures. */
export class FakeGmail implements GmailClient {
  readonly sent: FakeSentMessage[] = [];
  readonly threads = new Map<string, GmailThreadMessage[]>();
  /** Errors thrown by successive sendMessage calls before it succeeds again. */
  sendErrors: unknown[] = [];
  /** Makes getRfcMessageId throw, as if Gmail were briefly unreachable after the send. */
  readbackError: unknown = null;
  threadError: unknown = null;
  /** Errors thrown by successive checkAccess calls (a token endpoint outage), then it succeeds again. */
  accessErrors: unknown[] = [];
  signature = '<div>Jane Doe<br>Software Engineering Student</div>';
  private counter = 0;

  constructor(private readonly senderEmail = 'jane.doe@example.com') {}

  async checkAccess(): Promise<void> {
    const error = this.accessErrors.shift();
    if (error !== undefined) throw error;
  }

  async sendMessage(input: { raw: string; threadId?: string }): Promise<{ id: string; threadId: string }> {
    const error = this.sendErrors.shift();
    if (error !== undefined) throw error;

    this.counter += 1;
    const gmailId = `gm-${this.counter}`;
    const threadId = input.threadId ?? `th-${this.counter}`;
    const rfcMessageId = `<rewritten-${this.counter}@mail.gmail.com>`;
    this.sent.push({ gmailId, threadId, requestedThreadId: input.threadId, raw: input.raw, rfcMessageId });
    this.addMessage(threadId, {
      id: gmailId,
      from: `Jane Doe <${this.senderEmail}>`,
      labelIds: ['SENT'],
      snippet: '',
      rfcMessageId,
    });
    return { id: gmailId, threadId };
  }

  async getRfcMessageId(gmailMessageId: string): Promise<string | null> {
    if (this.readbackError) throw this.readbackError;
    return this.sent.find((message) => message.gmailId === gmailMessageId)?.rfcMessageId ?? null;
  }

  async getThread(threadId: string): Promise<GmailThreadMessage[]> {
    if (this.threadError) throw this.threadError;
    return [...(this.threads.get(threadId) ?? [])];
  }

  async getSendAsSignature(): Promise<string> {
    return this.signature;
  }

  /** Test helper: a message from someone else lands in a thread. */
  addIncoming(threadId: string, from: string, snippet: string): void {
    this.counter += 1;
    this.addMessage(threadId, {
      id: `gm-in-${this.counter}`,
      from,
      labelIds: ['INBOX'],
      snippet,
      rfcMessageId: `<incoming-${this.counter}@remote.example>`,
    });
  }

  private addMessage(threadId: string, message: GmailThreadMessage): void {
    this.threads.set(threadId, [...(this.threads.get(threadId) ?? []), message]);
  }
}
