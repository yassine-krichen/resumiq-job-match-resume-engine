'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';
import { PageHeader } from '@/components/page-header';

export default function OnboardingReviewPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MasterDB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<MasterDB>('/profile')
      .then(setProfile)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading profile...</p>
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

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Review your profile"
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
          Confirm the AI parsed your data correctly. You can always edit from your profile.
        </p>

        {profile && (
          <div className="space-y-4">
            {profile.experience?.length > 0 && (
              <Section title="Experience" count={profile.experience.length}>
                {profile.experience.map((exp, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted p-4">
                    <p className="font-medium">{exp.role} @ {exp.company}</p>
                    <p className="text-sm text-muted-foreground">{exp.startDate} – {exp.isCurrent ? 'Present' : exp.endDate}</p>
                    {exp.raw_achievements?.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
                        {exp.raw_achievements.map((achievement, j) => (
                          <li key={j}>{achievement}</li>
                        ))}
                      </ul>
                    )}
                    {exp.technologies_used?.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">{exp.technologies_used.slice(0, 6).join(', ')}</p>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {profile.projects?.length > 0 && (
              <Section title="Projects" count={profile.projects.length}>
                {profile.projects.map((proj, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted p-4">
                    <p className="font-medium">{proj.name}</p>
                    <p className="text-sm text-muted-foreground">{proj.startDate} – {proj.endDate}</p>
                    {proj.raw_achievements?.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
                        {proj.raw_achievements.map((achievement, j) => (
                          <li key={j}>{achievement}</li>
                        ))}
                      </ul>
                    )}
                    {proj.technologies_used?.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">{proj.technologies_used.slice(0, 6).join(', ')}</p>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {profile.education?.length > 0 && (
              <Section title="Education" count={profile.education.length}>
                {profile.education.map((edu, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted p-4">
                    <p className="font-medium">{edu.degree_type} in {edu.major}</p>
                    <p className="text-sm text-muted-foreground">{edu.institution}</p>
                  </div>
                ))}
              </Section>
            )}

            {profile.skills?.programming_languages?.length > 0 && (
              <Section title="Skills" count={1}>
                <div className="rounded-lg border border-border bg-muted p-4">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Languages: </span>
                    {profile.skills.programming_languages.join(', ')}
                  </p>
                  {profile.skills.frameworks_and_libraries?.length > 0 && (
                    <p className="mt-1 text-sm text-foreground">
                      <span className="font-medium">Frameworks: </span>
                      {profile.skills.frameworks_and_libraries.join(', ')}
                    </p>
                  )}
                </div>
              </Section>
            )}

            {profile.certifications?.length > 0 && (
              <Section title="Certifications" count={profile.certifications.length}>
                {profile.certifications.map((cert, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted p-4">
                    <p className="font-medium">{cert.name}</p>
                    <p className="text-sm text-muted-foreground">{cert.issuer}{cert.date ? ` – ${cert.date}` : ''}</p>
                  </div>
                ))}
              </Section>
            )}

            {profile.awards_and_honors?.length > 0 && (
              <Section title="Awards" count={profile.awards_and_honors.length}>
                {profile.awards_and_honors.map((award, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted p-4">
                    <p className="font-medium">{award.title}</p>
                    <p className="text-sm text-muted-foreground">{award.issuer}{award.date ? ` – ${award.date}` : ''}</p>
                  </div>
                ))}
              </Section>
            )}
          </div>
        )}
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
