import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { dirname } from 'node:path';

import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

import type { GmailEnv } from '../config/env';
import { isInside } from '../services/run-layout';

import { GmailAuthError, GmailTokenError } from './gmail-client';
import type { AccessTokenProvider } from './gmail-client';

// OAuth "desktop app" loopback flow (RFC 8252): a one-shot HTTP server on 127.0.0.1 receives the redirect.
// Only the refresh token is stored; access tokens are minted on demand.

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

const AUTH_TIMEOUT_MS = 5 * 60_000;

export const REAUTH_HINT = 'Run: npm run outreach -- auth';

interface StoredToken {
  refresh_token: string;
  /** The mailbox this token signs in as, recorded at `auth` so a token for the wrong account is caught. */
  email?: string;
}

/** The token is a mailbox credential: refuse a path inside the repository, where it could be committed. */
export function assertTokenOutsideRepo(tokenPath: string, outreachRoot: string): void {
  // The monorepo root is the parent of outreach/ (the folder is published as a subtree of it).
  if (isInside(outreachRoot, tokenPath) || isInside(dirname(outreachRoot), tokenPath)) {
    throw new GmailAuthError(`GMAIL_TOKEN_PATH must be outside the repository, got ${tokenPath}`);
  }
}

/** True for the error Google returns when a refresh token expired, was revoked or the password changed. */
export function isInvalidGrantError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { message?: unknown; response?: { data?: { error?: unknown } } };
  return candidate.response?.data?.error === 'invalid_grant' || String(candidate.message ?? '').includes('invalid_grant');
}

export async function saveRefreshToken(tokenPath: string, refreshToken: string, email: string): Promise<void> {
  await mkdir(dirname(tokenPath), { recursive: true });
  const temp = `${tokenPath}.tmp`;
  const stored: StoredToken = { refresh_token: refreshToken, email };
  try {
    await writeFile(temp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await rename(temp, tokenPath);
  } catch (error) {
    // Do not leave a half-written copy of the credential next to the real one.
    await rm(temp, { force: true });
    throw error;
  }
  // No-op on Windows, where the file inherits the per-user ACL of the home folder.
  await chmod(tokenPath, 0o600).catch(() => undefined);
}

async function readStoredToken(tokenPath: string): Promise<StoredToken> {
  let text: string;
  try {
    text = await readFile(tokenPath, 'utf-8');
  } catch {
    throw new GmailAuthError(`No Gmail token at ${tokenPath}. ${REAUTH_HINT}`);
  }
  try {
    const parsed = JSON.parse(text) as Partial<StoredToken>;
    if (typeof parsed.refresh_token === 'string' && parsed.refresh_token !== '') {
      return { refresh_token: parsed.refresh_token, email: typeof parsed.email === 'string' ? parsed.email : undefined };
    }
  } catch {
    // falls through to the error below
  }
  throw new GmailAuthError(`The Gmail token file ${tokenPath} is unreadable. ${REAUTH_HINT}`);
}

export async function loadRefreshToken(tokenPath: string): Promise<string> {
  return (await readStoredToken(tokenPath)).refresh_token;
}

/**
 * Refuses to go on when the saved token belongs to a different mailbox than `sender_email` (or records none).
 * Sending from the wrong account would put another address on every email.
 */
export async function assertTokenMatchesSender(tokenPath: string, senderEmail: string): Promise<void> {
  const { email } = await readStoredToken(tokenPath);
  if (!email) throw new GmailAuthError(`The saved Gmail token does not record which account it is for. ${REAUTH_HINT}`);
  if (email.trim().toLowerCase() !== senderEmail.trim().toLowerCase()) {
    throw new GmailAuthError(
      `The saved Gmail token is for ${email} but sender_email is ${senderEmail}. Sign in with the sending account (${REAUTH_HINT}) or fix sender_email.`,
    );
  }
}

/** Separates a dead authorization (re-run auth) from a token endpoint that merely failed (nothing was sent, retry later). */
export function mapTokenError(error: unknown): Error {
  if (error instanceof GmailAuthError || error instanceof GmailTokenError) return error;
  if (isInvalidGrantError(error)) {
    return new GmailAuthError(`Gmail authorization expired or was revoked (invalid_grant). Sign in again. ${REAUTH_HINT}`);
  }
  return new GmailTokenError(`could not refresh the Gmail access token: ${error instanceof Error ? error.message : 'unknown error'}`);
}

/** A function that returns a fresh access token, mapping a dead refresh token to a clear instruction. */
export function createAccessTokenProvider(env: GmailEnv, outreachRoot: string): AccessTokenProvider {
  assertTokenOutsideRepo(env.tokenPath, outreachRoot);
  let client: OAuth2Client | null = null;
  return async () => {
    if (client === null) {
      const created = new OAuth2Client({ clientId: env.clientId, clientSecret: env.clientSecret });
      created.setCredentials({ refresh_token: await loadRefreshToken(env.tokenPath) });
      client = created;
    }
    try {
      const { token } = await client.getAccessToken();
      if (!token) throw new GmailAuthError(`Google returned no access token. ${REAUTH_HINT}`);
      return token;
    } catch (error) {
      throw mapTokenError(error);
    }
  };
}

// ── Loopback listener ───────────────────────────────────────────────────────

export interface LoopbackListener {
  redirectUri: string;
  /** Resolves with the authorization code once Google redirects back with the expected state. */
  waitForCode(expectedState: string, timeoutMs?: number): Promise<string>;
  close(): void;
}

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Outreach</title><p style="font:16px system-ui;margin:3rem">${message}</p>`;
}

export async function startLoopbackListener(): Promise<LoopbackListener> {
  let deliver: (url: URL) => void = () => undefined;
  const arrived = new Promise<URL>((resolve) => {
    deliver = resolve;
  });

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    // Browsers also ask for /favicon.ico; only the redirect carries a state.
    if (!url.searchParams.has('state') && !url.searchParams.has('error')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page('You can close this tab and go back to the terminal.'));
    deliver(url);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Could not open the loopback listener');

  return {
    redirectUri: `http://127.0.0.1:${address.port}`,
    async waitForCode(expectedState, timeoutMs = AUTH_TIMEOUT_MS) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for the Google sign-in (5 minutes)')), timeoutMs);
      });
      try {
        const url = await Promise.race([arrived, timeout]);
        if (url.searchParams.get('state') !== expectedState) throw new Error('Sign-in response had the wrong state; aborting');
        const error = url.searchParams.get('error');
        if (error) throw new Error(`Google sign-in failed: ${error}`);
        const code = url.searchParams.get('code');
        if (!code) throw new Error('Sign-in response had no authorization code');
        return code;
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      server.close();
      server.closeAllConnections();
    },
  };
}

export interface AuthResult {
  email: string;
}

/**
 * Runs the whole sign-in: prints (and opens) the consent URL, waits for the redirect, exchanges the code with
 * PKCE and saves the refresh token. `openUrl` is injected so the CLI decides how to launch a browser.
 */
export async function runLoopbackAuth(
  env: GmailEnv,
  outreachRoot: string,
  io: { announce: (url: string) => void; openUrl: (url: string) => void },
): Promise<AuthResult> {
  assertTokenOutsideRepo(env.tokenPath, outreachRoot);
  const listener = await startLoopbackListener();
  try {
    const client = new OAuth2Client({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      redirectUri: listener.redirectUri,
    });
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(16).toString('hex');
    const url = client.generateAuthUrl({
      access_type: 'offline',
      // Without a forced consent screen Google omits the refresh token on a repeat sign-in.
      prompt: 'consent',
      scope: [...GMAIL_SCOPES],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    io.announce(url);
    io.openUrl(url);

    const code = await listener.waitForCode(state);
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: listener.redirectUri });
    if (!tokens.refresh_token) {
      throw new Error(
        'Google returned no refresh token. Remove the app at myaccount.google.com/permissions and run auth again.',
      );
    }
    // Read the account first: a token that cannot be attributed to a mailbox is not saved.
    const email = await profileEmail(tokens.access_token ?? '');
    await saveRefreshToken(env.tokenPath, tokens.refresh_token, email);
    return { email };
  } finally {
    listener.close();
  }
}

async function profileEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not read the Gmail profile (HTTP ${response.status})`);
  const profile = (await response.json()) as { emailAddress?: string };
  if (!profile.emailAddress) throw new Error('The Gmail profile has no email address');
  return profile.emailAddress;
}
