// The Gmail REST calls the sender needs, behind an interface so the tick is tested against a fake.
// Plain `fetch` and an injected token function: no googleapis dependency.

export interface GmailThreadMessage {
  id: string;
  /** Raw From header, e.g. `Claire Martin <claire@acme.example>`. */
  from: string;
  labelIds: readonly string[];
  snippet: string;
  /** The RFC 5322 Message-ID header, or null when the message has none. */
  rfcMessageId: string | null;
}

export interface GmailClient {
  /** Sends a raw RFC 5322 message; `threadId` puts it in an existing conversation. */
  sendMessage(input: { raw: string; threadId?: string }): Promise<{ id: string; threadId: string }>;
  /** Reads back the Message-ID Gmail stored for a message it just sent (Gmail may rewrite the one we built). */
  getRfcMessageId(gmailMessageId: string): Promise<string | null>;
  /** The messages of a conversation, oldest first. */
  getThread(threadId: string): Promise<GmailThreadMessage[]>;
  /** The HTML signature configured for a send-as address ('' when there is none). */
  getSendAsSignature(sendAsEmail: string): Promise<string>;
  /**
   * Obtains an access token without calling Gmail. The tick does this before it claims a send, so a token
   * endpoint outage is found while the row is still untouched.
   */
  checkAccess(): Promise<void>;
}

/** The refresh token is missing, expired or revoked. Nothing was sent; the fix is `npm run outreach -- auth`. */
export class GmailAuthError extends Error {}

/**
 * The access token could not be obtained for a reason that is not a dead authorization (the token endpoint is
 * unreachable or returned 5xx). Raised before any Gmail request, so nothing was sent.
 */
export class GmailTokenError extends Error {}

/** Gmail answered with an HTTP error; `reason` is the first `errors[].reason` of the body (e.g. rateLimitExceeded). */
export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/** No usable HTTP answer (connection reset, timeout): a send that hit this may or may not have gone out. */
export class GmailNetworkError extends Error {}

const BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const REQUEST_TIMEOUT_MS = 30_000;

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageResource {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
}

function header(message: GmailMessageResource, name: string): string | null {
  const found = message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

// Gmail returns snippets with HTML entities escaped.
function decodeSnippet(snippet: string): string {
  return snippet
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export type AccessTokenProvider = () => Promise<string>;

export class GoogleGmailClient implements GmailClient {
  constructor(
    private readonly getAccessToken: AccessTokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sendMessage(input: { raw: string; threadId?: string }): Promise<{ id: string; threadId: string }> {
    const body = {
      raw: Buffer.from(input.raw, 'utf8').toString('base64url'),
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    };
    const sent = await this.request<GmailMessageResource>('/messages/send', { method: 'POST', body });
    if (typeof sent.id !== 'string' || typeof sent.threadId !== 'string') {
      throw new GmailApiError('Gmail send response had no message id', 502);
    }
    return { id: sent.id, threadId: sent.threadId };
  }

  async getRfcMessageId(gmailMessageId: string): Promise<string | null> {
    const message = await this.request<GmailMessageResource>(
      `/messages/${encodeURIComponent(gmailMessageId)}?format=metadata&metadataHeaders=Message-ID`,
    );
    return header(message, 'Message-ID');
  }

  async getThread(threadId: string): Promise<GmailThreadMessage[]> {
    const thread = await this.request<{ messages?: GmailMessageResource[] }>(
      `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID`,
    );
    return (thread.messages ?? []).map((message) => ({
      id: message.id,
      from: header(message, 'From') ?? '',
      labelIds: message.labelIds ?? [],
      snippet: decodeSnippet(message.snippet ?? ''),
      rfcMessageId: header(message, 'Message-ID'),
    }));
  }

  async getSendAsSignature(sendAsEmail: string): Promise<string> {
    const sendAs = await this.request<{ signature?: string }>(`/settings/sendAs/${encodeURIComponent(sendAsEmail)}`);
    return sendAs.signature ?? '';
  }

  async checkAccess(): Promise<void> {
    await this.accessToken();
  }

  private async accessToken(): Promise<string> {
    try {
      return await this.getAccessToken();
    } catch (error) {
      if (error instanceof GmailAuthError || error instanceof GmailTokenError) throw error;
      throw new GmailTokenError(`could not get an access token: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async request<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchFn(`${BASE_URL}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GmailNetworkError(error instanceof Error ? error.message : 'request failed');
    }
    if (response.status === 401) throw new GmailAuthError('Gmail rejected the access token (401). Run: npm run outreach -- auth');
    if (!response.ok) {
      const { message, reason } = await describeError(response);
      throw new GmailApiError(message, response.status, reason);
    }
    try {
      return (await response.json()) as T;
    } catch {
      // The request went out and Gmail answered 2xx: for a send that means it may well have been delivered.
      throw new GmailNetworkError('Gmail answered with an unreadable body');
    }
  }
}

async function describeError(response: Response): Promise<{ message: string; reason?: string }> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
    };
    const detail = body.error?.message ?? body.error?.status;
    return {
      message: `Gmail API ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      reason: body.error?.errors?.[0]?.reason,
    };
  } catch {
    return { message: `Gmail API ${response.status}` };
  }
}
