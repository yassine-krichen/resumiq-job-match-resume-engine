'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MasterDB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">Loading...</p>
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

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <button onClick={() => router.back()} className="text-sm text-zinc-500 hover:text-zinc-900">
            ← Back
          </button>
          <h1 className="text-base font-semibold">Career Profile</h1>
          <button
            onClick={() => router.push('/onboarding')}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            + Add entry
          </button>
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
            <div key={label} className="rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-sm">
              <p className="text-3xl font-bold">{value}</p>
              <p className="mt-1 text-sm text-zinc-500">{label}</p>
            </div>
          ))}
        </div>

        {/* Experience */}
        {expCount > 0 && (
          <ProfileSection title="Experience">
            {profile!.experience.map((exp, i) => (
              <div key={i} className="rounded-lg border border-zinc-100 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{exp.role}</p>
                    <p className="text-sm text-zinc-600">{exp.company} · {exp.location}</p>
                  </div>
                  <p className="shrink-0 text-sm text-zinc-400">
                    {exp.startDate} – {exp.isCurrent ? 'Present' : exp.endDate}
                  </p>
                </div>
                {exp.technologies_used?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {exp.technologies_used.slice(0, 8).map((t) => (
                      <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
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
              <div key={i} className="rounded-lg border border-zinc-100 p-4">
                <p className="font-medium">{proj.name}</p>
                <p className="text-sm text-zinc-500">{proj.context}</p>
                {proj.technologies_used?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {proj.technologies_used.slice(0, 8).map((t) => (
                      <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
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
              <div key={i} className="rounded-lg border border-zinc-100 p-4">
                <p className="font-medium">{edu.degree_type} in {edu.major}</p>
                <p className="text-sm text-zinc-600">{edu.institution}</p>
                <p className="text-sm text-zinc-400">{edu.startDate} – {edu.endDate}</p>
              </div>
            ))}
          </ProfileSection>
        )}

        {expCount === 0 && projCount === 0 && eduCount === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center">
            <p className="text-zinc-400">No career data yet.</p>
            <button
              onClick={() => router.push('/onboarding')}
              className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
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
    <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
