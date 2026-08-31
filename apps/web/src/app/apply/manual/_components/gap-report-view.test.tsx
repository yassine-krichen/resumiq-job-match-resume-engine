import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GapReportView } from './gap-report-view';
import { saveGapReport } from './api';
import { buildApplication, buildGapReport } from './test-fixtures';

vi.mock('./api', () => ({
  saveGapReport: vi.fn(),
}));

function renderView(gapReport = buildGapReport()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GapReportView applicationId="app-1" gapReport={gapReport} />
    </QueryClientProvider>,
  );
}

describe('GapReportView', () => {
  beforeEach(() => {
    vi.mocked(saveGapReport).mockReset();
    vi.mocked(saveGapReport).mockResolvedValue(buildApplication());
  });

  it('renders missing skills with their priority, strengths, and recommendations', () => {
    renderView(
      buildGapReport({
        missing_skills: [
          {
            skill: 'Kubernetes',
            priority: 'mandatory',
            suggested_resources: ['Kubernetes docs'],
            completed: false,
          },
        ],
        strengths: ['Strong TypeScript background'],
        recommendations: ['Add a Kubernetes project to your portfolio'],
      }),
    );

    expect(screen.getByText('Kubernetes')).toBeInTheDocument();
    expect(screen.getByText('mandatory')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes docs')).toBeInTheDocument();
    expect(screen.getByText('Strong TypeScript background')).toBeInTheDocument();
    expect(screen.getByText('Add a Kubernetes project to your portfolio')).toBeInTheDocument();
  });

  it('shows a fallback message when there are no missing skills', () => {
    renderView(buildGapReport({ missing_skills: [] }));

    expect(screen.getByText('No specific gaps identified.')).toBeInTheDocument();
  });

  it('saves the updated gap report with the skill marked completed when its checkbox is checked', async () => {
    renderView(
      buildGapReport({
        missing_skills: [
          {
            skill: 'Kubernetes',
            priority: 'mandatory',
            suggested_resources: [],
            completed: false,
          },
        ],
      }),
    );

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(saveGapReport).toHaveBeenCalledTimes(1));
    expect(saveGapReport).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({
        missing_skills: [expect.objectContaining({ skill: 'Kubernetes', completed: true })],
      }),
    );
  });

  it('shows the save error message when persisting the gap report fails', async () => {
    vi.mocked(saveGapReport).mockRejectedValue(new Error('API 500: could not save'));
    renderView(
      buildGapReport({
        missing_skills: [
          { skill: 'Kubernetes', priority: 'mandatory', suggested_resources: [], completed: false },
        ],
      }),
    );

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save')).toBeInTheDocument(),
    );
  });
});
