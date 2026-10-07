import type { CompanyRecord, DraftRecord } from '../db/outreach-store';
import { OutreachDossierSchema } from '../schemas/outreach';

import { dossierFor, WRITER_DRAFT } from './test-env';
import type { InMemoryOutreachStore } from './in-memory-store';

export interface SeedOptions {
  name?: string;
  timezone?: string;
  country?: string;
  language?: 'en' | 'fr';
  generic?: boolean;
  /** `awaiting_review` (default) leaves the draft for the reviewer; `approved` is the state the tick picks up. */
  decision?: 'awaiting_review' | 'approved';
  contactEmail?: string;
  subject?: string;
  /** Verified claim the follow-up cites, as the writer may set it. */
  followUpClaimId?: string | null;
}

/** One company with a dossier and a draft, in the state the review UI or the tick starts from. */
export async function seedDraft(
  store: InMemoryOutreachStore,
  domain: string,
  options: SeedOptions = {},
): Promise<{ company: CompanyRecord; draft: DraftRecord }> {
  const inserted = await store.insertCompany({
    runId: 'run-1',
    slug: domain.replace(/\./g, '-'),
    name: options.name ?? 'Acme Robotics',
    domain,
    domainKey: domain,
    website: `https://${domain}`,
    contact: {
      email: options.contactEmail ?? `claire@${domain}`,
      name: 'Claire Martin',
      role: null,
      roleAccount: false,
      mxStatus: 'ok',
    },
  });
  const dossier = OutreachDossierSchema.parse(
    dossierFor('snapshot.txt', {
      timezone: options.timezone ?? 'Europe/Paris',
      country: options.country ?? 'FR',
      language: options.language ?? 'en',
    }),
  );
  await store.storeDossier(
    inserted.id,
    { data: dossier, rejectedClaims: [], verifiedClaimCount: dossier.claims.length },
    { status: 'dossier_ready', statusReason: null, track: 'ai' },
  );
  const draft = await store.storeDraft(inserted.id, {
    generic: options.generic ?? false,
    language: options.language ?? 'en',
    subject: options.subject ?? WRITER_DRAFT.subject,
    body: WRITER_DRAFT.body,
    followUpBody: WRITER_DRAFT.follow_up_body,
    cta: WRITER_DRAFT.cta,
    hookClaimId: options.generic ? null : WRITER_DRAFT.hook_claim_id,
    followUpClaimId: options.followUpClaimId ?? null,
    anchorPhrase: options.generic ? null : WRITER_DRAFT.anchor_phrase,
    mentionedProjects: WRITER_DRAFT.mentioned_projects,
    tailoring: null,
    resumeKind: 'track',
    track: 'ai',
    resumePdfPath: 'storage/tracks/ai.pdf',
  });
  if ((options.decision ?? 'awaiting_review') === 'approved') {
    await store.reviewDraft(inserted.id, draft.id, 'approved');
  }
  const company = await store.getCompany(inserted.id);
  const latest = await store.getDraft(draft.id);
  if (!company || !latest) throw new Error('seed failed');
  return { company, draft: latest };
}
