import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DiscoverPage from './page';
import {
  dismissJob,
  getDiscoverFeed,
  getJobsSettings,
  refreshMatchPreviews,
  swipeRightJob,
} from './_components/api';
import { buildDiscoverJob, buildFeedItem, buildFeedResult, buildUserSettings } from './_components/test-fixtures';

// `./_components/api` wraps `apiFetch` from `@/lib/api` — mock it directly so
// these tests exercise DiscoverPage's mount/mutation/rollback logic without
// hitting the network.
vi.mock('./_components/api', () => ({
  getDiscoverFeed: vi.fn(),
  dismissJob: vi.fn(),
  swipeRightJob: vi.fn(),
  refreshMatchPreviews: vi.fn(),
  getJobsSettings: vi.fn(),
  updateJobsSettings: vi.fn(),
}));

// FilterBar has its own test suite — stubbed here so this suite stays
// focused on the feed/mutation/refresh-on-mount behavior DiscoverPage owns.
vi.mock('./_components/filter-bar', () => ({
  FilterBar: () => <div>filter-bar-stub</div>,
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DiscoverPage />
    </QueryClientProvider>,
  );
}

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.mocked(getDiscoverFeed).mockReset();
    vi.mocked(dismissJob).mockReset();
    vi.mocked(swipeRightJob).mockReset();
    vi.mocked(refreshMatchPreviews).mockReset();
    vi.mocked(getJobsSettings).mockReset();

    vi.mocked(getJobsSettings).mockResolvedValue(buildUserSettings());
    vi.mocked(refreshMatchPreviews).mockResolvedValue({ refreshed: 0 });
    vi.mocked(getDiscoverFeed).mockResolvedValue(buildFeedResult());
  });

  it('fires POST /jobs/refresh-previews exactly once on mount', async () => {
    renderPage();

    await waitFor(() => expect(refreshMatchPreviews).toHaveBeenCalledTimes(1));
  });

  it('still loads the discover feed when refresh-previews fails — the refresh is best-effort and never blocks the page', async () => {
    vi.mocked(refreshMatchPreviews).mockRejectedValue(new Error('network error'));

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument(),
    );
  });

  it('renders the empty-state message when the discover feed has no items', async () => {
    vi.mocked(getDiscoverFeed).mockResolvedValue(buildFeedResult([]));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('No jobs to review right now.')).toBeInTheDocument(),
    );
  });

  it('shows the feed error message when GET /jobs/discover fails', async () => {
    vi.mocked(getDiscoverFeed).mockRejectedValue(new Error('API 500: discover failed'));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('API 500: discover failed')).toBeInTheDocument(),
    );
  });

  it('rolls the dismissed job back into the feed and shows an error when the dismiss request fails', async () => {
    vi.mocked(getDiscoverFeed).mockResolvedValue(
      buildFeedResult([
        buildFeedItem({ job: buildDiscoverJob({ id: 'job-1', title: 'Backend Engineer' }) }),
      ]),
    );
    vi.mocked(dismissJob).mockRejectedValue(new Error('API 500: dismiss failed'));

    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));

    // The mutation only fires once SwipeDeck's own 200ms exit animation
    // completes — give waitFor enough headroom for that real timer plus the
    // rejected request's rollback to settle.
    await waitFor(
      () =>
        expect(screen.getByText("Couldn't dismiss that job — try again.")).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument();
  });

  it('rolls the job back into the feed and clears the drafting message when the swipe-right request fails', async () => {
    vi.mocked(getDiscoverFeed).mockResolvedValue(
      buildFeedResult([
        buildFeedItem({
          job: buildDiscoverJob({ id: 'job-1', title: 'Backend Engineer', companyName: 'Acme Corp' }),
        }),
      ]),
    );
    vi.mocked(swipeRightJob).mockRejectedValue(new Error('API 500: swipe failed'));

    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(
      () =>
        expect(
          screen.getByText("Couldn't queue that application — try again."),
        ).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument();
    expect(screen.queryByText(/Drafting your resume/)).not.toBeInTheDocument();
  });

  it('optimistically removes the swiped card and shows a drafting message before the request resolves', async () => {
    vi.mocked(getDiscoverFeed).mockResolvedValue(
      buildFeedResult([
        buildFeedItem({
          job: buildDiscoverJob({ id: 'job-1', title: 'Backend Engineer', companyName: 'Acme Corp' }),
        }),
      ]),
    );
    let resolveSwipe!: (v: { queued: boolean }) => void;
    vi.mocked(swipeRightJob).mockReturnValue(
      new Promise((resolve) => {
        resolveSwipe = resolve;
      }),
    );

    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(
      () =>
        expect(screen.getByText(/Drafting your resume for Acme Corp/)).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getByText('No jobs to review right now.')).toBeInTheDocument();

    resolveSwipe({ queued: true });
    await waitFor(() =>
      expect(swipeRightJob).toHaveBeenCalledWith('job-1', expect.anything()),
    );
  });
});
