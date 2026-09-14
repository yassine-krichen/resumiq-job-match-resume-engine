import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddEducationModal, type NewEducation } from './add-education-modal';

const EMPTY_ENTRY: NewEducation = {
  institution: '',
  degree_type: '',
  major: '',
  minor: '',
  location: '',
  startDate: '',
  endDate: '',
  gpa: '',
  honors: [],
  relevant_coursework: [],
  thesis_or_capstone: '',
  extracurriculars: [],
  description: '',
};

const EXISTING_ENTRY: NewEducation = {
  institution: 'MIT',
  degree_type: "Bachelor's",
  major: 'Computer Science',
  minor: 'Mathematics',
  location: 'Cambridge, MA',
  startDate: '2018-09',
  endDate: '2022-06',
  gpa: '3.9',
  honors: ['Dean\'s List'],
  relevant_coursework: ['Algorithms', 'Distributed Systems'],
  thesis_or_capstone: 'Efficient graph algorithms',
  extracurriculars: ['Robotics Club'],
  description: 'Focused on systems and algorithms.',
};

function renderModal(props: Partial<{ submitting: boolean; entry: NewEducation; onDelete: () => Promise<void> }> = {}) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <AddEducationModal
      onAdd={onAdd}
      submitting={props.submitting}
      entry={props.entry}
      onDelete={props.onDelete}
    />,
  );
  return { onAdd, ...utils };
}

function openModal(triggerName: RegExp = /^\+ add education$/i) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
}

describe('AddEducationModal', () => {
  it('renders empty fields in add mode', () => {
    renderModal();
    openModal();

    expect(screen.getByLabelText(/^institution/i)).toHaveValue(EMPTY_ENTRY.institution);
    expect(screen.getByLabelText(/degree type/i)).toHaveValue('');
    expect(screen.getByLabelText(/^major/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^add education$/i })).toBeDisabled();
  });

  it('renders pre-filled fields in edit mode from the entry prop', () => {
    renderModal({ entry: EXISTING_ENTRY });
    openModal(/^edit$/i);

    expect(screen.getByLabelText(/^institution/i)).toHaveValue('MIT');
    expect(screen.getByLabelText(/degree type/i)).toHaveValue("Bachelor's");
    expect(screen.getByLabelText(/^major/i)).toHaveValue('Computer Science');
    expect(screen.getByLabelText(/^minor/i)).toHaveValue('Mathematics');
    expect(screen.getByLabelText(/gpa/i)).toHaveValue('3.9');
    expect(screen.getByLabelText(/honors/i)).toHaveValue("Dean's List");
    expect(screen.getByLabelText(/relevant coursework/i)).toHaveValue('Algorithms\nDistributed Systems');
    expect(screen.getByLabelText(/extracurriculars/i)).toHaveValue('Robotics Club');
    expect(screen.getByLabelText(/thesis/i)).toHaveValue('Efficient graph algorithms');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Focused on systems and algorithms.');
    expect(screen.getByRole('button', { name: /^save changes$/i })).not.toBeDisabled();
  });

  it('submits trimmed values with newline-delimited lists parsed back into arrays', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^institution/i), { target: { value: ' MIT ' } });
    fireEvent.change(screen.getByLabelText(/degree type/i), { target: { value: " Bachelor's " } });
    fireEvent.change(screen.getByLabelText(/^major/i), { target: { value: ' Computer Science ' } });
    fireEvent.change(screen.getByLabelText(/honors/i), { target: { value: " Dean's List \n" } });
    fireEvent.click(screen.getByRole('button', { name: /^add education$/i }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        institution: 'MIT',
        degree_type: "Bachelor's",
        major: 'Computer Science',
        honors: ["Dean's List"],
      }),
    );
  });

  it('shows a validation error and keeps the dialog open when GPA exceeds its max length, without calling onAdd', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^institution/i), { target: { value: 'MIT' } });
    fireEvent.change(screen.getByLabelText(/degree type/i), { target: { value: "Bachelor's" } });
    fireEvent.change(screen.getByLabelText(/^major/i), { target: { value: 'Computer Science' } });
    fireEvent.change(screen.getByLabelText(/gpa/i), { target: { value: 'a'.repeat(21) } });
    fireEvent.click(screen.getByRole('button', { name: /^add education$/i }));

    expect(screen.getByText('GPA must be 20 characters or fewer.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled until institution, degree type, and major are all filled', () => {
    renderModal();
    openModal();

    const submit = screen.getByRole('button', { name: /^add education$/i });
    fireEvent.change(screen.getByLabelText(/^institution/i), { target: { value: 'MIT' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/degree type/i), { target: { value: "Bachelor's" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^major/i), { target: { value: 'Computer Science' } });
    expect(submit).not.toBeDisabled();
  });

  it('resets to empty fields and closes after a successful add-mode submit', async () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^institution/i), { target: { value: 'MIT' } });
    fireEvent.change(screen.getByLabelText(/degree type/i), { target: { value: "Bachelor's" } });
    fireEvent.change(screen.getByLabelText(/^major/i), { target: { value: 'Computer Science' } });
    fireEvent.click(screen.getByRole('button', { name: /^add education$/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/^institution/i)).not.toBeInTheDocument());

    openModal();
    expect(screen.getByLabelText(/^institution/i)).toHaveValue('');
  });

  it('shows an error message and keeps the dialog open with the entered data when the save fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('API 500: could not save education'));
    render(<AddEducationModal onAdd={onAdd} />);
    openModal();

    fireEvent.change(screen.getByLabelText(/^institution/i), { target: { value: 'MIT' } });
    fireEvent.change(screen.getByLabelText(/degree type/i), { target: { value: "Bachelor's" } });
    fireEvent.change(screen.getByLabelText(/^major/i), { target: { value: 'Computer Science' } });
    fireEvent.click(screen.getByRole('button', { name: /^add education$/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save education')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/^institution/i)).toHaveValue('MIT');
  });

  it('calls onDelete when the Delete button is clicked in edit mode', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderModal({ entry: EXISTING_ENTRY, onDelete });
    openModal(/^edit$/i);

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/^institution/i)).not.toBeInTheDocument());
  });

  it('does not render a Delete button in add mode', () => {
    renderModal();
    openModal();

    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });
});
