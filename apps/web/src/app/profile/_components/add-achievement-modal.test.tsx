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
    // Opened while not submitting (matching real usage, where the trigger
    // is only disabled once a save is in flight), then re-rendered with
    // `submitting: true` to simulate that save starting.
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<AddAchievementModal onAdd={onAdd} submitting={false} />);
    openModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Employee of the Year' } });
    rerender(<AddAchievementModal onAdd={onAdd} submitting={true} />);

    expect(screen.getByRole('button', { name: /adding\.\.\./i })).toBeDisabled();
  });

  it('rejects a title over 200 characters with a validation message and does not call onAdd', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'a'.repeat(201) } });
    fireEvent.click(screen.getByRole('button', { name: /^add achievement$/i }));

    expect(screen.getByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

const EXISTING_ACHIEVEMENT: NewAchievement = {
  title: 'Employee of the Year',
  issuer: 'Acme Corp',
  date: '2023-01',
  description: 'Recognized company-wide.',
  related_skills: ['Leadership', 'Communication'],
};

describe('AddAchievementModal edit mode', () => {
  function renderEditModal(
    props: Partial<{ submitting: boolean; onDelete: () => Promise<void> }> = {},
  ) {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onDelete = props.onDelete ?? vi.fn().mockResolvedValue(undefined);
    const utils = render(
      <AddAchievementModal
        onAdd={onAdd}
        submitting={props.submitting}
        entry={EXISTING_ACHIEVEMENT}
        onDelete={onDelete}
      />,
    );
    return { onAdd, onDelete, ...utils };
  }

  function openEditModal() {
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
  }

  it('renders pre-filled fields from the entry prop, including issuer which has no input of its own', () => {
    renderEditModal();
    openEditModal();

    expect(screen.getByLabelText(/title/i)).toHaveValue('Employee of the Year');
    expect(screen.getByLabelText(/date/i)).toHaveValue('2023-01');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Recognized company-wide.');
    expect(screen.getByLabelText(/related skills/i)).toHaveValue('Leadership, Communication');
    expect(screen.getByText('Edit achievement')).toBeInTheDocument();
  });

  it('submits the edited fields while preserving the original (form-less) issuer value', () => {
    const { onAdd } = renderEditModal();
    openEditModal();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Employee of the Quarter' } });
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Employee of the Quarter',
      issuer: 'Acme Corp',
      date: '2023-01',
      description: 'Recognized company-wide.',
      related_skills: ['Leadership', 'Communication'],
    });
  });

  it('calls onDelete and closes the dialog when the Delete button is clicked', async () => {
    const { onDelete } = renderEditModal();
    openEditModal();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument());
  });

  it('shows an error and keeps the dialog open when onDelete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('API 500: could not delete achievement'));
    renderEditModal({ onDelete });
    openEditModal();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not delete achievement')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });

  it('does not render a Delete button when onDelete is not provided, even in edit mode', () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddAchievementModal onAdd={onAdd} entry={EXISTING_ACHIEVEMENT} />);
    openEditModal();

    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });
});
