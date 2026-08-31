import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ApplicationReviewPage from './page';
import { getApplication } from '../../apply/manual/_components/api';
import { apiSSE } from '@/lib/api';
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

// `@/lib/api` is also imported directly by the page (API_URL for the PDF
// download link, apiSSE indirectly via useRegenerateApplication) — mocked
// here so the regenerate tests can control the SSE stream without hitting
// the network, same pattern as apply-manual-flow.test.tsx.
vi.mock('@/lib/api', () => ({
  API_URL: 'http://localhost:3001',
  apiSSE: vi.fn(),
}));

// Mutable so individual tests can flip `finalizing` to exercise the
// cross-disable behavior with the regenerate button — `vi.mock` factories
// are hoisted above regular module-scope `let`s, so this has to go through
// `vi.hoisted` to be visible inside the factory below.
const finalizeState = vi.hoisted(() => ({ finalizing: false }));

// The finalize SSE hook has its own direct test suite
// (src/hooks/use-finalize-application.test.tsx) — stubbed here so this
// suite stays focused on step-derivation/routing, not SSE plumbing.
vi.mock('@/hooks/use-finalize-application', () => ({
  useFinalizeApplication: () => ({
    finalizing: finalizeState.finalizing,
    progress: '',
    error: '',
    finalize: vi.fn(),
  }),
}));

// Data-fetching child steps are stubbed so this suite stays focused on which
// step the page decides to render, not on those components' internals (each
// has its own test file). The resume-review-editor stub renders the
// `disabled` prop it received so tests can assert it's threaded through
// from the page's `regenerating` state.
vi.mock('../../apply/manual/_components/match-score-display', () => ({
  MatchScoreDisplay: () => <div>match-score-display-stub</div>,
}));
vi.mock('../../apply/manual/_components/gap-report-view', () => ({
  GapReportView: () => <div>gap-report-view-stub</div>,
}));
vi.mock('../../apply/manual/_components/resume-review-editor', () => ({
  ResumeReviewEditor: ({ disabled }: { disabled?: boolean }) => (
    <div>resume-review-editor-stub (disabled: {String(Boolean(disabled))})</div>
  ),
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
    vi.mocked(apiSSE).mockReset();
    paramsId = 'app-1';
    finalizeState.finalizing = false;
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
    expect(screen.queryByText(/resume-review-editor-stub/)).not.toBeInTheDocument();
    expect(screen.queryByText('email-review-gate-stub')).not.toBeInTheDocument();
  });

  it('resolves to the resume-review step when resumeSelection is populated, even if gapReport is also present', async () => {
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({ gapReport: buildGapReport(), resumeSelection: buildResumeSelection() }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/resume-review-editor-stub/)).toBeInTheDocument(),
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
    expect(screen.queryByText(/resume-review-editor-stub/)).not.toBeInTheDocument();
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
    vi.mocked(getApplication).mockResolvedValue(
      buildApplication({ id: 'app-42', status: 'ready', resumePdfPath: '/resumes/app-42.pdf' }),
    );

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

  describe('resume downloads', () => {
    it('renders download buttons at the email step, not just ready, when resumePdfPath is set', async () => {
      vi.mocked(getApplication).mockResolvedValue(
        buildApplication({ emailDraft: buildEmailDraft(), resumePdfPath: '/resumes/app-1.pdf' }),
      );

      renderPage();

      await waitFor(() => expect(screen.getByText('email-review-gate-stub')).toBeInTheDocument());
      expect(screen.getByRole('link', { name: /download resume pdf/i })).toHaveAttribute(
        'href',
        'http://localhost:3001/api/applications/app-1/resume.pdf',
      );
    });

    it('does not render download buttons at the email step when resumePdfPath is not set', async () => {
      vi.mocked(getApplication).mockResolvedValue(
        buildApplication({ emailDraft: buildEmailDraft(), resumePdfPath: null }),
      );

      renderPage();

      await waitFor(() => expect(screen.getByText('email-review-gate-stub')).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: /download resume pdf/i })).not.toBeInTheDocument();
    });

    it('downloads the resume source with a .tex filename when renderedWith is "latex"', async () => {
      // jsdom does not implement blob URL creation/revocation.
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-source-url');
      global.URL.revokeObjectURL = vi.fn();
      let downloadedFilename = '';
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloadedFilename = this.download;
      });
      vi.mocked(getApplication).mockResolvedValue(
        buildApplication({
          emailDraft: buildEmailDraft(),
          resumePdfPath: '/resumes/app-1.pdf',
          resumeSource: '\\documentclass{article}',
          renderedWith: 'latex',
        }),
      );

      renderPage();
      await waitFor(() => expect(screen.getByText('email-review-gate-stub')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /download resume source \(\.tex\)/i }));

      expect(downloadedFilename).toBe('resume.tex');
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-source-url');
    });

    it('downloads the resume source with a .typ filename when renderedWith is "typst"', async () => {
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-source-url');
      global.URL.revokeObjectURL = vi.fn();
      let downloadedFilename = '';
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloadedFilename = this.download;
      });
      vi.mocked(getApplication).mockResolvedValue(
        buildApplication({
          emailDraft: buildEmailDraft(),
          resumePdfPath: '/resumes/app-1.pdf',
          resumeSource: '#set page(paper: "a4")',
          renderedWith: 'typst',
        }),
      );

      renderPage();
      await waitFor(() => expect(screen.getByText('email-review-gate-stub')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /download resume source \(\.typ\)/i }));

      expect(downloadedFilename).toBe('resume.typ');
    });
  });

  describe('regenerate', () => {
    it('labels the regenerate button "Re-check match & re-draft" at the gap-report step', async () => {
      vi.mocked(getApplication).mockResolvedValue(buildApplication({ gapReport: buildGapReport() }));

      renderPage();

      await waitFor(() => expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Re-check match & re-draft' })).toBeInTheDocument();
    });

    it('labels the regenerate button "Re-generate resume draft" at the resume-review step', async () => {
      vi.mocked(getApplication).mockResolvedValue(
        buildApplication({ gapReport: buildGapReport(), resumeSelection: buildResumeSelection() }),
      );

      renderPage();

      await waitFor(() =>
        expect(screen.getByText(/resume-review-editor-stub/)).toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: 'Re-generate resume draft' })).toBeInTheDocument();
    });

    it('labels the regenerate button "Re-generate resume draft" at the email-review step', async () => {
      vi.mocked(getApplication).mockResolvedValue(buildApplication({ emailDraft: buildEmailDraft() }));

      renderPage();

      await waitFor(() => expect(screen.getByText('email-review-gate-stub')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Re-generate resume draft' })).toBeInTheDocument();
    });

    it('labels the regenerate button "Re-generate resume draft" at the ready step', async () => {
      vi.mocked(getApplication).mockResolvedValue(buildApplication({ status: 'ready' }));

      renderPage();

      await waitFor(() => expect(screen.getByText('Application ready')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Re-generate resume draft' })).toBeInTheDocument();
    });

    it('posts to the regenerate/stream endpoint for the current application when the regenerate button is clicked', async () => {
      vi.mocked(apiSSE).mockReturnValue(() => {});
      vi.mocked(getApplication).mockResolvedValue(buildApplication({ gapReport: buildGapReport() }));

      renderPage();
      await waitFor(() => expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Re-check match & re-draft' }));

      expect(apiSSE).toHaveBeenCalledWith(
        '/applications/app-1/regenerate/stream',
        undefined,
        expect.objectContaining({
          onProgress: expect.any(Function),
          onDone: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('refetches the application once the regenerate stream reports done, so the review UI reflects the fresh draft', async () => {
      let options!: {
        onProgress: (step: string) => void;
        onDone: (data: unknown) => void;
        onError: (msg: string) => void;
      };
      vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
        options = opts as typeof options;
        return () => {};
      });
      vi.mocked(getApplication).mockResolvedValue(buildApplication({ gapReport: buildGapReport() }));

      renderPage();
      await waitFor(() => expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument());
      expect(getApplication).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Re-check match & re-draft' }));
      act(() => options.onDone({ applicationId: 'app-1' }));

      await waitFor(() => expect(getApplication).toHaveBeenCalledTimes(2));
    });

    it('shows the regenerate error message when the regenerate stream reports an error', async () => {
      let options!: {
        onProgress: (step: string) => void;
        onDone: (data: unknown) => void;
        onError: (msg: string) => void;
      };
      vi.mocked(apiSSE).mockImplementation((_path, _body, opts) => {
        options = opts as typeof options;
        return () => {};
      });
      vi.mocked(getApplication).mockResolvedValue(buildApplication({ gapReport: buildGapReport() }));

      renderPage();
      await waitFor(() => expect(screen.getByText('gap-report-view-stub')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Re-check match & re-draft' }));
      act(() => options.onError('HTTP 500'));

      await waitFor(() => expect(screen.getByText('HTTP 500')).toBeInTheDocument());
    });
  });

  describe('cross-disabling Regenerate and Finalize', () => {
    it('disables the Regenerate button while a finalize is in flight', async () => {
      finalizeState.finalizing = true;
      vi.mocked(getApplication).mockResolvedValue(
        buildApplication({ gapReport: buildGapReport(), resumeSelection: buildResumeSelection() }),
      );

      renderPage();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Re-generate resume draft' })).toBeDisabled(),
      );
    });

    it('passes `disabled` down to ResumeReviewEditor while a regenerate is in flight', async () => {
      vi.mocked(apiSSE).mockReturnValue(() => {});
      vi.mocked(getApplication).mockResolvedValue(
        buildApplication({ gapReport: buildGapReport(), resumeSelection: buildResumeSelection() }),
      );

      renderPage();
      await waitFor(() =>
        expect(screen.getByText(/resume-review-editor-stub \(disabled: false\)/)).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Re-generate resume draft' }));

      await waitFor(() =>
        expect(screen.getByText(/resume-review-editor-stub \(disabled: true\)/)).toBeInTheDocument(),
      );
    });
  });
});
