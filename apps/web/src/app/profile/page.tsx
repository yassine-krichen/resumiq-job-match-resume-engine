'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';
import { AddAchievementModal, type NewAchievement } from './_components/add-achievement-modal';
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
  const [savingAchievement, setSavingAchievement] = useState(false);
  const [achievementError, setAchievementError] = useState('');

  // Fetch once on mount only. `router` from next/navigation isn't a value
  // this effect should react to — including it here re-fires the fetch (and
  // wipes out the achievement update above) whenever the router identity
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

  async function handleAddAchievement(achievement: NewAchievement): Promise<void> {
    if (!profile) return;
    setSavingAchievement(true);
    setAchievementError('');
    try {
      const updated = await apiFetch<MasterDB>('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          awards_and_honors: [...profile.awards_and_honors, achievement],
        }),
      });
      setProfile(updated);
    } catch (e) {
      setAchievementError((e as Error).message);
      // Re-thrown so the modal itself knows the save failed and can keep
      // the dialog open with the entered data intact instead of clearing it.
      throw e;
    } finally {
      setSavingAchievement(false);
    }
  }

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

  const expCount = profile?.experience?.length ?? 0;
  const projCount = profile?.projects?.length ?? 0;
  const eduCount = profile?.education?.length ?? 0;
  const skillCount = (profile?.skills?.programming_languages?.length ?? 0)
    + (profile?.skills?.frameworks_and_libraries?.length ?? 0);
  const certCount = profile?.certifications?.length ?? 0;
  const awards = profile?.awards_and_honors ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <button onClick={() => router.back()} className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </button>
          <h1 className="text-base font-semibold">Career Profile</h1>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => router.push('/onboarding')}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              + Add entry
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
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
        {expCount > 0 && (
          <ProfileSection title="Experience">
            {profile!.experience.map((exp, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{exp.role}</p>
                    <p className="text-sm text-muted-foreground">{exp.company} · {exp.location}</p>
                  </div>
                  <p className="shrink-0 text-sm text-muted-foreground">
                    {exp.startDate} – {exp.isCurrent ? 'Present' : exp.endDate}
                  </p>
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
            ))}
          </ProfileSection>
        )}

        {/* Projects */}
        {projCount > 0 && (
          <ProfileSection title="Projects">
            {profile!.projects.map((proj, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <p className="font-medium">{proj.name}</p>
                <p className="text-sm text-muted-foreground">{proj.context}</p>
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
            ))}
          </ProfileSection>
        )}

        {/* Education */}
        {eduCount > 0 && (
          <ProfileSection title="Education">
            {profile!.education.map((edu, i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <p className="font-medium">{edu.degree_type} in {edu.major}</p>
                <p className="text-sm text-muted-foreground">{edu.institution}</p>
                <p className="text-sm text-muted-foreground">{edu.startDate} – {edu.endDate}</p>
              </div>
            ))}
          </ProfileSection>
        )}

        {/* Awards & achievements */}
        <div className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Awards & achievements</h2>
            <AddAchievementModal onAdd={handleAddAchievement} submitting={savingAchievement} />
          </div>
          {achievementError && (
            <p className="mb-3 text-sm text-red-600">{achievementError}</p>
          )}
          {awards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No achievements added yet.</p>
          ) : (
            <div className="space-y-3">
              {awards.map((award, i) => (
                <div key={i} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between">
                    <p className="font-medium">{award.title}</p>
                    {award.date && <p className="shrink-0 text-sm text-muted-foreground">{award.date}</p>}
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
              ))}
            </div>
          )}
        </div>

        {expCount === 0 && projCount === 0 && eduCount === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <p className="text-muted-foreground">No career data yet.</p>
            <button
              onClick={() => router.push('/onboarding')}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add your first entry
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
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
