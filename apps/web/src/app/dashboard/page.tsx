'use client';

import { useSession, signOut } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GapReportView } from '../apply/manual/_components/gap-report-view';
import { STATUS_LABELS } from '../applications/_components/types';
import { getDashboardSummary } from './_components/api';

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace('/login');
    }
  }, [session, isPending, router]);

  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: getDashboardSummary,
    enabled: Boolean(session),
  });

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!session) return null;

  const summary = summaryQuery.data;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-lg font-semibold">Resumiq</span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-600">{session.user.email}</span>
            <button
              onClick={() => signOut()}
              className="text-sm text-zinc-500 hover:text-zinc-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-zinc-500">Welcome back, {session.user.name}</p>
        </div>

        {summaryQuery.isLoading && <p className="mb-8 text-zinc-500">Loading dashboard...</p>}
        {summaryQuery.isError && (
          <p className="mb-8 text-red-600">{(summaryQuery.error as Error).message}</p>
        )}

        {summary && (
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Applications" value={summary.totalApplications} />
            <StatCard label="Avg. match score" value={summary.avgMatchScore} />
            <StatCard label="Resumes generated" value={summary.resumesGenerated} />
            <StatCard label="Gap reports saved" value={summary.gapReportsSaved} />
          </div>
        )}

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DashCard
            title="Career Profile"
            description="View and manage your experience, projects, and skills."
            href="/profile"
            cta="View profile"
          />
          <DashCard
            title="Discover jobs"
            description="Swipe through matched jobs and draft resumes in the background."
            href="/discover"
            cta="Discover jobs"
          />
          <DashCard
            title="Applications"
            description="Browse, filter, and review every application you've drafted."
            href="/applications"
            cta="View applications"
          />
          <DashCard
            title="Paste a job"
            description="Paste a job description to generate a tailored resume."
            href="/apply/manual"
            cta="Paste a job"
          />
          <DashCard
            title="Settings"
            description="Tune match threshold, target roles, and notification preferences."
            href="/settings"
            cta="Edit settings"
          />
          <DashCard
            title="Add Entry"
            description="Paste raw text — AI parses it into your career profile."
            href="/onboarding"
            cta="Add experience"
          />
        </div>

        {summary && summary.recentActivity.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-zinc-900">Recent activity</h2>
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white shadow-sm">
              {summary.recentActivity.map((item) => (
                <Link
                  key={item.id}
                  href={`/applications/${item.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-zinc-50"
                >
                  <span className="font-medium text-zinc-900">
                    {item.job.title} @ {item.job.companyName}
                  </span>
                  <span className="flex items-center gap-3 text-zinc-500">
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {summary && summary.savedGapReports.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-zinc-900">Saved gap reports</h2>
            <div className="space-y-6">
              {summary.savedGapReports.map((item) => (
                <div key={item.id}>
                  <p className="mb-2 text-sm font-medium text-zinc-700">
                    <Link href={`/applications/${item.id}`} className="hover:underline">
                      {item.job.title} @ {item.job.companyName}
                    </Link>
                  </p>
                  <GapReportView applicationId={item.id} gapReport={item.gapReport} />
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-sm">
      <p className="text-3xl font-bold">{value}</p>
      <p className="mt-1 text-sm text-zinc-500">{label}</p>
    </div>
  );
}

function DashCard({
  title,
  description,
  href,
  cta,
  disabled,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
      {disabled ? (
        <span className="mt-4 inline-block text-sm text-zinc-300">{cta}</span>
      ) : (
        <Link
          href={href}
          className="mt-4 inline-block text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
        >
          {cta} →
        </Link>
      )}
    </div>
  );
}
