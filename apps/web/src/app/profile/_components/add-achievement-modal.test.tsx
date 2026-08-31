import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddAchievementModal, type NewAchievement } from './add-achievement-modal';

function renderModal(props: Partial<{ submitting: boolean }> = {}) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const utils = render(<AddAchievementModal onAdd={onAdd} submitting={props.submitting} />);
  return { onAdd, ...utils };
}

function openModal() {
  fireEvent.click(screen.getByRole('button', { name: /add achievement/i }));
}

describe('AddAchievementModal', () => {
  it('disables the submit button until a title is entered', () => {
    renderModal();
    openModal();

    expect(screen.getByRole('button', { name: /^add achievement$/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Employee of the Year' } });

    expect(screen.getByRole('button', { name: /^add achievement$/i })).not.toBeDisabled();
  });

  it('submits the trimmed field values, splits related skills on commas, and always sends an empty issuer', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: '  Employee of the Year  ' } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: ' 2024-03 ' } });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: ' Recognized for outstanding delivery. ' },
    });
    fireEvent.change(screen.getByLabelText(/related skills/i), {
      target: { value: ' Leadership, Communication ,  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add achievement$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({
      title: 'Employee of the Year',
      issuer: '',
      date: '2024-03',
      description: 'Recognized for outstanding delivery.',
      related_skills: ['Leadership', 'Communication'],
    });
  });

  it('resets the form and closes the dialog after a successful submit', async () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Employee of the Year' } });
    fireEvent.click(screen.getByRole('button', { name: /^add achievement$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    // The dialog closes only once the (awaited) save resolves successfully.
    await waitFor(() => expect(screen.queryByLabelText(/^title/i)).not.toBeInTheDocument());

    openModal();
    expect(screen.getByLabelText(/title/i)).toHaveValue('');
    expect(screen.getByLabelText(/date/i)).toHaveValue('');
  });

  it('keeps the dialog open with the entered data intact and shows an error when the save fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('API 500: could not save achievement'));
    render(<AddAchievementModal onAdd={onAdd} />);
    openModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Employee of the Year' } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2024-03' } });
    fireEvent.click(screen.getByRole('button', { name: /^add achievement$/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save achievement')).toBeInTheDocument(),
    );
    // The dialog is still open with the typed data intact — nothing to retype.
    expect(screen.getByLabelText(/title/i)).toHaveValue('Employee of the Year');
    expect(screen.getByLabelText(/date/i)).toHaveValue('2024-03');
  });

  it('shows the "Adding..." label for the full duration of an in-flight save, then reverts once it resolves', async () => {
    let resolveAdd!: () => void;
    const onAdd = vi.fn((achievement: NewAchievement) => {
      void achievement;
      return new Promise<void>((resolve) => {
        resolveAdd = resolve;
      });
    });

    function Harness() {
      const [submitting, setSubmitting] = useState(false);
      return (
        <AddAchievementModal
          submitting={submitting}
          onAdd={async (achievement) => {
            setSubmitting(true);
            try {
              await onAdd(achievement);
            } finally {
              setSubmitting(false);
            }
          }}
        />
      );
    }

    render(<Harness />);
    openModal();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Employee of the Year' } });
    fireEvent.click(screen.getByRole('button', { name: /^add achievement$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /adding\.\.\./i })).toBeDisabled(),
    );

    resolveAdd();

    await waitFor(() => expect(screen.queryByLabelText(/^title/i)).not.toBeInTheDocument());
  });

  it('does not call onAdd when the title is only whitespace', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: '   ' } });

    // The submit button stays disabled — nothing to click, nothing to submit.
    expect(screen.getByRole('button', { name: /^add achievement$/i })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shows the "Adding..." label and disables submit while a save is in flight', () => {
    renderModal({ submitting: true });
    openModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Employee of the Year' } });

    expect(screen.getByRole('button', { name: /adding\.\.\./i })).toBeDisabled();
  });
});
