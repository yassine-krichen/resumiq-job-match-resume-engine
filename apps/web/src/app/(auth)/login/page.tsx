'use client';

import { signIn } from '@/lib/auth-client';

export default function LoginPage() {
  async function handleGitHub() {
    await signIn.social({ provider: 'github', callbackURL: '/dashboard' });
  }

  async function handleLinkedIn() {
    await signIn.social({ provider: 'linkedin', callbackURL: '/dashboard' });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Resumiq</h1>
        <p className="text-zinc-500">Sign in to start generating tailored resumes</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          onClick={handleGitHub}
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Continue with GitHub
        </button>
        <button
          onClick={handleLinkedIn}
          className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          Continue with LinkedIn
        </button>
      </div>
    </div>
  );
}
