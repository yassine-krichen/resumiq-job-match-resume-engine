import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultGmailTokenPath, loadGmailEnv } from '../config/env';

import {
  assertTokenMatchesSender,
  assertTokenOutsideRepo,
  isInvalidGrantError,
  loadRefreshToken,
  mapTokenError,
  saveRefreshToken,
  startLoopbackListener,
} from './gmail-auth';
import { GmailAuthError, GmailTokenError } from './gmail-client';

describe('isInvalidGrantError', () => {
  it('recognises the error body Google returns for a dead refresh token', () => {
    expect(isInvalidGrantError({ response: { data: { error: 'invalid_grant' } } })).toBe(true);
    expect(isInvalidGrantError(new Error('invalid_grant: Token has been expired or revoked.'))).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isInvalidGrantError(new Error('socket hang up'))).toBe(false);
    expect(isInvalidGrantError({ response: { data: { error: 'invalid_client' } } })).toBe(false);
    expect(isInvalidGrantError(null)).toBe(false);
  });
});

describe('gmail env', () => {
  it('defaults the token to a file under ~/.config/cold-outreach', () => {
    const env = loadGmailEnv({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret' });
    expect(env.tokenPath).toBe(defaultGmailTokenPath());
    expect(env.tokenPath).toMatch(/\.config[\\/]cold-outreach[\\/]gmail-token\.json$/);
  });

  it('fails when the OAuth client is not configured, naming the variables but no value', () => {
    expect(() => loadGmailEnv({})).toThrow(/GMAIL_CLIENT_ID/);
  });
});

describe('token storage', () => {
  it('round-trips the refresh token and reports a missing file with the fix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmail-token-'));
    const file = join(dir, 'nested', 'token.json');

    await expect(loadRefreshToken(file)).rejects.toThrow(/npm run outreach -- auth/);
    await saveRefreshToken(file, 'refresh-123', 'jane.doe@example.com');

    expect(await loadRefreshToken(file)).toBe('refresh-123');
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ refresh_token: 'refresh-123', email: 'jane.doe@example.com' });
  });

  it('removes the temp file when the final rename fails, so no stray copy of the credential is left', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmail-token-'));
    const file = join(dir, 'token.json');
    // A directory in the way makes the rename fail.
    mkdirSync(file);

    await expect(saveRefreshToken(file, 'refresh-123', 'jane.doe@example.com')).rejects.toThrow();

    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('refuses a token path inside the repository', () => {
    const root = join(tmpdir(), 'monorepo', 'outreach');
    expect(() => assertTokenOutsideRepo(join(root, 'token.json'), root)).toThrow(GmailAuthError);
    expect(() => assertTokenOutsideRepo(join(root, '..', 'secrets', 'token.json'), root)).toThrow(GmailAuthError);
    expect(() => assertTokenOutsideRepo(join(tmpdir(), 'elsewhere', 'token.json'), root)).not.toThrow();
  });
});

describe('assertTokenMatchesSender', () => {
  async function tokenFor(email: string): Promise<string> {
    const file = join(mkdtempSync(join(tmpdir(), 'gmail-token-')), 'token.json');
    await saveRefreshToken(file, 'refresh-123', email);
    return file;
  }

  it('passes when the token was issued for sender_email, ignoring case', async () => {
    await expect(assertTokenMatchesSender(await tokenFor('Jane.Doe@Example.com'), 'jane.doe@example.com')).resolves.toBeUndefined();
  });

  it('refuses a token that belongs to another mailbox, naming both addresses', async () => {
    const file = await tokenFor('someone.else@example.com');

    await expect(assertTokenMatchesSender(file, 'jane.doe@example.com')).rejects.toThrow(
      /someone\.else@example\.com.*jane\.doe@example\.com/,
    );
  });

  it('refuses a token file that does not record its account', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gmail-token-')), 'token.json');
    writeFileSync(file, JSON.stringify({ refresh_token: 'old-format' }));

    await expect(assertTokenMatchesSender(file, 'jane.doe@example.com')).rejects.toThrow(/does not record which account/);
  });
});

describe('mapTokenError', () => {
  it('maps invalid_grant to an authorization error that names the fix', () => {
    const mapped = mapTokenError({ response: { data: { error: 'invalid_grant' } } });
    expect(mapped).toBeInstanceOf(GmailAuthError);
    expect(mapped.message).toMatch(/npm run outreach -- auth/);
  });

  it('maps a token endpoint outage to a token error, which means nothing was sent', () => {
    expect(mapTokenError(new Error('request to https://oauth2.googleapis.com/token failed, reason: socket hang up'))).toBeInstanceOf(
      GmailTokenError,
    );
    expect(mapTokenError(new Error('Request failed with status code 503'))).not.toBeInstanceOf(GmailAuthError);
  });
});

describe('loopback listener', () => {
  it('binds to 127.0.0.1 and returns the code when the state matches', async () => {
    const listener = await startLoopbackListener();
    try {
      expect(listener.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const waiting = listener.waitForCode('state-1', 5000);
      await fetch(`${listener.redirectUri}/?code=abc&state=state-1`);
      expect(await waiting).toBe('abc');
    } finally {
      listener.close();
    }
  });

  it('rejects a redirect with the wrong state', async () => {
    const listener = await startLoopbackListener();
    try {
      const waiting = listener.waitForCode('state-1', 5000);
      const outcome = expect(waiting).rejects.toThrow(/wrong state/);
      await fetch(`${listener.redirectUri}/?code=abc&state=forged`);
      await outcome;
    } finally {
      listener.close();
    }
  });

  it('reports the error Google sent back instead of waiting for a code', async () => {
    const listener = await startLoopbackListener();
    try {
      const waiting = listener.waitForCode('state-1', 5000);
      const outcome = expect(waiting).rejects.toThrow(/access_denied/);
      await fetch(`${listener.redirectUri}/?error=access_denied&state=state-1`);
      await outcome;
    } finally {
      listener.close();
    }
  });
});
