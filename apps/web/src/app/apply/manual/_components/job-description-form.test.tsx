import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobDescriptionForm } from './job-description-form';

const VALID_JD = 'x'.repeat(60);

function renderForm(overrides: Partial<Parameters<typeof JobDescriptionForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const utils = render(
    <JobDescriptionForm
      onSubmit={onSubmit}
      loading={false}
      progress=""
      error=""
      {...overrides}
    />,
  );
  return { onSubmit, ...utils };
}

describe('JobDescriptionForm', () => {
  it('disables the submit button until both company name and a job description of at least 50 characters are filled in', () => {
    renderForm();

    const submitButton = screen.getByRole('button', { name: /analyze job/i });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: 'Acme Corp' },
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/job description/i), {
      target: { value: 'too short' },
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/job description/i), {
      target: { value: VALID_JD },
    });
    expect(submitButton).toBeEnabled();
  });

  it('does not call onSubmit when the form is submitted without a company name, even if the job description is long enough', () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText(/job description/i), {
      target: { value: VALID_JD },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with a trimmed company_name once the required fields are filled in', () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: '  Acme Corp  ' },
    });
    fireEvent.change(screen.getByLabelText(/job description/i), {
      target: { value: VALID_JD },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ company_name: 'Acme Corp', raw_jd: VALID_JD }),
    );
  });

  it('omits optional fields left blank rather than submitting empty strings', () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: 'Acme Corp' },
    });
    fireEvent.change(screen.getByLabelText(/job description/i), {
      target: { value: VALID_JD },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.title).toBeUndefined();
    expect(submitted.location).toBeUndefined();
    expect(submitted.source_url).toBeUndefined();
    expect(submitted.salary_range).toBeUndefined();
    expect(submitted.company_info).toBeUndefined();
  });

  it('disables all inputs and the submit button while loading, and shows the progress message', () => {
    renderForm({ loading: true, progress: 'Scoring your fit...' });

    expect(screen.getByLabelText(/company name/i)).toBeDisabled();
    expect(screen.getByLabelText(/job description/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /analyze job/i })).toBeDisabled();
    expect(screen.getByText('Scoring your fit...')).toBeInTheDocument();
  });

  it('shows the error message when analyze fails', () => {
    renderForm({ error: 'API 500: analysis failed' });

    expect(screen.getByText('API 500: analysis failed')).toBeInTheDocument();
  });
});
