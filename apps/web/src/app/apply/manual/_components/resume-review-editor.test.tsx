import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResumeReviewEditor } from './resume-review-editor';
import { renderResumePreview, saveResumeSelection } from './api';
import { buildApplication, buildResumeSelection } from './test-fixtures';
import type { ResumeSelection } from './types';

vi.mock('./api', () => ({
  renderResumePreview: vi.fn(),
  saveResumeSelection: vi.fn(),
}));

function renderEditor(selection: ResumeSelection = buildResumeSelection()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFinalize = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ResumeReviewEditor
        applicationId="app-1"
        selection={selection}
        onFinalize={onFinalize}
        finalizing={false}
        progress=""
        error=""
      />
    </QueryClientProvider>,
  );
  return { onFinalize, ...utils };
}

// Finds the icon-only reorder/delete buttons scoped to a bullet card by the
// lucide icon's stable class name — these buttons have no accessible text,
// only an icon (a real gap in the component's accessibility, but not this
// suite's job to fix).
function iconButtonsWithin(container: HTMLElement, iconClass: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<SVGSVGElement>(`svg.${iconClass}`)).map(
    (svg) => svg.closest('button') as HTMLButtonElement,
  );
}

describe('ResumeReviewEditor', () => {
  beforeEach(() => {
    vi.mocked(renderResumePreview).mockReset();
    vi.mocked(saveResumeSelection).mockReset();
    vi.mocked(renderResumePreview).mockResolvedValue({ pdf: btoa('fake-pdf-bytes'), pageCount: 1 });
    vi.mocked(saveResumeSelection).mockResolvedValue(buildApplication());
    // jsdom does not implement blob URL creation/revocation.
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-preview-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('debounced live preview', () => {
    it('does not call renderResumePreview on every keystroke, only once after the debounce window elapses', async () => {
      vi.useFakeTimers();
      renderEditor();

      const summaryField = screen.getByLabelText('Summary');

      act(() => {
        vi.advanceTimersByTime(200);
      });
      fireEvent.change(summaryField, { target: { value: 'Backend engineer with A.' } });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      fireEvent.change(summaryField, { target: { value: 'Backend engineer with AB.' } });

      // Still within the 800ms debounce window since the last edit — no call yet.
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(renderResumePreview).not.toHaveBeenCalled();

      // Crossing the 800ms debounce window since the last edit fires exactly one call.
      // The debounce timer callback kicks off an async renderResumePreview() call whose
      // .then()/.finally() handlers resolve as microtasks — advanceTimersByTimeAsync (awaited
      // inside an async act()) lets those microtasks flush before we assert, keeping the
      // resulting state updates (setPreviewUrl, setPreviewLoading) inside React's act boundary.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(renderResumePreview).toHaveBeenCalledTimes(1);
      expect(renderResumePreview).toHaveBeenCalledWith(
        'app-1',
        expect.objectContaining({ summary: 'Backend engineer with AB.' }),
      );
    });

    it('renders the preview iframe once the debounced render-preview call resolves', async () => {
      renderEditor();

      // The 800ms debounce runs on real timers here — give waitFor enough headroom.
      await waitFor(() => expect(renderResumePreview).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      await waitFor(() => expect(screen.getByTitle('Resume preview')).toBeInTheDocument(), {
        timeout: 2000,
      });
    });

    it('shows the preview error message when render-preview fails', async () => {
      vi.mocked(renderResumePreview).mockRejectedValue(new Error('API 500: render failed'));
      renderEditor();

      await waitFor(
        () => expect(screen.getByText('API 500: render failed')).toBeInTheDocument(),
        { timeout: 2000 },
      );
    });

    it('keeps the latest edit preview even when an earlier, slower in-flight response resolves after it', async () => {
      const STALE_PDF_CONTENT = 'stale-first-request-pdf-bytes'; // 30 chars
      const LATEST_PDF_CONTENT = 'fresh-second-request-pdf'; // 24 chars — different length so blob.size differs

      vi.mocked(renderResumePreview).mockImplementation((_appId, selection) => {
        if (selection.summary === 'first edit (slow response)') {
          // Fired first, but its response is deliberately the slowest to arrive.
          return new Promise((resolve) =>
            setTimeout(() => resolve({ pdf: btoa(STALE_PDF_CONTENT), pageCount: 1 }), 5000),
          );
        }
        if (selection.summary === 'second edit (fast response)') {
          // Fired second, but resolves well before the first request's response.
          return new Promise((resolve) =>
            setTimeout(() => resolve({ pdf: btoa(LATEST_PDF_CONTENT), pageCount: 1 }), 100),
          );
        }
        return Promise.resolve({ pdf: btoa('initial-mount-pdf'), pageCount: 1 });
      });
      // Real createObjectURL/Blob would need async reads to inspect content; blob.size
      // is available synchronously and the two payloads above have different lengths,
      // so encoding it in the fake URL lets the test tell the two responses apart.
      global.URL.createObjectURL = vi.fn((blob: Blob) => `blob:preview-size-${blob.size}`);

      vi.useFakeTimers();
      renderEditor();

      const summaryField = screen.getByLabelText('Summary');

      // Edit #1 fires its debounced request first (before the 800ms debounce window
      // has any chance to elapse from the initial mount, cancelling that call).
      fireEvent.change(summaryField, { target: { value: 'first edit (slow response)' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });
      expect(renderResumePreview).toHaveBeenCalledTimes(1);

      // Edit #2 fires a second, later request while edit #1's response is still pending.
      fireEvent.change(summaryField, { target: { value: 'second edit (fast response)' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });
      expect(renderResumePreview).toHaveBeenCalledTimes(2);

      // Edit #2's response (100ms delay) resolves well before edit #1's (5000ms delay).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      const iframe = screen.getByTitle('Resume preview');
      expect(iframe).toHaveAttribute('src', `blob:preview-size-${LATEST_PDF_CONTENT.length}`);

      // Now let edit #1's stale response finally arrive. Without the request-id guard,
      // this unconditionally overwrites previewUrl with the stale response, clobbering
      // the newer preview even though it belongs to an edit the user already moved past.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(screen.getByTitle('Resume preview')).toHaveAttribute(
        'src',
        `blob:preview-size-${LATEST_PDF_CONTENT.length}`,
      );
      // The stale response must never reach the point of building a preview blob at all.
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  describe('section toggles', () => {
    it('excludes a section from the saved selection once its switch is turned off', async () => {
      renderEditor(
        buildResumeSelection({ section_order: ['summary', 'experience', 'skills'] }),
      );

      const experienceRow = screen.getByText('Experience').closest('li') as HTMLElement;
      const experienceSwitch = within(experienceRow).getByRole('switch');
      expect(experienceSwitch).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(experienceSwitch);

      await waitFor(() => {
        const movedRow = screen.getByText('Experience').closest('li') as HTMLElement;
        expect(within(movedRow).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      });

      fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

      await waitFor(() => expect(saveResumeSelection).toHaveBeenCalledTimes(1));
      const [, savedSelection] = vi.mocked(saveResumeSelection).mock.calls[0];
      expect(savedSelection.section_order).not.toContain('experience');
    });

    it('re-includes a disabled section in the saved selection once its switch is turned back on', async () => {
      renderEditor(buildResumeSelection({ section_order: ['summary', 'skills'] }));

      const experienceRow = screen.getByText('Experience').closest('li') as HTMLElement;
      expect(within(experienceRow).getByRole('switch')).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(within(experienceRow).getByRole('switch'));
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

      await waitFor(() => expect(saveResumeSelection).toHaveBeenCalledTimes(1));
      const [, savedSelection] = vi.mocked(saveResumeSelection).mock.calls[0];
      expect(savedSelection.section_order).toContain('experience');
    });
  });

  describe('bullet editing controls', () => {
    function experienceCard() {
      return screen
        .getByRole('heading', { name: 'Backend Engineer @ Acme Corp' })
        .closest('div') as HTMLElement;
    }

    it('adds a new empty bullet when "Add bullet" is clicked', () => {
      renderEditor(
        buildResumeSelection({
          experience: [{ company: 'Acme Corp', role: 'Backend Engineer', bullets: ['Built the thing.'] }],
        }),
      );

      const card = experienceCard();
      expect(within(card).getAllByRole('textbox')).toHaveLength(1);

      fireEvent.click(within(card).getByRole('button', { name: /add bullet/i }));

      const textboxes = within(card).getAllByRole('textbox');
      expect(textboxes).toHaveLength(2);
      expect(textboxes[1]).toHaveValue('');
    });

    it('removes the bullet whose delete control is clicked', () => {
      renderEditor(
        buildResumeSelection({
          experience: [
            {
              company: 'Acme Corp',
              role: 'Backend Engineer',
              bullets: ['Built the thing.', 'Scaled the other thing.'],
            },
          ],
        }),
      );

      const card = experienceCard();
      const [deleteFirst] = iconButtonsWithin(card, 'lucide-trash-2');
      fireEvent.click(deleteFirst);

      const textboxes = within(card).getAllByRole('textbox');
      expect(textboxes).toHaveLength(1);
      expect(textboxes[0]).toHaveValue('Scaled the other thing.');
    });

    it('swaps two bullets in order when the down-arrow control is clicked on the first bullet', () => {
      renderEditor(
        buildResumeSelection({
          experience: [
            {
              company: 'Acme Corp',
              role: 'Backend Engineer',
              bullets: ['First bullet.', 'Second bullet.'],
            },
          ],
        }),
      );

      const card = experienceCard();
      const [moveFirstDown] = iconButtonsWithin(card, 'lucide-arrow-down');
      fireEvent.click(moveFirstDown);

      const textboxes = within(card).getAllByRole('textbox');
      expect(textboxes[0]).toHaveValue('Second bullet.');
      expect(textboxes[1]).toHaveValue('First bullet.');
    });
  });
});
