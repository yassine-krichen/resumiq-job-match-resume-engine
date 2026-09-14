import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddProjectModal, type NewProject } from './add-project-modal';

const EMPTY_ENTRY: NewProject = {
  name: '',
  context: '',
  links: [],
  startDate: '',
  endDate: '',
  technologies_used: [],
  raw_achievements: [],
  quantifiable_metrics: [],
};

const EXISTING_ENTRY: NewProject = {
  name: 'Resumiq',
  context: 'AI resume tailoring tool',
  links: [{ type: 'github', url: 'https://github.com/example/resumiq' }],
  startDate: '2023-01',
  endDate: '2023-06',
  technologies_used: ['TypeScript', 'NestJS'],
  raw_achievements: ['Shipped v1'],
  quantifiable_metrics: ['500 users in month 1'],
};

function renderModal(props: Partial<{ submitting: boolean; entry: NewProject; onDelete: () => Promise<void> }> = {}) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <AddProjectModal
      onAdd={onAdd}
      submitting={props.submitting}
      entry={props.entry}
      onDelete={props.onDelete}
    />,
  );
  return { onAdd, ...utils };
}

function openModal(triggerName: RegExp = /^\+ add project$/i) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
}

describe('AddProjectModal', () => {
  it('renders empty fields in add mode', () => {
    renderModal();
    openModal();

    expect(screen.getByLabelText(/^name/i)).toHaveValue(EMPTY_ENTRY.name);
    expect(screen.getByLabelText(/context/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^add project$/i })).toBeDisabled();
  });

  it('renders pre-filled fields in edit mode from the entry prop', () => {
    renderModal({ entry: EXISTING_ENTRY });
    openModal(/^edit$/i);

    expect(screen.getByLabelText(/^name/i)).toHaveValue('Resumiq');
    expect(screen.getByLabelText(/context/i)).toHaveValue('AI resume tailoring tool');
    expect(screen.getByLabelText(/technologies used/i)).toHaveValue('TypeScript\nNestJS');
    expect(screen.getByLabelText(/key achievements/i)).toHaveValue('Shipped v1');
    expect(screen.getByLabelText(/quantifiable metrics/i)).toHaveValue('500 users in month 1');
    expect(screen.getByRole('button', { name: /^save changes$/i })).not.toBeDisabled();
  });

  it('submits trimmed values, parses newline-delimited lists into arrays, and preserves the existing entry.links untouched (no UI to edit them)', () => {
    const { onAdd } = renderModal({ entry: EXISTING_ENTRY });
    openModal(/^edit$/i);

    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Resumiq',
        links: EXISTING_ENTRY.links,
      }),
    );
  });

  it('submits an empty links array in add mode, since add mode has no entry to preserve links from', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Project' } });
    fireEvent.click(screen.getByRole('button', { name: /^add project$/i }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ links: [] }));
  });

  it('shows a validation error and keeps the dialog open when context exceeds its max length, without calling onAdd', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Project' } });
    fireEvent.change(screen.getByLabelText(/context/i), { target: { value: 'a'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: /^add project$/i }));

    expect(screen.getByText('Context must be 2000 characters or fewer.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled until a name is entered', () => {
    renderModal();
    openModal();

    const submit = screen.getByRole('button', { name: /^add project$/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Project' } });
    expect(submit).not.toBeDisabled();
  });

  it('resets to empty fields and closes after a successful add-mode submit', async () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Project' } });
    fireEvent.click(screen.getByRole('button', { name: /^add project$/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/^name/i)).not.toBeInTheDocument());

    openModal();
    expect(screen.getByLabelText(/^name/i)).toHaveValue('');
  });

  it('shows an error message and keeps the dialog open with the entered data when the save fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('API 500: could not save project'));
    render(<AddProjectModal onAdd={onAdd} />);
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Project' } });
    fireEvent.click(screen.getByRole('button', { name: /^add project$/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save project')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/^name/i)).toHaveValue('New Project');
  });

  it('calls onDelete when the Delete button is clicked in edit mode', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderModal({ entry: EXISTING_ENTRY, onDelete });
    openModal(/^edit$/i);

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/^name/i)).not.toBeInTheDocument());
  });

  it('does not render a Delete button in add mode', () => {
    renderModal();
    openModal();

    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });
});
