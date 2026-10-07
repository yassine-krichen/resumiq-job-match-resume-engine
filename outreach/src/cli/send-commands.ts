import { join } from 'node:path';

import { loadAppConfig } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { loadGmailEnv } from '../config/env';
import { assertTokenMatchesSender, createAccessTokenProvider, runLoopbackAuth } from '../send/gmail-auth';
import { GoogleGmailClient } from '../send/gmail-client';
import { readResumeFile } from '../send/resume-file';
import { fetchAndSaveSignature, loadSignature } from '../send/signature';
import { appendTickLog } from '../send/tick-log';
import { runTick } from '../send/tick.service';
import type { TickReport } from '../send/tick.service';
import { openFile } from '../tui/external-programs';
import { assertInteractiveTerminal, runReview } from '../tui/run-review';

import { loadConfigAndInventory, openStore } from './context';
import type { Context } from './context';

// The human-run commands that talk to Gmail or take over the terminal: review, auth, signature, tick.
// Kept out of index.ts so its command switch stays one line per command.

function senderEmailOf(config: AppConfig): string {
  const email = config.outreach.sender_email;
  if (!email) throw new Error('sender_email is missing in outreach.config.json (the Gmail address you send from)');
  return email;
}

/** A Gmail client for the configured sender. Refuses a token that was issued for a different mailbox. */
async function gmailClient(context: Context, config: AppConfig): Promise<GoogleGmailClient> {
  const env = loadGmailEnv();
  await assertTokenMatchesSender(env.tokenPath, senderEmailOf(config));
  return new GoogleGmailClient(createAccessTokenProvider(env, context.paths.root));
}

export async function reviewCommand(context: Context): Promise<void> {
  assertInteractiveTerminal();
  const { config, db } = loadConfigAndInventory(context);
  const { store, close } = await openStore();
  try {
    await runReview({ store, config, db, paths: context.paths });
  } finally {
    await close();
  }
}

export async function authCommand(context: Context): Promise<void> {
  const config = loadAppConfig(context.env.configPath, context.paths.root);
  const expected = senderEmailOf(config);
  console.log('Opening Google sign-in in your browser. If nothing opens, copy the URL below into it.');
  const { email } = await runLoopbackAuth(loadGmailEnv(), context.paths.root, {
    announce: (url) => console.log(`\n${url}\n`),
    openUrl: openFile,
  });
  console.log(`Signed in as ${email}. Token saved.`);
  if (email.toLowerCase() !== expected.toLowerCase()) {
    console.warn(
      `warning: sender_email in the config is ${expected}, but you signed in as ${email}. ` +
        'Sign in again with the sending account, or fix sender_email.',
    );
  }
  console.log('Next: npm run outreach -- signature');
}

export async function signatureCommand(context: Context): Promise<void> {
  const config = loadAppConfig(context.env.configPath, context.paths.root);
  const saved = await fetchAndSaveSignature(await gmailClient(context, config), senderEmailOf(config), context.paths);
  console.log(`Saved ${saved.htmlFile} and ${saved.textFile}. Every email will end with:\n\n${saved.textPreview}\n`);
}

function tickCounts(report: TickReport): Record<string, number | boolean | string | null> {
  return Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'errors')) as Record<
    string,
    number | boolean | string | null
  >;
}

export async function tickCommand(context: Context): Promise<void> {
  const config = loadAppConfig(context.env.configPath, context.paths.root);
  senderEmailOf(config);
  const started = Date.now();
  let report: TickReport | null = null;
  let fatal: string | null = null;
  try {
    // Inside the try so a wrong-account token, a missing URL or an unreachable server still reaches the log.
    const gmail = await gmailClient(context, config);
    const { store, close } = await openStore();
    try {
      report = await runTick({
        store,
        gmail,
        config,
        now: () => new Date(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        loadSignature: () => loadSignature(context.paths),
        readResume: (relativePath) => readResumeFile(context.paths.root, relativePath),
      });
    } finally {
      await close();
    }
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
  }

  const errors = [...(report?.errors ?? []), ...(fatal ? [`fatal: ${fatal}`] : [])];
  await appendTickLog(join(context.paths.root, 'logs'), {
    at: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    counts: report ? tickCounts(report) : {},
    errors,
  });

  if (report) {
    console.log(
      `tick: sent ${report.sent}, scheduled ${report.scheduled}+${report.followUpsScheduled} follow-ups, ` +
        `replied ${report.replied} (opt-out ${report.optedOut}), bounced ${report.bounced}, ` +
        `rescheduled ${report.rescheduled}, unknown ${report.unknown}, failed ${report.failed}`,
    );
    if (report.skippedLocked) console.log('tick: another tick is running; nothing done');
    if (report.sendsRefused) console.error(`tick: sending refused: ${report.sendsRefused}`);
  }
  for (const error of errors) console.error(`tick: ${error}`);
  if (fatal || (report && (report.errors.length > 0 || report.sendsRefused))) process.exitCode = 1;
}
