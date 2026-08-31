import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilterBar } from './filter-bar';
import { updateJobsSettings } from './api';
import type { DiscoverFilters, UserSettings } from './types';

// `./api` wraps `apiFetch` from `@/lib/api` — mock it directly so these
// tests exercise FilterBar's filter/persist logic without hitting the network.
vi.mock('./api', () => ({
  updateJobsSettings: vi.fn(),
}));

function renderBar(filters: DiscoverFilters = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <FilterBar filters={filters} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange, ...utils };
}

describe('FilterBar', () => {
  beforeEach(() => {
    vi.mocked(updateJobsSettings).mockReset();
    vi.mocked(updateJobsSettings).mockResolvedValue({} as UserSettings);
  });

  it('splits and trims comma-separated category tags before calling onChange', () => {
    const { onChange } = renderBar();

    fireEvent.change(screen.getByLabelText(/category \/ field/i), {
      target: { value: ' backend, data ,  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ category_tags: ['backend', 'data'] }),
    );
  });

  it('includes every checked work-mode value in the onChange payload', () => {
    const { onChange } = renderBar();

    fireEvent.click(screen.getByLabelText('remote'));
    fireEvent.click(screen.getByLabelText('hybrid'));
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ work_mode: ['remote', 'hybrid'] }),
    );
  });

  it('unchecking a previously-checked work mode removes it from the onChange payload', () => {
    const { onChange } = renderBar();

    fireEvent.click(screen.getByLabelText('remote'));
    fireEvent.click(screen.getByLabelText('remote'));
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ work_mode: [] }));
  });

  it('omits empty location/seniority from the onChange payload rather than sending blank strings', () => {
    const { onChange } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    const [payload] = onChange.mock.calls[0];
    expect(payload.location).toBeUndefined();
    expect(payload.seniority).toBeUndefined();
  });

  it('trims a filled-in location before sending it in the onChange payload', () => {
    const { onChange } = renderBar();

    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: '  Berlin  ' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ location: 'Berlin' }));
  });

  it('persists only category_tags and work_mode via PATCH /jobs/settings — location and seniority stay session-only', async () => {
    renderBar();

    fireEvent.change(screen.getByLabelText(/category \/ field/i), { target: { value: 'backend' } });
    fireEvent.click(screen.getByLabelText('remote'));
    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText(/seniority/i), { target: { value: 'Senior' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    await waitFor(() => expect(updateJobsSettings).toHaveBeenCalledTimes(1));
    expect(updateJobsSettings).toHaveBeenCalledWith(
      {
        category_tags: ['backend'],
        work_mode: ['remote'],
      },
      expect.anything(),
    );
  });

  it('shows an error message when persisting filter settings fails, without blocking the onChange callback', async () => {
    vi.mocked(updateJobsSettings).mockRejectedValue(new Error('API 500: failed'));
    const { onChange } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    await screen.findByText("Couldn't save filter preferences.");
  });

  it('seeds the category/work-mode inputs from the filters prop passed in on mount', () => {
    renderBar({ category_tags: ['data', 'ml'], work_mode: ['remote'] });

    expect(screen.getByLabelText(/category \/ field/i)).toHaveValue('data, ml');
    expect(screen.getByLabelText('remote')).toBeChecked();
  });
});
