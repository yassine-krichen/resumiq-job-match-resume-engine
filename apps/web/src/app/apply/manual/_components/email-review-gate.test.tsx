import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmailReviewGate } from './email-review-gate';
import { confirmApplication, saveEmailDraft } from './api';
import { buildApplication, buildEmailDraft } from './test-fixtures';

vi.mock('./api', () => ({
  saveEmailDraft: vi.fn(),
  confirmApplication: vi.fn(),
}));

function renderGate(draft = buildEmailDraft()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailReviewGate applicationId="app-1" draft={draft} />
    </QueryClientProvider>,
  );
}

describe('EmailReviewGate', () => {
  beforeEach(() => {
    vi.mocked(saveEmailDraft).mockReset();
    vi.mocked(confirmApplication).mockReset();
    vi.mocked(saveEmailDraft).mockResolvedValue(buildApplication());
    vi.mocked(confirmApplication).mockResolvedValue(buildApplication({ status: 'ready' }));
  });

  it('renders the draft subject and body as editable fields', () => {
    renderGate(buildEmailDraft({ subject: 'Hello Acme', body: 'Dear hiring manager,' }));

    expect(screen.getByLabelText(/subject/i)).toHaveValue('Hello Acme');
    expect(screen.getByLabelText(/body/i)).toHaveValue('Dear hiring manager,');
  });

  it('saves the edited subject and body when "Save draft" is clicked', async () => {
    renderGate(buildEmailDraft({ subject: 'Original subject', body: 'Original body' }));

    fireEvent.change(screen.getByLabelText(/subject/i), {
      target: { value: 'Edited subject' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(saveEmailDraft).toHaveBeenCalledTimes(1));
    expect(saveEmailDraft).toHaveBeenCalledWith('app-1', {
      subject: 'Edited subject',
      body: 'Original body',
    });
    expect(confirmApplication).not.toHaveBeenCalled();
  });

  it('saves the draft and then confirms the application when "Confirm" is clicked', async () => {
    renderGate();

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(saveEmailDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmApplication).toHaveBeenCalledWith('app-1'));
  });

  it('shows the error message when saving the draft fails', async () => {
    vi.mocked(saveEmailDraft).mockRejectedValue(new Error('API 500: could not save draft'));
    renderGate();

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save draft')).toBeInTheDocument(),
    );
  });
});
