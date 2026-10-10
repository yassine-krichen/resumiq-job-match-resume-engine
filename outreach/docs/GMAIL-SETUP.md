# Gmail setup, step by step

This guide takes you from nothing to a first real email, in the order that keeps you safe: you look at the
messages as files first, send one to yourself second, and only then let the scheduler send to companies.

You need about 20 minutes and a Google account. Everything runs on your machine; the only thing Google sees is
the mailbox you sign in with.

Contents

1. [Which account to send from](#1-which-account-to-send-from)
2. [Create a Google Cloud project](#2-create-a-google-cloud-project)
3. [Enable the Gmail API](#3-enable-the-gmail-api)
4. [Configure Google Auth Platform](#4-configure-google-auth-platform)
5. [Create the OAuth client](#5-create-the-oauth-client)
6. [Put the id and secret in `.env`](#6-put-the-id-and-secret-in-env)
7. [Set `sender_email` and sign in](#7-set-sender_email-and-sign-in)
8. [Fetch your signature](#8-fetch-your-signature)
9. [Look at the emails: `preview`](#9-look-at-the-emails-preview)
10. [Send one to yourself: `test-send`](#10-send-one-to-yourself-test-send)
11. [Send for real: `tick`](#11-send-for-real-tick)
12. [Run it on a schedule](#12-run-it-on-a-schedule)
13. [Troubleshooting](#13-troubleshooting)

## 1. Which account to send from

Use the Gmail address you want recruiters to reply to. Two cases:

- **A personal `@gmail.com` address.** The simplest. Use it.
- **A school or company address on Google Workspace.** It works only if the administrator allows third-party apps
  to use the Gmail API. Many universities do not. You find out at step 7: the sign-in page says the app is blocked
  or that you need administrator approval. If that happens, do not fight it: use a personal Gmail address and put
  that address in `sender_email` (step 7). Replies then go to that mailbox.

Whatever you pick, the same address must be used in three places: the account you sign in with, `sender_email` in
`outreach.config.json`, and the account whose signature you fetch. The commands check that they match and refuse
to send otherwise.

## 2. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the account from step 1 (or any Google account; the
   project is only a container for the OAuth client, it does not have to belong to the mailbox you send from).
2. Accept the terms if you are asked. You do not need to enable billing: nothing in this guide costs money.
3. Click the project picker at the top of the page, then **New project**.
4. Name it something like `cold-outreach`, leave the organization as it is, and click **Create**.
5. Wait for the notification, then make sure the new project is the one selected in the picker.

## 3. Enable the Gmail API

1. In the left menu open **APIs & Services**, then **Library**.
2. Search for `Gmail API`, open it and click **Enable**.

If the button says **Manage**, it is already enabled.

## 4. Configure Google Auth Platform

The console now calls the consent screen **Google Auth Platform**. In the left menu open it (under
**APIs & Services** it may still appear as **OAuth consent screen**). If it says it is not configured yet, click
**Get started**. The sections are **Branding**, **Audience**, **Data access** and **Clients**. Labels move around a
little over time; follow the section names.

### Branding

1. **App name**: `Cold outreach` (only you will ever see it).
2. **User support email**: your email address.
3. **Developer contact information**: your email address.
4. Save. You can leave logo, domains and links empty.

### Audience

1. **User type**: choose **External**. (**Internal** exists only for Workspace organizations and would limit the
   app to that organization.)
2. Under **Test users** click **Add users** and add the Gmail address you send from, and save. You must do this
   even if you are the project owner.
3. **Publish the app.** Click **Publish app** (the status changes from *Testing* to *In production*) and confirm.

   Do this on purpose. While an app is in *Testing*, Google expires its refresh tokens after **7 days**, so the
   scheduler would stop sending a week after you signed in and every command would say `invalid_grant`. In
   production the token does not expire on a timer. Publishing does not make the app public in any useful sense:
   nobody can find it, and it stays limited to people who open your client id.

   Google may show a warning that the app needs verification. You do not need to verify it for your own use (see
   the next section about the "unverified app" screen).

### Data access

1. Click **Add or remove scopes**.
2. Select these two scopes (search for `gmail`, or paste them into the manual box at the bottom and click
   **Add to table**):

   | Scope | Why |
   | --- | --- |
   | `https://www.googleapis.com/auth/gmail.send` | send the emails |
   | `https://www.googleapis.com/auth/gmail.readonly` | read replies and bounces in the threads it sent, and your signature |

3. **Update**, then **Save**.

The tool never deletes or changes anything in your mailbox. It reads only the threads it started, in metadata
form (sender, labels, snippet).

## 5. Create the OAuth client

1. Open the **Clients** section of Google Auth Platform and click **Create client**.
2. **Application type**: **Desktop app**. It has to be this type; a "Web application" client will not work with
   the sign-in the tool uses.
3. **Name**: `cold-outreach-desktop`. Click **Create**.
4. A dialog shows the **Client ID** and **Client secret**. Copy both now (you can also open the client later and
   download the JSON). Treat the secret like a password.

## 6. Put the id and secret in `.env`

In the project folder (`cp .env.example .env` if you have not yet), set:

```
GMAIL_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-...
```

`.env` is ignored by git. The refresh token that `auth` creates is stored outside the repository, by default in
`%USERPROFILE%\.config\cold-outreach\gmail-token.json`; the tool refuses a token path inside the repo.

## 7. Set `sender_email` and sign in

1. In `outreach.config.json` set `sender_email` to the account from step 1 and `sender_name` to the name that
   should appear in the From line.
2. Run:

   ```bash
   npm run outreach -- auth
   ```

3. Your browser opens a Google sign-in page. If it does not, copy the URL printed in the terminal into a browser.
4. Choose the sending account.
5. You will see **"Google hasn't verified this app"**. This is expected: the app is yours and you did not submit
   it to Google for review. Click **Advanced**, then **Go to cold-outreach (unsafe)**. It is "unsafe" only in the
   sense that Google has not reviewed it; it is your own client id running on your own machine.
6. Tick the permissions (send email, read mail) and click **Continue**.
7. The page says the sign-in is complete. The terminal prints `Signed in as you@example.com. Token saved.`

If the sign-in page instead says the app is **blocked**, **"Access blocked: Authorization Error"**, or asks for
administrator approval, your school or company Workspace does not allow third-party apps. Go back to step 1 and use
a personal Gmail address: sign in to the Cloud console with it, repeat steps 2 to 6 (or add that address as a test
user and sign in with it), set `sender_email` to it, and run `auth` again.

If the address you signed in with is not the one in `sender_email`, the terminal warns you. Fix whichever is wrong
before going on.

## 8. Fetch your signature

The Gmail API does not add your mailbox signature to a message it sends, so the tool fetches it once and appends it
to every email itself.

1. In Gmail open **Settings, See all settings, General, Signature**, create a signature (name, role, a link), set
   it as the default for **new emails** and save.
2. Run:

   ```bash
   npm run outreach -- signature
   ```

   It prints the plain-text version it will append and writes `signature.html` and `signature.txt` (both ignored by
   git). Run it again whenever you change the signature.

No signature, no sending: the message builder refuses an empty one.

## 9. Look at the emails: `preview`

After a run has produced drafts (`/outreach ...` in Claude Code), write the exact messages to files:

```bash
npm run outreach -- preview --run RUN_ID
```

This needs the database and the resume PDFs, not Gmail. For every draft awaiting review or approved it writes
`storage/RUN_ID/SLUG/initial.eml` and `follow-up.eml`. Double-click an `.eml` file (Windows opens it in Mail or
Outlook), or drag it into Thunderbird or Apple Mail. Check the subject, the body, the attachment name, the signature
and, in the follow-up, the `Re:` subject. Add `--slug SLUG` to preview a single company.

If you have not run `signature` yet, the preview shows a red, clearly marked placeholder where the signature goes.
That is for the preview only; a real send is refused without a signature.

## 10. Send one to yourself: `test-send`

```bash
npm run outreach -- test-send --run RUN_ID --to you@example.com
```

This sends the real first email of one draft, with the resume attached, through your Gmail to `you@example.com`
and nowhere else. The subject starts with `[TEST → the real recipient]` so you can see who it would have gone to.
It does not change any draft, company or schedule: the company is still waiting for your review and nothing is
queued. Add `--limit 3` to send three, or `--slug SLUG` to pick the company. It refuses to send to the real
recipient's own address.

Open the message in your inbox on your phone and on a computer. If it looks right, you are ready.

## 11. Send for real: `tick`

1. Review and approve drafts: `npm run outreach:review` (`a` approves one, `A` approves all that passed every check).
2. Run one tick yourself and watch it:

   ```bash
   npm run outreach:tick
   ```

   A tick sends only what is due: the first emails are scheduled for the recipient's next business day between
   08:30 and 10:30 local time, 4 to 11 minutes apart, 20 a day for the first week and 30 after that. If nothing is
   due yet, it prints zeros and sends nothing. Follow-ups go out five business days later in the same thread, unless the
   company replied.

## 12. Run it on a schedule

On Windows:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-schedule.ps1
```

This registers a task that runs a tick every 5 minutes while you are signed in and the PC is on (a missed run
starts when the PC is back). Remove it with `scripts/uninstall-schedule.ps1`. On macOS or Linux, run
`npm run outreach:tick` from cron every 5 minutes.

Each tick writes one line to `logs/tick-YYYY-MM-DD.log` (counts and error codes only, never addresses or text).

## 13. Troubleshooting

| What you see | Why | Fix |
| --- | --- | --- |
| `invalid_grant`, "Gmail authorization expired or was revoked" | The refresh token is dead. Most often the app is still in *Testing* (tokens last 7 days), or you changed your password, or you removed the app at myaccount.google.com/permissions. | Publish the app (step 4, Audience), then run `npm run outreach -- auth` again. Nothing is sent while the token is dead. |
| "The saved Gmail token is for a@x.com but sender_email is b@y.com" | You signed in with one account and configured another. | Run `auth` again with the sending account, or fix `sender_email`. |
| "No signature at ... / The signature is empty" | `signature` was never run, or the mailbox has no signature. | Set a signature in Gmail settings (step 8), run `npm run outreach -- signature`. |
| `Error 403: access_denied` on the Google page | The account is not a test user and the app is still in *Testing*, or the Workspace blocks the app. | Add the account under Audience, Test users, or publish the app. For Workspace, see the next row. |
| "Access blocked", "needs administrator approval", "app is not allowed" | Your school or company disabled third-party apps. | Use a personal Gmail address (step 1) and put it in `sender_email`. |
| "Google hasn't verified this app" | Normal for your own unreviewed app. | **Advanced**, then **Go to ... (unsafe)**. |
| `Error 400: redirect_uri_mismatch` or "invalid_client" | The client is not of type **Desktop app**, or the id/secret in `.env` do not match it. | Create a Desktop app client (step 5) and copy the id and secret again, with no spaces or quotes. |
| "Google returned no refresh token" | Google already issued one for this client and account and will not repeat it. | Remove the app at myaccount.google.com/permissions, then run `auth` again. |
| "Gmail API has not been used in project ... or it is disabled" (403 `accessNotConfigured`) | The Gmail API is not enabled in the project that owns the client. | Step 3, in the same project as the client. |
| 403 `insufficientPermissions` | The token lacks a scope. | Check Data access has both scopes (step 4), then remove the app at myaccount.google.com/permissions and run `auth` again. |
| 429, or 403 `rateLimitExceeded` / `userRateLimitExceeded` | Gmail's sending quota or rate limit. The tool's own cap (20, then 30 a day) is far below Gmail's, so this usually means the account was used for other sending today. | Nothing to do: the tick puts the row back and stops, and the next tick retries. Lower `daily_cap` if it keeps happening. |
| A send is marked `unknown` | The request may or may not have gone out (timeout, dropped connection). It is never retried automatically. | Look in the Sent folder. If it is there, nothing to do; if not, fix the row from the review screen. |
| `GMAIL_TOKEN_PATH must be outside the repository` | The token path points inside the project folder. | Leave `GMAIL_TOKEN_PATH` unset, or point it at a folder under your home directory. |
| Preview shows a red placeholder instead of your signature | `signature.html` does not exist yet. | Step 8. |
| `test-send` says `--to is the real recipient` | You typed the recipient's address, not yours. | Use your own address. |

Still stuck: set the environment variable `OUTREACH_DEBUG` to `1` (PowerShell: `$env:OUTREACH_DEBUG = '1'`) and run the
command again to print the stack trace, and read the last lines of `logs/tick-*.log`.
