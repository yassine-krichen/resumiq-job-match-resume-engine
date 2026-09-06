import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobPasteForm } from './job-paste-form';
import { extractJobIntake } from './api';

vi.mock('./api', () => ({
  extractJobIntake: vi.fn(),
}));

const VALID_PASTE = 'x'.repeat(60);

function renderForm(overrides: Partial<Parameters<typeof JobPasteForm>[0]> = {}) {
  const onExtracted = vi.fn();
  const onManualFallback = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <JobPasteForm
        onExtracted={onExtracted}
        onManualFallback={onManualFallback}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onExtracted, onManualFallback, ...utils };
}

describe('JobPasteForm', () => {
  beforeEach(() => {
    vi.mocked(extractJobIntake).mockReset();
  });

  it('disables the submit button until the paste is at least 50 characters, trimmed', () => {
    renderForm();

    const submitButton = screen.getByRole('button', { name: /analyze job/i });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/job posting/i), {
      target: { value: 'too short' },
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/job posting/i), {
      target: { value: VALID_PASTE },
    });
    expect(submitButton).toBeEnabled();
  });

  it('shows a loading state while extraction is in flight', async () => {
    let resolveExtract!: (value: Awaited<ReturnType<typeof extractJobIntake>>) => void;
    vi.mocked(extractJobIntake).mockReturnValue(
      new Promise((resolve) => {
        resolveExtract = resolve;
      }),
    );
    renderForm();

    fireEvent.change(screen.getByLabelText(/job posting/i), {
      target: { value: VALID_PASTE },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    expect(await screen.findByText('Analyzing...')).toBeInTheDocument();
    expect(screen.getByLabelText(/job posting/i)).toBeDisabled();

    resolveExtract({
      title: null,
      company_name: null,
      location: null,
      remote: null,
      salary_range: null,
      company_info_summary: null,
    });
  });

  it('calls onExtracted with the raw text and the extraction result on success', async () => {
    const result = {
      title: 'Backend Engineer',
      company_name: 'Acme Corp',
      location: null,
      remote: null,
      salary_range: null,
      company_info_summary: null,
    };
    vi.mocked(extractJobIntake).mockResolvedValue(result);
    const { onExtracted } = renderForm();

    fireEvent.change(screen.getByLabelText(/job posting/i), {
      target: { value: VALID_PASTE },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(VALID_PASTE, result));
  });

  it('shows an inline error and a manual-fallback button when extraction fails', async () => {
    vi.mocked(extractJobIntake).mockRejectedValue(new Error('API 500: could not parse'));
    const { onManualFallback } = renderForm();

    fireEvent.change(screen.getByLabelText(/job posting/i), {
      target: { value: VALID_PASTE },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    expect(await screen.findByText('API 500: could not parse')).toBeInTheDocument();
    const fallbackButton = screen.getByRole('button', { name: /fill in manually instead/i });
    fireEvent.click(fallbackButton);

    expect(onManualFallback).toHaveBeenCalledWith(VALID_PASTE);
  });
});
