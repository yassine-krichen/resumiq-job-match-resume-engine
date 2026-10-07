import { GmailApiError, GmailAuthError, GmailNetworkError, GmailTokenError, GoogleGmailClient } from './gmail-client';

interface Call {
  url: string;
  init: RequestInit;
}

function clientWith(respond: (call: Call) => Response | Promise<Response>): { client: GoogleGmailClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { client: new GoogleGmailClient(async () => 'access-token', fetchFn), calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GoogleGmailClient', () => {
  it('posts the message as base64url raw with the thread id and a bearer token', async () => {
    const { client, calls } = clientWith(() => json({ id: 'm1', threadId: 't1' }));

    const sent = await client.sendMessage({ raw: 'Subject: Hé?\r\n\r\nbody', threadId: 't1' });

    expect(sent).toEqual({ id: 'm1', threadId: 't1' });
    expect(calls[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
    const body = JSON.parse(calls[0].init.body as string) as { raw: string; threadId: string };
    expect(body.threadId).toBe('t1');
    expect(Buffer.from(body.raw, 'base64url').toString('utf8')).toBe('Subject: Hé?\r\n\r\nbody');
  });

  it('reads the Message-ID header case-insensitively from the metadata', async () => {
    const { client, calls } = clientWith(() =>
      json({ id: 'm1', payload: { headers: [{ name: 'Message-Id', value: '<abc@mail.gmail.com>' }] } }),
    );

    expect(await client.getRfcMessageId('m1')).toBe('<abc@mail.gmail.com>');
    expect(calls[0].url).toContain('format=metadata');
  });

  it('maps a thread to From, labels, decoded snippet and Message-ID', async () => {
    const { client } = clientWith(() =>
      json({
        messages: [
          {
            id: 'a',
            labelIds: ['INBOX'],
            snippet: 'I&#39;m not interested &amp; busy',
            payload: { headers: [{ name: 'From', value: 'Claire <claire@acme.example>' }, { name: 'Message-ID', value: '<x@y>' }] },
          },
        ],
      }),
    );

    expect(await client.getThread('t1')).toEqual([
      {
        id: 'a',
        from: 'Claire <claire@acme.example>',
        labelIds: ['INBOX'],
        snippet: "I'm not interested & busy",
        rfcMessageId: '<x@y>',
      },
    ]);
  });

  it('returns an empty signature when the send-as address has none', async () => {
    const { client, calls } = clientWith(() => json({ sendAsEmail: 'jane@uni.example' }));

    expect(await client.getSendAsSignature('jane@uni.example')).toBe('');
    expect(calls[0].url).toContain('/settings/sendAs/jane%40uni.example');
  });

  it('turns a 401 into an authorization error that names the fix', async () => {
    const { client } = clientWith(() => json({ error: { message: 'Invalid Credentials' } }, 401));

    await expect(client.getThread('t1')).rejects.toThrow(GmailAuthError);
    await expect(client.getThread('t1')).rejects.toThrow(/npm run outreach -- auth/);
  });

  it('keeps the HTTP status on other errors', async () => {
    const { client } = clientWith(() => json({ error: { message: 'Invalid To header' } }, 400));

    await expect(client.sendMessage({ raw: 'x' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Invalid To header') });
    await expect(client.sendMessage({ raw: 'x' })).rejects.toBeInstanceOf(GmailApiError);
  });

  it('reports a dropped connection as a network error, not an API answer', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('fetch failed');
    });

    await expect(client.sendMessage({ raw: 'x' })).rejects.toBeInstanceOf(GmailNetworkError);
  });

  it('reports a 2xx answer with an unreadable body as a network error, since the send may have happened', async () => {
    const { client } = clientWith(() => new Response('<html>oops', { status: 200 }));

    await expect(client.sendMessage({ raw: 'x' })).rejects.toBeInstanceOf(GmailNetworkError);
  });

  it('keeps the first error reason of a rejection (403 rateLimitExceeded)', async () => {
    const { client } = clientWith(() =>
      json({ error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }, 403),
    );

    await expect(client.sendMessage({ raw: 'x' })).rejects.toMatchObject({ status: 403, reason: 'rateLimitExceeded' });
  });

  it('reports a token endpoint failure as a token error before any Gmail request is made', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return json({});
    }) as unknown as typeof fetch;
    const client = new GoogleGmailClient(async () => {
      throw new Error('socket hang up');
    }, fetchFn);

    await expect(client.sendMessage({ raw: 'x' })).rejects.toBeInstanceOf(GmailTokenError);
    expect(calls).toHaveLength(0);
  });

  it('lets an authorization error from the token provider through unchanged', async () => {
    const client = new GoogleGmailClient(async () => {
      throw new GmailAuthError('expired');
    });

    await expect(client.checkAccess()).rejects.toBeInstanceOf(GmailAuthError);
  });

  it('checkAccess gets a token and makes no Gmail request', async () => {
    const { client, calls } = clientWith(() => json({}));

    await client.checkAccess();

    expect(calls).toHaveLength(0);
  });
});
