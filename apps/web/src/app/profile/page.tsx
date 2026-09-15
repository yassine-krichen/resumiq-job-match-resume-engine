'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';
import { AddAchievementModal } from './_components/add-achievement-modal';
import { AddCertificationModal } from './_components/add-certification-modal';
import { AddEducationModal } from './_components/add-education-modal';
import { AddExperienceModal } from './_components/add-experience-modal';
import { AddProjectModal } from './_components/add-project-modal';
import { ImportExportPanel } from './_components/import-export-panel';
import { useProfileSection } from './_components/use-profile-section';
import { PageHeader } from '@/components/page-header';
import { ThemeToggle } from '@/components/theme-toggle';

// Presence/count-based strength — not a backend score, just a rough visual
// nudge toward "this section could use more entries." Target counts are
// arbitrary reasonable-fill thresholds, not derived from any scoring model.
const STRENGTH_TARGETS = {
  experience: 3,
  projects: 2,
  education: 1,
  skills: 5,
  certifications: 1,
} as const;

function strengthPercent(count: number, target: number): number {
  return Math.min(100, Math.round((count / target) * 100));
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MasterDB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const experienceSection = useProfileSection(profile, setProfile, 'experience');
  const projectsSection = useProfileSection(profile, setProfile, 'projects');
  const educationSection = useProfileSection(profile, setProfile, 'education');
  const certificationsSection = useProfileSection(profile, setProfile, 'certifications');
  const awardsSection = useProfileSection(profile, setProfile, 'awards_and_honors');

  // Fetch once on mount only. `router` from next/navigation isn't a value
  // this effect should react to — including it here re-fires the fetch (and
  // wipes out any section update above) whenever the router identity
  // changes, e.g. right after `setProfile` triggers a re-render.
  useEffect(() => {
    apiFetch<MasterDB>('/profile')
      .then(setProfile)
      .catch((e: Error) => {
        if (e.message.includes('404')) {
          router.replace('/onboarding');
        } else {
          setError(e.message);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  const experience = profile?.experience ?? [];
  const projects = profile?.projects ?? [];
  const education = profile?.education ?? [];
  const certifications = profile?.certifications ?? [];
  const awards = profile?.awards_and_honors ?? [];

  const expCount = experience.length;
  const projCount = projects.length;
  const eduCount = education.length;
  const skillCount = (profile?.skills?.programming_languages?.length ?? 0)
    + (profile?.skills?.frameworks_and_libraries?.length ?? 0);
  const certCount = certifications.length;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Career Profile"
        actions={
          <>
            <ThemeToggle />
            <button
              onClick={() => router.push('/onboarding')}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              + Add entry
            </button>
          </>
        }
      />

      <main className="mx-auto max-w-4xl px-6 py-10">
        {profile && <ImportExportPanel profile={profile} onImported={setProfile} />}

        {/* Summary stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Roles', value: expCount },
            { label: 'Projects', value: projCount },
            { label: 'Degrees', value: eduCount },
            { label: 'Skills', value: skillCount },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-5 text-center shadow-sm">
              <p className="text-3xl font-bold">{value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Section strength */}
        <div className="mb-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Profile strength</h2>
          <div className="space-y-3">
            <StrengthBar label="Experience" count={expCount} target={STRENGTH_TARGETS.experience} />
            <StrengthBar label="Projects" count={projCount} target={STRENGTH_TARGETS.projects} />
            <StrengthBar label="Education" count={eduCount} target={STRENGTH_TARGETS.education} />
            <StrengthBar label="Skills" count={skillCount} target={STRENGTH_TARGETS.skills} />
            <StrengthBar
              label="Certifications"
              count={certCount}
              target={STRENGTH_TARGETS.certifications}
            />
          </div>
        </div>

        {/* Experience */}
        <ProfileSection
          title="Experience"
          action={<AddExperienceModal onAdd={experienceSection.addEntry} submitting={experienceSection.saving} />}
          error={experienceSection.error}
        >
          {expCount === 0 ? (
            <p className="text-sm text-muted-foreground">No experience added yet.</p>
          ) : (
            experience.map((exp, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{exp.role}</p>
                    <p className="text-sm text-muted-foreground">{exp.company} · {exp.location}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-3">
                    <p className="text-sm text-muted-foreground">
                      {exp.startDate} – {exp.isCurrent ? 'Present' : exp.endDate}
                    </p>
                    <AddExperienceModal
                      entry={exp}
                      submitting={experienceSection.saving}
                      onAdd={(updated) => experienceSection.updateEntry(i, updated)}
                      onDelete={() => experienceSection.removeEntry(i)}
                    />
                  </div>
                </div>
                {exp.technologies_used?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {exp.technologies_used.slice(0, 8).map((t) => (
                      <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </ProfileSection>

        {/* Projects */}
        <ProfileSection
          title="Projects"
          action={<AddProjectModal onAdd={projectsSection.addEntry} submitting={projectsSection.saving} />}
          error={projectsSection.error}
        >
          {projCount === 0 ? (
            <p className="text-sm text-muted-foreground">No projects added yet.</p>
          ) : (
            projects.map((proj, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{proj.name}</p>
                    <p className="text-sm text-muted-foreground">{proj.context}</p>
                  </div>
                  <AddProjectModal
                    entry={proj}
                    submitting={projectsSection.saving}
                    onAdd={(updated) => projectsSection.updateEntry(i, updated)}
                    onDelete={() => projectsSection.removeEntry(i)}
                  />
                </div>
                {proj.technologies_used?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {proj.technologies_used.slice(0, 8).map((t) => (
                      <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </ProfileSection>

        {/* Education */}
        <ProfileSection
          title="Education"
          action={<AddEducationModal onAdd={educationSection.addEntry} submitting={educationSection.saving} />}
          error={educationSection.error}
        >
          {eduCount === 0 ? (
            <p className="text-sm text-muted-foreground">No education added yet.</p>
          ) : (
            education.map((edu, i) => (
              <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">{edu.degree_type} in {edu.major}</p>
                  <p className="text-sm text-muted-foreground">{edu.institution}</p>
                  <p className="text-sm text-muted-foreground">{edu.startDate} – {edu.endDate}</p>
                </div>
                <AddEducationModal
                  entry={edu}
                  submitting={educationSection.saving}
                  onAdd={(updated) => educationSection.updateEntry(i, updated)}
                  onDelete={() => educationSection.removeEntry(i)}
                />
              </div>
            ))
          )}
        </ProfileSection>

        {/* Certifications */}
        <ProfileSection
          title="Certifications"
          action={
            <AddCertificationModal
              onAdd={certificationsSection.addEntry}
              submitting={certificationsSection.saving}
            />
          }
          error={certificationsSection.error}
        >
          {certCount === 0 ? (
            <p className="text-sm text-muted-foreground">No certifications added yet.</p>
          ) : (
            certifications.map((cert, i) => (
              <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">{cert.name}</p>
                  <p className="text-sm text-muted-foreground">{cert.issuer}</p>
                  {cert.date && <p className="text-sm text-muted-foreground">{cert.date}</p>}
                </div>
                <AddCertificationModal
                  entry={cert}
                  submitting={certificationsSection.saving}
                  onAdd={(updated) => certificationsSection.updateEntry(i, updated)}
                  onDelete={() => certificationsSection.removeEntry(i)}
                />
              </div>
            ))
          )}
        </ProfileSection>

        {/* Awards & achievements */}
        <ProfileSection
          title="Awards & achievements"
          action={<AddAchievementModal onAdd={awardsSection.addEntry} submitting={awardsSection.saving} />}
          error={awardsSection.error}
        >
          {awards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No achievements added yet.</p>
          ) : (
            awards.map((award, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{award.title}</p>
                  <div className="flex shrink-0 items-start gap-3">
                    {award.date && <p className="text-sm text-muted-foreground">{award.date}</p>}
                    <AddAchievementModal
                      entry={award}
                      submitting={awardsSection.saving}
                      onAdd={(updated) => awardsSection.updateEntry(i, updated)}
                      onDelete={() => awardsSection.removeEntry(i)}
                    />
                  </div>
                </div>
                {award.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{award.description}</p>
                )}
                {(award.related_skills?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {award.related_skills!.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </ProfileSection>

      </main>
    </div>
  );
}

function ProfileSection({
  title,
  action,
  error,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function StrengthBar({
  label,
  count,
  target,
}: {
  label: string;
  count: number;
  target: number;
}) {
  const percent = strengthPercent(count, target);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${percent >= 100 ? 'bg-emerald-500' : 'bg-muted-foreground'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
