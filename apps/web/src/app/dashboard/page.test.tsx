import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import { getDashboardSummary } from './_components/api';
import { saveGapReport } from '../apply/manual/_components/api';
import { buildApplication, buildGapReport } from '../apply/manual/_components/test-fixtures';
import { useSession, signOut } from '@/lib/auth-client';
import type { DashboardSummary } from './_components/types';

vi.mock('./_components/api', () => ({
  getDashboardSummary: vi.fn(),
}));

// GapReportView is rendered for real here (its own checkbox-persistence
// behavior already has a dedicated test suite in gap-report-view.test.tsx —
// this only confirms the dashboard wires it up correctly), so its API
// module needs mocking the same way gap-report-view.test.tsx does.
vi.mock('../apply/manual/_components/api', () => ({
  saveGapReport: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
}));

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function buildSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    totalApplications: 12,
    avgMatchScore: 68,
    resumesGenerated: 9,
    gapReportsSaved: 3,
    recentActivity: [],
    savedGapReports: [],
    ...overrides,
  };
}

function mockSession(session: { user: { email: string; name: string } } | null, isPending = false) {
  vi.mocked(useSession).mockReturnValue({
    data: session,
    isPending,
  } as ReturnType<typeof useSession>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.mocked(getDashboardSummary).mockReset();
    vi.mocked(saveGapReport).mockReset();
    vi.mocked(useSession).mockReset();
    replaceMock.mockReset();
    vi.mocked(getDashboardSummary).mockResolvedValue(buildSummary());
    mockSession({ user: { email: 'jane@example.com', name: 'Jane' } });
  });

  it('shows a loading state while the session is still resolving, without redirecting', () => {
    mockSession(null, true);

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects to /login once session resolution finishes with no signed-in user', async () => {
    mockSession(null, false);

    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  it('does not fetch the dashboard summary until a session is present', () => {
    mockSession(null, true);

    renderPage();

    expect(getDashboardSummary).not.toHaveBeenCalled();
  });

  it('renders exactly the 4 stat numbers the backend reports, with no separate "interview prep" stat', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(
      buildSummary({ totalApplications: 12, avgMatchScore: 68, resumesGenerated: 9, gapReportsSaved: 3 }),
    );

    renderPage();

    // "Avg. match score" only renders once `summary` has loaded — a
    // reliable ready-marker that (unlike "Applications") isn't ambiguous
    // with the "Applications" quick-action card title rendered elsewhere
    // on the page.
    await waitFor(() => expect(screen.getByText('Avg. match score')).toBeInTheDocument());
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Resumes generated')).toBeInTheDocument();
    expect(screen.getByText('Gap reports saved')).toBeInTheDocument();
    expect(screen.queryByText(/interview prep/i)).not.toBeInTheDocument();
  });

  it('shows the fetch error message when GET /applications/dashboard-summary fails', async () => {
    vi.mocked(getDashboardSummary).mockRejectedValue(new Error('API 500: summary unavailable'));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('API 500: summary unavailable')).toBeInTheDocument(),
    );
  });

  it('links each recent-activity entry to its application detail page with title, company, date, and status', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(
      buildSummary({
        recentActivity: [
          {
            id: 'app-1',
            status: 'ready',
            matchScore: 80,
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
            job: { id: 'job-1', title: 'Backend Engineer', companyName: 'Acme Corp', location: null },
          },
        ],
      }),
    );

    renderPage();

    const link = await screen.findByRole('link', { name: /Backend Engineer @ Acme Corp/ });
    expect(link).toHaveAttribute('href', '/applications/app-1');
    expect(within(link).getByText('Ready')).toBeInTheDocument();
  });

  it('does not render a "Recent activity" section when there is no recent activity', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(buildSummary({ recentActivity: [] }));

    renderPage();

    await waitFor(() => expect(screen.getByText('Avg. match score')).toBeInTheDocument());
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
  });

  it('renders each saved gap report via GapReportView, wired to the matching application id', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(
      buildSummary({
        savedGapReports: [
          {
            id: 'app-5',
            gapReport: buildGapReport({
              missing_skills: [
                { skill: 'Kubernetes', priority: 'mandatory', suggested_resources: [], completed: false },
              ],
            }),
            job: { id: 'job-5', title: 'Platform Engineer', companyName: 'Globex' },
          },
        ],
      }),
    );
    vi.mocked(saveGapReport).mockResolvedValue(buildApplication());

    renderPage();

    await screen.findByText('Kubernetes');
    expect(screen.getByRole('link', { name: /Platform Engineer @ Globex/ })).toHaveAttribute(
      'href',
      '/applications/app-5',
    );

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(saveGapReport).toHaveBeenCalledWith(
        'app-5',
        expect.objectContaining({
          missing_skills: [expect.objectContaining({ skill: 'Kubernetes', completed: true })],
        }),
      ),
    );
  });

  it('does not render a "Saved gap reports" section when there are none', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(buildSummary({ savedGapReports: [] }));

    renderPage();

    await waitFor(() => expect(screen.getByText('Avg. match score')).toBeInTheDocument());
    expect(screen.queryByText('Saved gap reports')).not.toBeInTheDocument();
  });

  it('points every quick-action card at its real route', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Career Profile')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /view profile/i })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: /^discover jobs/i })).toHaveAttribute('href', '/discover');
    expect(screen.getByRole('link', { name: /view applications/i })).toHaveAttribute(
      'href',
      '/applications',
    );
    expect(screen.getByRole('link', { name: /^paste a job/i })).toHaveAttribute(
      'href',
      '/apply/manual',
    );
    expect(screen.getByRole('link', { name: /edit settings/i })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: /add experience/i })).toHaveAttribute(
      'href',
      '/onboarding',
    );
  });

  it('signs out when "Sign out" is clicked', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('jane@example.com')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
