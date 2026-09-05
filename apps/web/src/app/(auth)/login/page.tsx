'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signUp } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GitHubIcon, LinkedInIcon } from './_components/brand-icons';

type AuthMode = 'sign-in' | 'sign-up';

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleGitHub() {
    await signIn.social({ provider: 'github', callbackURL: '/dashboard' });
  }

  async function handleLinkedIn() {
    await signIn.social({ provider: 'linkedin', callbackURL: '/dashboard' });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const { data, error: authError } =
      mode === 'sign-in'
        ? await signIn.email({ email, password })
        : await signUp.email({ name, email, password });

    setSubmitting(false);

    if (authError) {
      setError(authError.message ?? 'Something went wrong. Please try again.');
      return;
    }

    if (data) {
      router.push('/dashboard');
      return;
    }

    setError('Something went wrong. Please try again.');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Welcome to Resumiq</h1>
        <p className="text-zinc-600">Sign in to start generating tailored resumes</p>
      </div>

      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-3">
          <Button type="button" variant="outline" onClick={handleGitHub} className="h-11 gap-2">
            <GitHubIcon className="size-4" />
            Continue with GitHub
          </Button>
          <Button type="button" variant="outline" onClick={handleLinkedIn} className="h-11 gap-2">
            <LinkedInIcon className="size-4" />
            Continue with LinkedIn
          </Button>
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-xs text-zinc-500">or</span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm font-medium">
          <button
            type="button"
            aria-label="Sign in tab"
            onClick={() => {
              setMode('sign-in');
              setError('');
              setName('');
              setPassword('');
            }}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              mode === 'sign-in' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            aria-label="Sign up tab"
            onClick={() => {
              setMode('sign-up');
              setError('');
              setName('');
              setPassword('');
            }}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              mode === 'sign-up' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
            }`}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'sign-up' && (
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="mt-1"
                autoComplete="name"
                disabled={submitting}
                required
              />
            </div>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="mt-1"
              autoComplete="email"
              disabled={submitting}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              disabled={submitting}
              required
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={submitting} className="h-11 w-full">
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      </div>

      <p className="text-xs text-zinc-500">
        Tailored resumes and gap reports, generated from your career profile.
      </p>
    </div>
  );
}
