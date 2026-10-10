import { GmailApiError } from './gmail-client';
import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { FakeGmail } from '../testing/fake-gmail';
import { seedDraft } from '../testing/seed';
import { createTempPaths, layoutFor, loadExampleConfig } from '../testing/test-env';

import { runTestSend } from './test-send.service';
import type { TestSendDeps } from './test-send.service';
import { SignatureMissingError } from './signature';

const config = loadExampleConfig();
const OWNER = 'owner@example.org';

async function setup(domains: string[] = ['acme.fr']) {
  const store = new InMemoryOutreachStore();
  const seeded = [];
  for (const domain of domains) seeded.push(await seedDraft(store, domain));
  const gmail = new FakeGmail();
  const layout = layoutFor(createTempPaths());
  const deps: TestSendDeps = {
    store,
    gmail,
    layout,
    config,
    to: OWNER,
    limit: 1,
    loadSignature: () => ({ html: '<div>Jane Doe</div>', text: 'Jane Doe' }),
    readResume: async () => Buffer.from('%PDF-fake'),
    now: () => new Date('2026-10-12T06:30:00Z'),
  };
  return { store, gmail, deps, seeded };
}

describe('runTestSend', () => {
  it('sends the real message to the override address only, with the real recipient named in the subject', async () => {
    const { gmail, deps, seeded } = await setup();

    const report = await runTestSend(deps);

    expect(gmail.sent).toHaveLength(1);
    const raw = gmail.sent[0].raw;
    expect(raw).toContain(`To: ${OWNER}`);
    expect(raw).not.toContain('claire@acme.fr');
    expect(raw).toContain('application/pdf');
    expect(raw).toContain('Jane Doe');
    expect(raw).toMatch(/Subject: (?:=\?UTF-8\?B\?|\[TEST)/);
    expect(report.sent).toEqual([expect.objectContaining({ slug: 'acme-fr', to: OWNER, gmailMessageId: 'gm-1' })]);
    expect(report.sent[0].subject).toBe(`[TEST → claire@acme.fr] ${seeded[0].draft.subject}`);
  });

  it('puts the prefix in the encoded Subject header of the message', async () => {
    const { gmail, deps } = await setup();

    await runTestSend(deps);

    const header = /^Subject:[^\r\n]*(?:\r\n[ \t][^\r\n]*)*/m.exec(gmail.sent[0].raw)?.[0] ?? '';
    const decoded = [...header.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
      .map((match) => Buffer.from(match[1], 'base64').toString('utf-8'))
      .join('');
    expect(decoded).toContain('[TEST → claire@acme.fr] ');
  });

  it('starts a new conversation: no thread, no reply headers', async () => {
    const { gmail, deps } = await setup();

    await runTestSend(deps);

    expect(gmail.sent[0].requestedThreadId).toBeUndefined();
    expect(gmail.sent[0].raw).not.toContain('In-Reply-To');
  });

  it('changes no company, draft or send status and records a test_send event', async () => {
    const { store, deps, seeded } = await setup();

    await runTestSend(deps);

    const { company, draft } = seeded[0];
    expect((await store.getCompany(company.id))?.status).toBe(company.status);
    expect((await store.getDraft(draft.id))?.status).toBe(draft.status);
    expect(await store.listSends()).toEqual([]);
    expect(store.events.filter((event) => event.type === 'test_send')).toEqual([
      { companyId: company.id, type: 'test_send', payload: expect.objectContaining({ draftId: draft.id, to: OWNER, gmailMessageId: 'gm-1' }) },
    ]);
  });

  it('sends at most --limit drafts, in slug order', async () => {
    const { gmail, deps } = await setup(['gamma.io', 'acme.fr', 'beta.de']);

    const report = await runTestSend({ ...deps, limit: 2 });

    expect(report.sent.map((entry) => entry.slug)).toEqual(['acme-fr', 'beta-de']);
    expect(gmail.sent).toHaveLength(2);
  });

  it('narrows to one slug', async () => {
    const { deps } = await setup(['acme.fr', 'beta.de']);

    const report = await runTestSend({ ...deps, slug: 'beta-de' });

    expect(report.sent.map((entry) => entry.slug)).toEqual(['beta-de']);
  });

  it.each([[''], ['not-an-address'], ['two@example.org, three@example.org'], ['x@y']])('refuses the override address %j without sending', async (to) => {
    const { gmail, deps } = await setup();

    await expect(runTestSend({ ...deps, to })).rejects.toThrow(/--to/);
    expect(gmail.sent).toEqual([]);
  });

  it('refuses an override address that is the real recipient of a selected draft', async () => {
    const { gmail, deps } = await setup();

    await expect(runTestSend({ ...deps, to: 'Claire@Acme.fr' })).rejects.toThrow(/real recipient/);
    expect(gmail.sent).toEqual([]);
  });

  it('refuses to send without a cached signature', async () => {
    const { gmail, deps } = await setup();

    await expect(
      runTestSend({
        ...deps,
        loadSignature: () => {
          throw new SignatureMissingError('No signature');
        },
      }),
    ).rejects.toThrow(SignatureMissingError);
    expect(gmail.sent).toEqual([]);
  });

  it('stops at the first Gmail failure and reports it, without recording an event for it', async () => {
    const { store, gmail, deps } = await setup(['acme.fr', 'beta.de']);
    gmail.sendErrors = [new GmailApiError('Gmail API 403: denied', 403, 'forbidden')];

    const report = await runTestSend({ ...deps, limit: 2 });

    expect(report.sent).toEqual([]);
    expect(report.failed).toEqual([{ slug: 'acme-fr', reason: 'Gmail API 403: denied' }]);
    expect(gmail.sent).toEqual([]);
    expect(store.events.filter((event) => event.type === 'test_send')).toEqual([]);
  });

  it('checks the mailbox token before it builds anything', async () => {
    const { gmail, deps } = await setup();
    gmail.accessErrors = [new Error('token endpoint down')];

    await expect(runTestSend(deps)).rejects.toThrow('token endpoint down');
    expect(gmail.sent).toEqual([]);
  });
});
