import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApplyManualFlow } from './apply-manual-flow';
import { getApplication, extractJobIntake } from './api';
import { apiSSE } from '@/lib/api';
import {
  buildApplication,
  buildEmailDraft,
  buildGapReport,
  buildResumeSelection,
} from './test-fixtures';
import type { ApplicationRecord } from './types';

// `./api` wraps `apiFetch` from `@/lib/api` — mock it directly so these
// tests exercise ApplyManualFlow's step-derivation without hitting the network.
vi.mock('./api', () => ({
  getApplication: vi.fn(),
  extractJobIntake: vi.fn(),
}));

// `apiSSE` is imported directly by ApplyManualFlow (used for the analyze/finalize
// SSE streams) — separate from `./api`'s request/response helpers.
vi.mock('@/lib/api', () => ({
  API_URL: 'http://localhost:3001',
  apiSSE: vi.fn(),
}));

// Data-fetching child steps are stubbed so this suite stays focused on which
// step ApplyManualFlow decides to render, not on those components' internals
// (each has its own test file).
vi.mock('./match-score-display', () => ({
  MatchScoreDisplay: () => <div>match-score-display-stub</div>,
}));
vi.mock('./gap-report-view', () => ({
  GapReportView: () => <div>gap-report-view-stub</div>,
}));
vi.mock('./resume-review-editor', () => ({
  ResumeReviewEditor: () => <div>resume-review-editor-stub</div>,
}));
vi.mock('./email-review-gate', () => ({
  EmailReviewGate: () => <div>email-review-gate-stub</div>,
}));

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

function renderFlow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApplyManualFlow />
    </QueryClientProvider>,
  );
}

describe('ApplyManualFlow', () => {
  beforeEach(() => {
    vi.mocked(getApplication).mockReset();
    vi.mocked(extractJobIntake).mockReset();
    vi.mocked(apiSSE).mockReset();
    pushMock.mockReset();
    searchParams = new URLSearchParams();
  });

  it('renders the paste form when no applicationId is in the URL', () => {
    renderFlow();

    expect(screen.getByText('Analyze a job description')).toBeInTheDocument();
    expect(screen.getByLabelText(/job posting/i)).toBeInTheDocument();
    expect(getApplication).not.toHaveBeenCalled();
  });

  it('shows a loading state while a hydrated application is being fetched by id', async () => {
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    let resolveFetch!: (value: ApplicationRecord) => void;
    vi.mocked(getApplication).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderFlow();
    expect(screen.getByText(/loading application/i)).toBeInTheDocument();

    resolveFetch(buildApplication({ gapReport: buildGapReport() }));
    await waitFor(() =>
      expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument(),
    );
  });

  it('shows the fetch error message when GET /applications/:id fails', async () => {
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    vi.mocked(getApplication).mockRejectedValue(new Error('API 404: application not found'));

    renderFlow();

    await waitFor(() =>
      expect(screen.getByText('API 404: application not found')).toBeInTheDocument(),
    );
  });

  it('resolves to the gap-report step when only gapReport is populated', async () => {
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({ status: 'analyzed', gapReport: buildGapReport() }),
    );

    renderFlow();

    await waitFor(() =>
      expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument(),
    );
    expect(screen.getByText('match-score-display-stub')).toBeInTheDocument();
    expect(screen.queryByText('resume-review-editor-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('email-review-gate-stub')).not.toBeInTheDocument();
  });

  it('resolves to the resume-review step when resumeSelection is populated, even if gapReport is also present', async () => {
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({
        status: 'analyzed',
        gapReport: buildGapReport(),
        resumeSelection: buildResumeSelection(),
      }),
    );

    renderFlow();

    await waitFor(() =>
      expect(screen.getByText('resume-review-editor-stub')).toBeInTheDocument(),
    );
    expect(screen.getByText('match-score-display-stub')).toBeInTheDocument();
    expect(screen.queryByText('gap-report-view-stub')).not.toBeInTheDocument();
  });

  it('resolves to the email-review step when emailDraft is populated, even if resumeSelection and gapReport are also present', async () => {
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({
        status: 'analyzed',
        gapReport: buildGapReport(),
        resumeSelection: buildResumeSelection(),
        emailDraft: buildEmailDraft(),
      }),
    );

    renderFlow();

    await waitFor(() =>
      expect(screen.getByText('email-review-gate-stub')).toBeInTheDocument(),
    );
    // The match-score banner is only shown for the gap/review steps.
    expect(screen.queryByText('match-score-display-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('gap-report-view-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('resume-review-editor-stub')).not.toBeInTheDocument();
  });

  it('resolves to the ready (terminal) step when status is "ready", overriding gapReport/resumeSelection/emailDraft still populated from earlier stages', async () => {
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({
        status: 'ready',
        gapReport: buildGapReport(),
        resumeSelection: buildResumeSelection(),
        emailDraft: buildEmailDraft(),
      }),
    );

    renderFlow();

    await waitFor(() => expect(screen.getByText('Application ready')).toBeInTheDocument());
    expect(screen.getByText(/Backend Engineer @ Acme Corp/)).toBeInTheDocument();
    expect(screen.queryByText('email-review-gate-stub')).not.toBeInTheDocument();
  });

  it('shows an "unexpected application state" message when no gap report, resume selection, or email draft is populated and status is not ready', async () => {
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    vi.mocked(getApplication).mockResolvedValue(buildApplication({ status: 'analyzing' }));

    renderFlow();

    await waitFor(() =>
      expect(screen.getByText('Unexpected application state.')).toBeInTheDocument(),
    );
  });

  it('reloading with a hydrated GET /:id response resumes at the same step the user left off at (gap-report), not the intake form', async () => {
    // Simulates a page refresh: applicationId is already in the URL and the
    // server returns the persisted state instead of the client's in-memory step.
    searchParams = new URLSearchParams({ applicationId: 'app-1' });
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({ status: 'analyzed', gapReport: buildGapReport() }),
    );

    renderFlow();

    await waitFor(() =>
      expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Analyze a job description')).not.toBeInTheDocument();
  });

  it('navigates to the application URL with the new applicationId once the paste is extracted, reviewed, and the analyze SSE stream completes', async () => {
    vi.mocked(extractJobIntake).mockResolvedValue({
      title: 'Backend Engineer',
      company_name: 'Acme Corp',
      location: 'Remote (US)',
      remote: true,
      salary_range: null,
      company_info_summary: null,
    });
    vi.mocked(apiSSE).mockImplementation((_path, _body, options) => {
      options.onDone({ applicationId: 'new-app-id', matchScore: 80, reasons: [] });
      return () => {};
    });

    renderFlow();

    fireEvent.change(screen.getByLabelText(/job posting/i), {
      target: { value: 'x'.repeat(60) },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    await waitFor(() => expect(screen.getByText('Review job details')).toBeInTheDocument());
    expect(screen.getByLabelText(/company name/i)).toHaveValue('Acme Corp');

    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    expect(pushMock).toHaveBeenCalledWith('/apply/manual?applicationId=new-app-id');
  });
});
