import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddCertificationModal, type NewCertification } from './add-certification-modal';

const EMPTY_ENTRY: NewCertification = {
  name: '',
  issuer: '',
  date: '',
  expiration_date: '',
  credential_id: '',
  link: '',
  description: '',
};

const EXISTING_ENTRY: NewCertification = {
  name: 'AWS Certified Solutions Architect',
  issuer: 'Amazon Web Services',
  date: '2022-05',
  expiration_date: '2025-05',
  credential_id: 'ABC-123',
  link: 'https://aws.amazon.com/verify/ABC-123',
  description: 'Associate-level certification.',
};

function renderModal(props: Partial<{ submitting: boolean; entry: NewCertification; onDelete: () => Promise<void> }> = {}) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <AddCertificationModal
      onAdd={onAdd}
      submitting={props.submitting}
      entry={props.entry}
      onDelete={props.onDelete}
    />,
  );
  return { onAdd, ...utils };
}

function openModal(triggerName: RegExp = /^\+ add certification$/i) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
}

describe('AddCertificationModal', () => {
  it('renders empty fields in add mode', () => {
    renderModal();
    openModal();

    expect(screen.getByLabelText(/^name/i)).toHaveValue(EMPTY_ENTRY.name);
    expect(screen.getByLabelText(/^issuer/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^add certification$/i })).toBeDisabled();
  });

  it('renders pre-filled fields in edit mode from the entry prop', () => {
    renderModal({ entry: EXISTING_ENTRY });
    openModal(/^edit$/i);

    expect(screen.getByLabelText(/^name/i)).toHaveValue('AWS Certified Solutions Architect');
    expect(screen.getByLabelText(/^issuer/i)).toHaveValue('Amazon Web Services');
    expect(screen.getByLabelText(/^date/i)).toHaveValue('2022-05');
    expect(screen.getByLabelText(/expiration date/i)).toHaveValue('2025-05');
    expect(screen.getByLabelText(/credential id/i)).toHaveValue('ABC-123');
    expect(screen.getByLabelText(/^link/i)).toHaveValue('https://aws.amazon.com/verify/ABC-123');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Associate-level certification.');
    expect(screen.getByRole('button', { name: /^save changes$/i })).not.toBeDisabled();
  });

  it('submits trimmed name/issuer values', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: '  AWS SAA  ' } });
    fireEvent.change(screen.getByLabelText(/^issuer/i), { target: { value: '  AWS  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^add certification$/i }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AWS SAA', issuer: 'AWS' }),
    );
  });

  it('shows a validation error and keeps the dialog open when the link field exceeds its max length, without calling onAdd', () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'AWS SAA' } });
    fireEvent.change(screen.getByLabelText(/^issuer/i), { target: { value: 'AWS' } });
    fireEvent.change(screen.getByLabelText(/^link/i), { target: { value: 'a'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: /^add certification$/i }));

    expect(screen.getByText('Link must be 2000 characters or fewer.')).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled until both name and issuer are filled', () => {
    renderModal();
    openModal();

    const submit = screen.getByRole('button', { name: /^add certification$/i });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'AWS SAA' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^issuer/i), { target: { value: 'AWS' } });
    expect(submit).not.toBeDisabled();
  });

  it('resets to empty fields and closes after a successful add-mode submit', async () => {
    const { onAdd } = renderModal();
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'AWS SAA' } });
    fireEvent.change(screen.getByLabelText(/^issuer/i), { target: { value: 'AWS' } });
    fireEvent.click(screen.getByRole('button', { name: /^add certification$/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/^name/i)).not.toBeInTheDocument());

    openModal();
    expect(screen.getByLabelText(/^name/i)).toHaveValue('');
  });

  it('shows an error message and keeps the dialog open with the entered data when the save fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('API 500: could not save certification'));
    render(<AddCertificationModal onAdd={onAdd} />);
    openModal();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'AWS SAA' } });
    fireEvent.change(screen.getByLabelText(/^issuer/i), { target: { value: 'AWS' } });
    fireEvent.click(screen.getByRole('button', { name: /^add certification$/i }));

    await waitFor(() =>
      expect(screen.getByText('API 500: could not save certification')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/^name/i)).toHaveValue('AWS SAA');
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
