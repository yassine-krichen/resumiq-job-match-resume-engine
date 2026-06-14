'use client';

import { useSession, signOut } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace('/login');
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!session) return null;

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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DashCard
            title="Career Profile"
            description="View and manage your experience, projects, and skills."
            href="/profile"
            cta="View profile"
          />
          <DashCard
            title="Add Entry"
            description="Paste raw text — AI parses it into your career profile."
            href="/onboarding"
            cta="Add experience"
          />
          <DashCard
            title="Generate Resume"
            description="Paste a job description to generate a tailored resume."
            href="#"
            cta="Coming soon"
            disabled
          />
        </div>
      </main>
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
