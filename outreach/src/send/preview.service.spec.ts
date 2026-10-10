import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InMemoryOutreachStore } from '../testing/in-memory-store';
import { seedDraft } from '../testing/seed';
import { createTempPaths, layoutFor, loadExampleConfig } from '../testing/test-env';

import { listReviewableDrafts } from './review-drafts';
import { PLACEHOLDER_SIGNATURE_TEXT, formatPreview, previewRun } from './preview.service';
import { SignatureMissingError } from './signature';

const config = loadExampleConfig();
const SIGNATURE = { html: '<div>Jane Doe<br>Student</div>', text: 'Jane Doe\nStudent' };

async function setup() {
  const store = new InMemoryOutreachStore();
  const paths = createTempPaths();
  const layout = layoutFor(paths);
  return { store, paths, layout };
}

function deps(
  context: Awaited<ReturnType<typeof setup>>,
  overrides: Partial<Parameters<typeof previewRun>[0]> = {},
): Parameters<typeof previewRun>[0] {
  return {
    store: context.store,
    layout: context.layout,
    config,
    loadSignature: () => SIGNATURE,
    readResume: async () => Buffer.from('%PDF-fake'),
    now: () => new Date('2026-10-12T06:30:00Z'),
    ...overrides,
  };
}

describe('listReviewableDrafts', () => {
  it('lists drafts awaiting review or approved, with their contact, and leaves out the rest', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');
    const approved = await seedDraft(context.store, 'beta.de', { decision: 'approved' });
    const killed = await seedDraft(context.store, 'gamma.io');
    await context.store.reviewDraft(killed.company.id, killed.draft.id, 'killed');

    const { items } = await listReviewableDrafts(context.store, 'run-1');

    expect(items.map((item) => item.company.slug)).toEqual(['acme-fr', 'beta-de']);
    expect(items[1].draft.status).toBe(approved.draft.status);
    expect(items[0].contact.email).toBe('claire@acme.fr');
  });

  it('narrows to one slug and fails loudly when that slug has nothing to preview', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');
    await seedDraft(context.store, 'beta.de');

    expect((await listReviewableDrafts(context.store, 'run-1', 'beta-de')).items.map((item) => item.company.slug)).toEqual(['beta-de']);
    await expect(listReviewableDrafts(context.store, 'run-1', 'nope-fr')).rejects.toThrow(/nope-fr/);
  });
});

describe('previewRun', () => {
  it('writes the initial and the follow-up message of every draft under storage/<run>/<slug>/', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');

    const report = await previewRun(deps(context));

    const dir = context.layout.storageDir('acme-fr');
    expect(report.items).toEqual([
      expect.objectContaining({
        slug: 'acme-fr',
        initial: 'storage/run-1/acme-fr/initial.eml',
        followUp: 'storage/run-1/acme-fr/follow-up.eml',
        errors: [],
      }),
    ]);
    const initial = readFileSync(join(dir, 'initial.eml'), 'utf-8');
    expect(initial).toContain('To: "Claire Martin" <claire@acme.fr>');
    expect(initial).toContain('application/pdf');
    expect(initial).toContain('Jane Doe');
    expect(initial).not.toContain('In-Reply-To');
    const followUp = readFileSync(join(dir, 'follow-up.eml'), 'utf-8');
    expect(followUp).toContain('Subject: Re: ');
    expect(followUp).toContain('In-Reply-To: <preview-initial@preview.invalid>');
    expect(followUp).not.toContain('application/pdf');
  });

  it('uses the mailbox signature when signature.html exists', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');

    const report = await previewRun(deps(context));

    expect(report.placeholderSignature).toBe(false);
    expect(readFileSync(join(context.layout.storageDir('acme-fr'), 'initial.eml'), 'utf-8')).not.toContain('PREVIEW ONLY');
  });

  it('marks a placeholder signature visibly when none is cached, in the preview only', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');

    const report = await previewRun(
      deps(context, {
        loadSignature: () => {
          throw new SignatureMissingError('No signature');
        },
      }),
    );

    expect(report.placeholderSignature).toBe(true);
    expect(readFileSync(join(context.layout.storageDir('acme-fr'), 'initial.eml'), 'utf-8')).toContain('PREVIEW ONLY');
    expect(PLACEHOLDER_SIGNATURE_TEXT).toContain('npm run outreach -- signature');
  });

  it('does not hide a signature problem other than a missing one', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');

    await expect(
      previewRun(
        deps(context, {
          loadSignature: () => {
            throw new Error('disk on fire');
          },
        }),
      ),
    ).rejects.toThrow('disk on fire');
  });

  it('still writes the follow-up when the resume file is missing and reports why the initial is missing', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');

    const report = await previewRun(
      deps(context, {
        readResume: async () => {
          throw new Error('Resume file not found: storage/tracks/ai.pdf');
        },
      }),
    );

    expect(report.items[0].initial).toBeNull();
    expect(report.items[0].followUp).toBe('storage/run-1/acme-fr/follow-up.eml');
    expect(report.items[0].errors).toEqual([expect.stringContaining('Resume file not found')]);
    expect(existsSync(join(context.layout.storageDir('acme-fr'), 'initial.eml'))).toBe(false);
  });

  it('changes nothing in the store', async () => {
    const context = await setup();
    const { company, draft } = await seedDraft(context.store, 'acme.fr');

    await previewRun(deps(context));

    expect((await context.store.getCompany(company.id))?.status).toBe(company.status);
    expect((await context.store.getDraft(draft.id))?.status).toBe(draft.status);
    expect(await context.store.listSends()).toEqual([]);
    expect(context.store.events.map((event) => event.type)).not.toContain('test_send');
  });

  it('previews only the requested slug', async () => {
    const context = await setup();
    await seedDraft(context.store, 'acme.fr');
    await seedDraft(context.store, 'beta.de');

    const report = await previewRun(deps(context, { slug: 'beta-de' }));

    expect(report.items.map((item) => item.slug)).toEqual(['beta-de']);
    expect(existsSync(join(context.layout.storageDir('acme-fr'), 'initial.eml'))).toBe(false);
  });
});

describe('formatPreview', () => {
  it('lists the files per company and warns about a placeholder signature', () => {
    const text = formatPreview({
      runId: 'run-1',
      placeholderSignature: true,
      items: [
        { slug: 'acme-fr', company: 'Acme', to: 'claire@acme.fr', initial: 'storage/run-1/acme-fr/initial.eml', followUp: 'storage/run-1/acme-fr/follow-up.eml', errors: [] },
        { slug: 'beta-de', company: 'Beta', to: 'a@beta.de', initial: null, followUp: 'storage/run-1/beta-de/follow-up.eml', errors: ['initial: Resume file not found'] },
      ],
    });

    expect(text).toContain('storage/run-1/acme-fr/initial.eml');
    expect(text).toContain('storage/run-1/beta-de/follow-up.eml');
    expect(text).toContain('not written, initial: Resume file not found');
    expect(text).toContain('placeholder');
  });

  it('says so when there is nothing to preview', () => {
    expect(formatPreview({ runId: 'run-1', placeholderSignature: false, items: [] })).toContain('Nothing to preview');
  });
});
