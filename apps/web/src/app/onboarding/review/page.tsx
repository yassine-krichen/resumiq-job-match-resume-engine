'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';

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
        <p className="text-zinc-500">Loading profile...</p>
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
    <div className="min-h-screen bg-zinc-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Review your profile</h1>
            <p className="mt-1 text-zinc-500">
              Confirm the AI parsed your data correctly. You can always edit from your profile.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/onboarding')}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Add more
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Go to dashboard
            </button>
          </div>
        </div>

        {profile && (
          <div className="space-y-4">
            {profile.experience?.length > 0 && (
              <Section title="Experience" count={profile.experience.length}>
                {profile.experience.map((exp, i) => (
                  <div key={i} className="rounded-lg border border-zinc-100 bg-zinc-50 p-4">
                    <p className="font-medium">{exp.role} @ {exp.company}</p>
                    <p className="text-sm text-zinc-500">{exp.startDate} – {exp.isCurrent ? 'Present' : exp.endDate}</p>
                    <p className="mt-1 text-sm text-zinc-600">{exp.technologies_used?.slice(0, 6).join(', ')}</p>
                  </div>
                ))}
              </Section>
            )}

            {profile.projects?.length > 0 && (
              <Section title="Projects" count={profile.projects.length}>
                {profile.projects.map((proj, i) => (
                  <div key={i} className="rounded-lg border border-zinc-100 bg-zinc-50 p-4">
                    <p className="font-medium">{proj.name}</p>
                    <p className="text-sm text-zinc-500">{proj.startDate} – {proj.endDate}</p>
                    <p className="mt-1 text-sm text-zinc-600">{proj.technologies_used?.slice(0, 6).join(', ')}</p>
                  </div>
                ))}
              </Section>
            )}

            {profile.education?.length > 0 && (
              <Section title="Education" count={profile.education.length}>
                {profile.education.map((edu, i) => (
                  <div key={i} className="rounded-lg border border-zinc-100 bg-zinc-50 p-4">
                    <p className="font-medium">{edu.degree_type} in {edu.major}</p>
                    <p className="text-sm text-zinc-500">{edu.institution}</p>
                  </div>
                ))}
              </Section>
            )}

            {profile.skills?.programming_languages?.length > 0 && (
              <Section title="Skills" count={1}>
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-4">
                  <p className="text-sm text-zinc-700">
                    <span className="font-medium">Languages: </span>
                    {profile.skills.programming_languages.join(', ')}
                  </p>
                  {profile.skills.frameworks_and_libraries?.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-700">
                      <span className="font-medium">Frameworks: </span>
                      {profile.skills.frameworks_and_libraries.join(', ')}
                    </p>
                  )}
                </div>
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
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
        {title}
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-500">
          {count}
        </span>
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
