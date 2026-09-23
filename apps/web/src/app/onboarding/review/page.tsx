'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import {
  IngestEntrySchema,
  type IngestDraftEntryDto,
  type IngestEntryDto,
  type MasterDB,
} from '@resumiq/schemas';
import { PageHeader } from '@/components/page-header';
import { AddAchievementModal } from '@/app/profile/_components/add-achievement-modal';
import { AddCertificationModal } from '@/app/profile/_components/add-certification-modal';
import { AddEducationModal } from '@/app/profile/_components/add-education-modal';
import { AddExperienceModal } from '@/app/profile/_components/add-experience-modal';
import { AddProjectModal } from '@/app/profile/_components/add-project-modal';
import { clearPendingEntries, loadPendingEntries, savePendingEntries } from '../_lib/pending-entries';

// Concrete per-type field shapes come from `IngestEntryDto` (the strict
// schema's inferred type), not `IngestDraftEntryDto` — a draft's `entry` is
// `unknown` at the type level since it may be missing required fields.
type ExperienceEntry = Extract<IngestEntryDto, { type: 'experience' }>['entry'];
type ProjectEntry = Extract<IngestEntryDto, { type: 'project' }>['entry'];
type EducationEntry = Extract<IngestEntryDto, { type: 'education' }>['entry'];
type CertificationEntry = Extract<IngestEntryDto, { type: 'certification' }>['entry'];
type AwardEntry = Extract<IngestEntryDto, { type: 'award' }>['entry'];
type SkillsEntry = {
  programming_languages?: string[];
  frameworks_and_libraries?: string[];
  infrastructure_and_tools?: string[];
  databases?: string[];
  soft_skills?: string[];
};
type SummaryEntry = { target_role?: string; content?: string };
type PublicationEntry = { title?: string; venue?: string; date?: string; url?: string; description?: string };
type VolunteeringEntry = {
  organization?: string;
  role?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
};

/** Pairs a draft entry with its position in the flat `entries` array, so
 * editing or removing an item within a type-grouped section updates the
 * right slot. */
type IndexedEntry = {
  index: number;
  entry: unknown;
  missingFields: string[];
};

function entriesOfType(entries: IngestDraftEntryDto[], type: IngestDraftEntryDto['type']): IndexedEntry[] {
  const result: IndexedEntry[] = [];
  entries.forEach((e, index) => {
    if (e.type === type) {
      result.push({ index, entry: e.entry, missingFields: e.missingFields });
    }
  });
  return result;
}

/**
 * Recomputes completeness against the STRICT per-type schema — never trust
 * the `missingFields` a draft arrived with once the user has edited it, since
 * the edit may have fixed (or newly broken) a field. Returns `[]` when the
 * entry now fully validates.
 */
function recomputeMissingFields(type: IngestDraftEntryDto['type'], entryValue: unknown): string[] {
  const result = IngestEntrySchema.safeParse({ type, entry: entryValue });
  if (result.success) return [];
  if (type === 'interest') return ['value'];
  return Array.from(
    new Set(
      result.error.issues
        .map((issue) => String(issue.path[1] ?? issue.path[0] ?? ''))
        .filter(Boolean),
    ),
  );
}

export default function OnboardingReviewPage() {
  const router = useRouter();
  // `undefined` = not yet loaded from sessionStorage, `null` = nothing pending.
  const [entries, setEntries] = useState<IngestDraftEntryDto[] | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // sessionStorage is only available client-side, and this route is
  // server-rendered, so the read can't happen during the initial render (a
  // `useState(() => loadPendingEntries())` lazy initializer would either
  // throw on the server or, worse, read real data during client hydration
  // while the server-rendered markup shows the `undefined` "Loading..."
  // state — a hydration mismatch). Deferring to an effect with an empty dep
  // array keeps the first client render identical to the server render,
  // then swaps in the real value once mounted. This is a one-shot mount
  // hydration, not an ongoing sync back to an external store (edits/removes
  // below intentionally diverge `entries` from sessionStorage until
  // confirm), so it isn't a fit for useSyncExternalStore either.
  useEffect(() => {
    const pending = loadPendingEntries();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(pending && pending.length > 0 ? pending : null);
  }, []);

  function replaceEntryAt(index: number, entryValue: unknown): Promise<void> {
    setEntries((prev) => {
      const next = (prev ?? []).map((e, i) =>
        i === index ? { ...e, entry: entryValue, missingFields: recomputeMissingFields(e.type, entryValue) } : e,
      );
      // Keep the sessionStorage snapshot in sync with every edit — otherwise
      // a refresh before "Save to profile" re-reads the original, unedited
      // parse and silently discards the user's changes.
      savePendingEntries(next);
      return next;
    });
    return Promise.resolve();
  }

  function removeEntryAt(index: number): Promise<void> {
    setEntries((prev) => {
      const next = (prev ?? []).filter((_, i) => i !== index);
      savePendingEntries(next);
      return next;
    });
    return Promise.resolve();
  }

  async function handleConfirm() {
    if (!entries) return;
    const completeEntries = entries.filter((e) => e.missingFields.length === 0);
    if (completeEntries.length === 0) return;

    setSaving(true);
    setError('');
    try {
      await apiFetch<MasterDB>('/onboarding/ingest/confirm', {
        method: 'POST',
        body: JSON.stringify({
          entries: completeEntries.map(({ type, entry }) => ({ type, entry })),
        }),
      });
      const remaining = entries.filter((e) => e.missingFields.length > 0);
      if (remaining.length === 0) {
        clearPendingEntries();
        router.push('/profile');
      } else {
        // Some entries are still incomplete — keep them pending so the user
        // can come back and finish them rather than silently losing them.
        savePendingEntries(remaining);
        setEntries(remaining);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (entries === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (entries === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Nothing to review — paste some career text first.</p>
        <button
          onClick={() => router.push('/onboarding')}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to paste
        </button>
      </div>
    );
  }

  const experience = entriesOfType(entries, 'experience');
  const projects = entriesOfType(entries, 'project');
  const education = entriesOfType(entries, 'education');
  const certifications = entriesOfType(entries, 'certification');
  const awards = entriesOfType(entries, 'award');
  const skills = entriesOfType(entries, 'skills');
  const summaries = entriesOfType(entries, 'summary');
  const publications = entriesOfType(entries, 'publication');
  const volunteering = entriesOfType(entries, 'volunteering');
  const interests = entriesOfType(entries, 'interest');

  const incompleteCount = entries.filter((e) => e.missingFields.length > 0).length;
  const completeCount = entries.length - incompleteCount;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Review before saving"
        containerClassName="mx-auto flex max-w-3xl items-center justify-between"
        actions={
          <button
            onClick={() => router.push('/onboarding')}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Add more
          </button>
        }
      />

      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="mb-8 text-muted-foreground">
          Nothing is saved yet. Edit or remove anything that&apos;s wrong, then confirm to write
          these into your profile.
        </p>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {incompleteCount > 0 && (
          <div className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700">
            {incompleteCount} incomplete entr{incompleteCount === 1 ? 'y' : 'ies'} won&apos;t be
            added — complete the marked fields to include{' '}
            {incompleteCount === 1 ? 'it' : 'them'}.
          </div>
        )}

        <div className="space-y-4">
          {experience.length > 0 && (
            <Section title="Experience" count={experience.length}>
              {experience.map(({ entry, index, missingFields }) => {
                const exp = entry as Partial<ExperienceEntry>;
                return (
                  <ReviewRow
                    key={index}
                    title={exp.role || exp.company ? `${exp.role ?? '(missing role)'} @ ${exp.company ?? '(missing company)'}` : 'New experience'}
                    missingFields={missingFields}
                  >
                    <AddExperienceModal
                      entry={exp}
                      submitting={saving}
                      onAdd={(updated) => replaceEntryAt(index, updated)}
                      onDelete={() => removeEntryAt(index)}
                    />
                  </ReviewRow>
                );
              })}
            </Section>
          )}

          {projects.length > 0 && (
            <Section title="Projects" count={projects.length}>
              {projects.map(({ entry, index, missingFields }) => {
                const proj = entry as Partial<ProjectEntry>;
                return (
                  <ReviewRow key={index} title={proj.name || 'New project'} missingFields={missingFields}>
                    <AddProjectModal
                      entry={proj}
                      submitting={saving}
                      onAdd={(updated) => replaceEntryAt(index, updated)}
                      onDelete={() => removeEntryAt(index)}
                    />
                  </ReviewRow>
                );
              })}
            </Section>
          )}

          {education.length > 0 && (
            <Section title="Education" count={education.length}>
              {education.map(({ entry, index, missingFields }) => {
                const edu = entry as Partial<EducationEntry>;
                return (
                  <ReviewRow
                    key={index}
                    title={edu.degree_type ? `${edu.degree_type} in ${edu.major ?? '(missing major)'}` : edu.major ?? 'New education'}
                    subtitle={edu.institution}
                    missingFields={missingFields}
                  >
                    <AddEducationModal
                      entry={edu}
                      submitting={saving}
                      onAdd={(updated) => replaceEntryAt(index, updated)}
                      onDelete={() => removeEntryAt(index)}
                    />
                  </ReviewRow>
                );
              })}
            </Section>
          )}

          {certifications.length > 0 && (
            <Section title="Certifications" count={certifications.length}>
              {certifications.map(({ entry, index, missingFields }) => {
                const cert = entry as Partial<CertificationEntry>;
                return (
                  <ReviewRow key={index} title={cert.name || 'New certification'} subtitle={cert.issuer} missingFields={missingFields}>
                    <AddCertificationModal
                      entry={cert}
                      submitting={saving}
                      onAdd={(updated) => replaceEntryAt(index, updated)}
                      onDelete={() => removeEntryAt(index)}
                    />
                  </ReviewRow>
                );
              })}
            </Section>
          )}

          {awards.length > 0 && (
            <Section title="Awards" count={awards.length}>
              {awards.map(({ entry, index, missingFields }) => {
                const award = entry as Partial<AwardEntry>;
                return (
                  <ReviewRow key={index} title={award.title || 'New award'} subtitle={award.issuer} missingFields={missingFields}>
                    <AddAchievementModal
                      entry={award}
                      submitting={saving}
                      onAdd={(updated) => replaceEntryAt(index, updated)}
                      onDelete={() => removeEntryAt(index)}
                    />
                  </ReviewRow>
                );
              })}
            </Section>
          )}

          {/* Skills/summary/publication/volunteering/interest don't have a
           * manual-CRUD modal in the profile page yet (Phase 3a only built
           * modals for array sections with an edit UI need — see
           * use-profile-section.ts's ArraySectionKey). These render
           * view + remove only, no inline edit — an incomplete entry of one
           * of these types can only be removed, not fixed, from this page. */}
          {skills.length > 0 && (
            <Section title="Skills" count={skills.length}>
              {skills.map(({ entry, index, missingFields }) => (
                <PlainReviewCard key={index} onRemove={() => removeEntryAt(index)} missingFields={missingFields}>
                  <SkillsSummary skills={entry as SkillsEntry} />
                </PlainReviewCard>
              ))}
            </Section>
          )}

          {summaries.length > 0 && (
            <Section title="Summaries" count={summaries.length}>
              {summaries.map(({ entry, index, missingFields }) => {
                const summary = entry as SummaryEntry;
                return (
                  <PlainReviewCard key={index} onRemove={() => removeEntryAt(index)} missingFields={missingFields}>
                    <p className="font-medium">{summary.target_role}</p>
                    <p className="mt-1 text-sm text-foreground">{summary.content}</p>
                  </PlainReviewCard>
                );
              })}
            </Section>
          )}

          {publications.length > 0 && (
            <Section title="Publications & speaking" count={publications.length}>
              {publications.map(({ entry, index, missingFields }) => {
                const pub = entry as PublicationEntry;
                return (
                  <PlainReviewCard key={index} onRemove={() => removeEntryAt(index)} missingFields={missingFields}>
                    <p className="font-medium">{pub.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {[pub.venue, pub.date].filter(Boolean).join(' · ')}
                    </p>
                    {pub.url && (
                      <p className="mt-1 text-sm text-foreground">
                        <span className="font-medium">URL: </span>
                        {pub.url}
                      </p>
                    )}
                    {pub.description && (
                      <p className="mt-1 text-sm text-foreground">{pub.description}</p>
                    )}
                  </PlainReviewCard>
                );
              })}
            </Section>
          )}

          {volunteering.length > 0 && (
            <Section title="Volunteering & leadership" count={volunteering.length}>
              {volunteering.map(({ entry, index, missingFields }) => {
                const vol = entry as VolunteeringEntry;
                return (
                  <PlainReviewCard key={index} onRemove={() => removeEntryAt(index)} missingFields={missingFields}>
                    <p className="font-medium">{vol.role} @ {vol.organization}</p>
                    <p className="text-sm text-muted-foreground">
                      {vol.startDate} – {vol.isCurrent ? 'Present' : (vol.endDate ?? '')}
                    </p>
                    {vol.location && (
                      <p className="mt-1 text-sm text-muted-foreground">{vol.location}</p>
                    )}
                    {vol.description && (
                      <p className="mt-1 text-sm text-foreground">{vol.description}</p>
                    )}
                  </PlainReviewCard>
                );
              })}
            </Section>
          )}

          {interests.length > 0 && (
            <Section title="Interests" count={interests.length}>
              {interests.map(({ entry, index, missingFields }) => (
                <PlainReviewCard key={index} onRemove={() => removeEntryAt(index)} missingFields={missingFields}>
                  <p className="text-sm text-foreground">{(entry as string) || '(no value)'}</p>
                </PlainReviewCard>
              ))}
            </Section>
          )}
        </div>

        <div className="mt-8 flex items-center justify-end gap-3">
          {incompleteCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {completeCount} of {entries.length} ready to save
            </p>
          )}
          <button
            onClick={handleConfirm}
            disabled={saving || completeCount === 0}
            title={completeCount === 0 ? 'Complete at least one entry before saving' : undefined}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save to profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
          {count}
        </span>
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function IncompleteBadge({ missingFields }: { missingFields: string[] }) {
  if (missingFields.length === 0) return null;
  return (
    <p className="mt-1 text-xs font-medium text-amber-700">
      Incomplete — fill in: {missingFields.join(', ')}
    </p>
  );
}

function ReviewRow({
  title,
  subtitle,
  missingFields,
  children,
}: {
  title: string;
  subtitle?: string;
  missingFields: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted p-4">
      <div>
        <p className="font-medium">{title}</p>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        <IncompleteBadge missingFields={missingFields} />
      </div>
      {children}
    </div>
  );
}

function PlainReviewCard({
  onRemove,
  missingFields,
  children,
}: {
  onRemove: () => void;
  missingFields: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted p-4">
      <div className="flex-1">
        {children}
        <IncompleteBadge missingFields={missingFields} />
      </div>
      <button
        onClick={onRemove}
        className="shrink-0 text-sm text-muted-foreground hover:text-red-600"
      >
        Remove
      </button>
    </div>
  );
}

function SkillsSummary({ skills }: { skills: SkillsEntry }) {
  return (
    <>
      {(skills.programming_languages?.length ?? 0) > 0 && (
        <p className="text-sm text-foreground">
          <span className="font-medium">Languages: </span>
          {skills.programming_languages!.join(', ')}
        </p>
      )}
      {(skills.frameworks_and_libraries?.length ?? 0) > 0 && (
        <p className="mt-1 text-sm text-foreground">
          <span className="font-medium">Frameworks: </span>
          {skills.frameworks_and_libraries!.join(', ')}
        </p>
      )}
      {(skills.infrastructure_and_tools?.length ?? 0) > 0 && (
        <p className="mt-1 text-sm text-foreground">
          <span className="font-medium">Infrastructure & tools: </span>
          {skills.infrastructure_and_tools!.join(', ')}
        </p>
      )}
      {(skills.databases?.length ?? 0) > 0 && (
        <p className="mt-1 text-sm text-foreground">
          <span className="font-medium">Databases: </span>
          {skills.databases!.join(', ')}
        </p>
      )}
      {(skills.soft_skills?.length ?? 0) > 0 && (
        <p className="mt-1 text-sm text-foreground">
          <span className="font-medium">Soft skills: </span>
          {skills.soft_skills!.join(', ')}
        </p>
      )}
    </>
  );
}
