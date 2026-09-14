import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddExperienceModal, type NewExperience } from './add-experience-modal';

const EMPTY_ENTRY: NewExperience = {
  company: '',
  company_industry: '',
  role: '',
  location: '',
  location_type: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  core_competencies: [],
  technologies_used: [],
  raw_achievements: [],
  quantifiable_metrics: [],
};

const EXISTING_ENTRY: NewExperience = {
  company: 'Acme Corp',
  company_industry: 'Software',
  role: 'Senior Engineer',
  location: 'Berlin',
  location_type: 'Remote',
  startDate: '2021-01',
  endDate: '2023-06',
  isCurrent: false,
  core_competencies: ['Leadership'],
  technologies_used: ['TypeScript', 'NestJS'],
  raw_achievements: ['Led the platform migration'],
  quantifiable_metrics: ['Cut latency by 40%'],
};

function renderModal(props: Partial<{ submitting: boolean; entry: NewExperience; onDelete: () => Promise<void> }> = {}) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <AddExperienceModal
      onAdd={onAdd}
      submitting={props.submitting}
      entry={props.entry}
      onDelete={props.onDelete}
    />,
  );
  return { onAdd, ...utils };
}

function openModal(triggerName: RegExp = /^\+ add experience$/i) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
}

describe('AddExperienceModal', () => {
  it('renders empty fields in add mode', () => {
    renderModal();
    openModal();

    expect(screen.getByLabelText(/^company/i)).toHaveValue(EMPTY_ENTRY.company);
    expect(screen.getByLabelText(/^role/i)).toHaveValue(EMPTY_ENTRY.role);
    expect(screen.getByRole('checkbox', { name: /i currently work here/i })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /^add experience$/i })).toBeDisabled();
  });

  it('renders pre-filled fields in edit mode from the entry prop', () => {
    renderModal({ entry: EXISTING_ENTRY });
    openModal(/^edit$/i);

    expect(screen.getByLabelText(/^company/i)).toHaveValue('Acme Corp');
    expect(screen.getByLabelText(/^role/i)).toHaveValue('Senior Engineer');
    expect(screen.getByLabelText(/industry/i)).toHaveValue('Software');
    expect(screen.getByLabelText(/technologies used/i)).toHaveValue('TypeScript\nNestJS');
    expect(screen.getByLabelText(/key achievements/i)).toHaveValue('Led the platform migration');
    expect(screen.getByLabelText(/quantifiable metrics/i)).toHaveValue('Cut latency by 40%');
    expect(screen.getByRole('button', { name: /^save changes$/i })).not.toBeDisabled();
  });

  it('submits trimmed values with newline-delimited lists parsed back into arrays, and calls addEntry (onAdd) with the built entry', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: ' Acme Corp ' } });
    fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: ' Senior Engineer ' } });
    fireEvent.change(screen.getByLabelText(/technologies used/i), {
      target: { value: ' TypeScript \nNestJS \n' },
    });
    fireEvent.change(screen.getByLabelText(/key achievements/i), {
      target: { value: 'Led the platform migration\nCut costs by 20%' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add experience$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        company: 'Acme Corp',
        role: 'Senior Engineer',
        technologies_used: ['TypeScript', 'NestJS'],
        raw_achievements: ['Led the platform migration', 'Cut costs by 20%'],
      }),
    );
  });

  it('submits an empty end date when "I currently work here" is checked, regardless of what was typed in the end date field', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: 'Acme Corp' } });
    fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: 'Senior Engineer' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /i currently work here/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add experience$/i }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ isCurrent: true, endDate: '' }));
  });

  it('shows a validation error and keeps the dialog open when the industry field exceeds its max length, without calling onAdd', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: 'Acme Corp' } });
    fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: 'Senior Engineer' } });
    fireEvent.change(screen.getByLabelText(/industry/i), { target: { value: 'a'.repeat(201) } });
    fireEvent.click(screen.getByRole('button', { name: /^add experience$/i }));

    expect(screen.getByText('Industry must be 200 characters or fewer.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^company/i)).toBeInTheDocument();
  });

  it('keeps the submit button disabled until both company and role are filled', () => {
    renderModal();
    openModal();

    const submit = screen.getByRole('button', { name: /^add experience$/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: 'Acme Corp' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: 'Senior Engineer' } });
    expect(submit).not.toBeDisabled();
  });

  it('resets to empty fields and closes after a successful add-mode submit', async () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: 'Acme Corp' } });
    fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: 'Senior Engineer' } });
    fireEvent.click(screen.getByRole('button', { name: /^add experience$/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/^company/i)).not.toBeInTheDocument());

    openModal();
    expect(screen.getByLabelText(/^company/i)).toHaveValue('');
  });

  it('shows an error message and keeps the dialog open with the entered data when the save fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('API 500: could not save experience'));
    render(<AddExperienceModal onAdd={onAdd} />);
    openModal();

    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: 'Acme Corp' } });
    fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: 'Senior Engineer' } });
    fireEvent.click(screen.getByRole('button', { name: /^add experience$/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save experience')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/^company/i)).toHaveValue('Acme Corp');
  });

  it('calls onDelete when the Delete button is clicked in edit mode', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderModal({ entry: EXISTING_ENTRY, onDelete });
    openModal(/^edit$/i);

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/^company/i)).not.toBeInTheDocument());
  });

  it('does not render a Delete button in add mode', () => {
    renderModal();
    openModal();

    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });
});
