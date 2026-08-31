import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ApplicationsPage from './page';
import { getApplications } from './_components/api';
import type { ApplicationListItem, ListApplicationsResult } from './_components/types';

// `./_components/api` wraps `apiFetch` from `@/lib/api` — mock it directly
// so these tests exercise the page's filter/pagination round-trip without
// hitting the network. FiltersBar and ApplicationsTable are rendered for
// real (each is simple, presentational logic with no independent hook of
// its own) so this suite proves the actual wiring between them and the page.
vi.mock('./_components/api', () => ({
  getApplications: vi.fn(),
}));

function buildItem(overrides: Partial<ApplicationListItem> = {}): ApplicationListItem {
  return {
    id: 'app-1',
    status: 'ready',
    matchScore: 82,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    job: { id: 'job-1', title: 'Backend Engineer', companyName: 'Acme Corp', location: 'Berlin' },
    ...overrides,
  };
}

function buildResult(
  items: ApplicationListItem[] = [buildItem()],
  overrides: Partial<ListApplicationsResult> = {},
): ListApplicationsResult {
  return { total: items.length, page: 1, pageSize: 20, items, ...overrides };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApplicationsPage />
    </QueryClientProvider>,
  );
}

describe('ApplicationsPage', () => {
  beforeEach(() => {
    vi.mocked(getApplications).mockReset();
    vi.mocked(getApplications).mockResolvedValue(buildResult());
  });

  it('shows the loading message while the initial page is being fetched', () => {
    vi.mocked(getApplications).mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading applications...')).toBeInTheDocument();
  });

  it('shows the fetch error message when GET /applications fails', async () => {
    vi.mocked(getApplications).mockRejectedValue(new Error('API 500: applications unavailable'));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('API 500: applications unavailable')).toBeInTheDocument(),
    );
  });

  it('renders the empty-state message when no applications match the current filters', async () => {
    vi.mocked(getApplications).mockResolvedValue(buildResult([]));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('No applications match these filters.')).toBeInTheDocument(),
    );
  });

  it('renders a row per application with its title linking to the application detail page, company, date, match score, and status', async () => {
    vi.mocked(getApplications).mockResolvedValue(
      buildResult([
        buildItem({
          id: 'app-7',
          status: 'gap_reported',
          matchScore: 82,
          createdAt: '2026-01-15T00:00:00.000Z',
          job: { id: 'job-7', title: 'Backend Engineer', companyName: 'Acme Corp', location: 'Berlin' },
        }),
      ]),
    );

    renderPage();

    const link = await screen.findByRole('link', { name: 'Backend Engineer' });
    expect(link).toHaveAttribute('href', '/applications/app-7');
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('Acme Corp')).toBeInTheDocument();
    expect(within(row).getByText('82')).toBeInTheDocument();
    expect(within(row).getByText('Gap reported')).toBeInTheDocument();
  });

  it('badges a high match score (>=70) and a low match score (<50) with visually distinct classes', async () => {
    vi.mocked(getApplications).mockResolvedValue(
      buildResult([
        buildItem({ id: 'app-high', matchScore: 85, job: { id: 'j1', title: 'Strong Match', companyName: 'A', location: null } }),
        buildItem({ id: 'app-low', matchScore: 20, job: { id: 'j2', title: 'Weak Match', companyName: 'B', location: null } }),
      ]),
    );

    renderPage();

    await screen.findByText('85');
    expect(screen.getByText('85')).toHaveClass('bg-emerald-100');
    expect(screen.getByText('20')).toHaveClass('bg-red-100');
  });

  it('resets to page 1 and refetches with the new filters when "Apply filters" is clicked, even after paging forward', async () => {
    vi.mocked(getApplications).mockResolvedValue(
      buildResult([buildItem()], { total: 40, page: 1 }),
    );

    renderPage();
    await screen.findByRole('link', { name: 'Backend Engineer' });

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() =>
      expect(getApplications).toHaveBeenLastCalledWith(expect.anything(), 2),
    );

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'ready' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    await waitFor(() =>
      expect(getApplications).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'ready' }),
        1,
      ),
    );
  });

  it('disables "Previous" on the first page and enables it once paged forward', async () => {
    vi.mocked(getApplications).mockResolvedValue(buildResult([buildItem()], { total: 40, page: 1 }));

    renderPage();
    await screen.findByRole('link', { name: 'Backend Engineer' });

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() => expect(getApplications).toHaveBeenLastCalledWith(expect.anything(), 2));

    expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled();
  });

  it('disables "Next" once the last page is reached', async () => {
    // 20 items on a 20-per-page listing is exactly one full page — no next page.
    vi.mocked(getApplications).mockResolvedValue(buildResult([buildItem()], { total: 20, page: 1 }));

    renderPage();
    await screen.findByRole('link', { name: 'Backend Engineer' });

    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('computes total pages from the API-returned pageSize, not the frontend page-size constant', async () => {
    // pageSize of 10 (not the 20-item frontend constant) with 25 total should
    // yield 3 pages — using the frontend constant instead would wrongly say 2.
    vi.mocked(getApplications).mockResolvedValue(
      buildResult([buildItem()], { total: 25, page: 1, pageSize: 10 }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Page 1 of 3 (25 total)')).toBeInTheDocument());
  });

  it('shows an "Updating..." indicator while a new page/filter request is in flight, using the previous data in the meantime', async () => {
    vi.mocked(getApplications).mockResolvedValue(buildResult([buildItem()], { total: 40, page: 1 }));

    renderPage();
    await screen.findByRole('link', { name: 'Backend Engineer' });

    let resolveNextPage!: (value: ReturnType<typeof buildResult>) => void;
    vi.mocked(getApplications).mockReturnValue(
      new Promise((resolve) => {
        resolveNextPage = resolve;
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    // Previous page's row is still shown (keepPreviousData), but flagged stale.
    await waitFor(() => expect(screen.getByText(/Updating\.\.\./)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Backend Engineer' })).toBeInTheDocument();

    resolveNextPage(buildResult([buildItem()], { total: 40, page: 2 }));

    await waitFor(() => expect(screen.queryByText(/Updating\.\.\./)).not.toBeInTheDocument());
  });
});
