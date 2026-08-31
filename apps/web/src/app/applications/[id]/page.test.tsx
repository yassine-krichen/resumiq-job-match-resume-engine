import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ApplicationReviewPage from './page';
import { getApplication } from '../../apply/manual/_components/api';
import {
  buildApplication,
  buildEmailDraft,
  buildGapReport,
  buildResumeSelection,
} from '../../apply/manual/_components/test-fixtures';

// `../../apply/manual/_components/api` wraps `apiFetch` from `@/lib/api` —
// mock it directly so these tests exercise the page's step-derivation
// without hitting the network.
vi.mock('../../apply/manual/_components/api', () => ({
  getApplication: vi.fn(),
}));

// The finalize SSE hook has its own direct test suite
// (src/hooks/use-finalize-application.test.tsx) — stubbed here so this
// suite stays focused on step-derivation/routing, not SSE plumbing.
vi.mock('@/hooks/use-finalize-application', () => ({
  useFinalizeApplication: () => ({
    finalizing: false,
    progress: '',
    error: '',
    finalize: vi.fn(),
  }),
}));

// Data-fetching child steps are stubbed so this suite stays focused on which
// step the page decides to render, not on those components' internals (each
// has its own test file).
vi.mock('../../apply/manual/_components/match-score-display', () => ({
  MatchScoreDisplay: () => <div>match-score-display-stub</div>,
}));
vi.mock('../../apply/manual/_components/gap-report-view', () => ({
  GapReportView: () => <div>gap-report-view-stub</div>,
}));
vi.mock('../../apply/manual/_components/resume-review-editor', () => ({
  ResumeReviewEditor: () => <div>resume-review-editor-stub</div>,
}));
vi.mock('../../apply/manual/_components/email-review-gate', () => ({
  EmailReviewGate: () => <div>email-review-gate-stub</div>,
}));

let paramsId = 'app-1';
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: paramsId }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApplicationReviewPage />
    </QueryClientProvider>,
  );
}

describe('ApplicationReviewPage', () => {
  beforeEach(() => {
    vi.mocked(getApplication).mockReset();
    paramsId = 'app-1';
  });

  it('shows a loading state while the application is being fetched', () => {
    vi.mocked(getApplication).mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText(/loading application/i)).toBeInTheDocument();
  });

  it('shows the fetch error message when GET /applications/:id fails', async () => {
    vi.mocked(getApplication).mockRejectedValue(new Error('API 404: application not found'));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('API 404: application not found')).toBeInTheDocument(),
    );
  });

  it('resolves to the gap-report step when only gapReport is populated', async () => {
    vi.mocked(getApplication).mockResolvedValue(buildApplication({ gapReport: buildGapReport() }));

    renderPage();

    await waitFor(() => expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument());
    expect(screen.getByText('match-score-display-stub')).toBeInTheDocument();
    expect(screen.queryByText('resume-review-editor-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('email-review-gate-stub')).not.toBeInTheDocument();
  });

  it('resolves to the resume-review step when resumeSelection is populated, even if gapReport is also present', async () => {
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({ gapReport: buildGapReport(), resumeSelection: buildResumeSelection() }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('resume-review-editor-stub')).toBeInTheDocument(),
    );
    expect(screen.getByText('match-score-display-stub')).toBeInTheDocument();
    expect(screen.queryByText('gap-report-view-stub')).not.toBeInTheDocument();
  });

  it('resolves to the email-review step when emailDraft is populated, even if resumeSelection and gapReport are also present', async () => {
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({
        gapReport: buildGapReport(),
        resumeSelection: buildResumeSelection(),
        emailDraft: buildEmailDraft(),
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('email-review-gate-stub')).toBeInTheDocument());
    // The match-score banner is only shown for the gap/review steps.
    expect(screen.queryByText('match-score-display-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('gap-report-view-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('resume-review-editor-stub')).not.toBeInTheDocument();
  });

  it('resolves to the ready (terminal) step when status is "ready", overriding gapReport/resumeSelection/emailDraft still populated from earlier stages', async () => {
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({
        status: 'ready',
        gapReport: buildGapReport(),
        resumeSelection: buildResumeSelection(),
        emailDraft: buildEmailDraft(),
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Application ready')).toBeInTheDocument());
    expect(screen.getByText(/Backend Engineer @ Acme Corp/)).toBeInTheDocument();
    expect(screen.queryByText('email-review-gate-stub')).not.toBeInTheDocument();
  });

  it('links to the correct resume PDF download URL for a ready application', async () => {
    vi.mocked(getApplication).mockResolvedValue(buildApplication({ id: 'app-42', status: 'ready' }));

    renderPage();

    await waitFor(() => expect(screen.getByText('Application ready')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /download resume pdf/i })).toHaveAttribute(
      'href',
      'http://localhost:3001/api/applications/app-42/resume.pdf',
    );
  });

  it('shows an "unexpected application state" message when no gap report, resume selection, or email draft is populated and status is not ready', async () => {
    vi.mocked(getApplication).mockResolvedValue(buildApplication({ status: 'analyzing' }));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Unexpected application state.')).toBeInTheDocument(),
    );
  });

  it('fetches the application matching the id from the route params', async () => {
    paramsId = 'app-99';
    vi.mocked(getApplication).mockResolvedValue(buildApplication({ id: 'app-99' }));

    renderPage();

    await waitFor(() => expect(getApplication).toHaveBeenCalledWith('app-99'));
  });
});
