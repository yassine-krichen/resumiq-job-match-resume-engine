import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobIntakeReviewForm } from './job-intake-review-form';
import type { JobIntakeResult } from './types';

const RAW_TEXT = 'x'.repeat(60);

function fullIntake(overrides: Partial<JobIntakeResult> = {}): JobIntakeResult {
  return {
    title: 'Backend Engineer',
    company_name: 'Acme Corp',
    location: 'Remote (US)',
    remote: true,
    salary_range: '$140k - $170k',
    company_info_summary: 'A fintech infra company.',
    ...overrides,
  };
}

function renderForm(overrides: Partial<Parameters<typeof JobIntakeReviewForm>[0]> = {}) {
  const onBack = vi.fn();
  const onSubmit = vi.fn();
  const utils = render(
    <JobIntakeReviewForm
      initial={fullIntake()}
      rawText={RAW_TEXT}
      onBack={onBack}
      onSubmit={onSubmit}
      loading={false}
      progress=""
      error=""
      {...overrides}
    />,
  );
  return { onBack, onSubmit, ...utils };
}

describe('JobIntakeReviewForm', () => {
  it('pre-fills fields from the initial prop', () => {
    renderForm();

    expect(screen.getByLabelText(/job title/i)).toHaveValue('Backend Engineer');
    expect(screen.getByLabelText(/company name/i)).toHaveValue('Acme Corp');
    expect(screen.getByLabelText(/location/i)).toHaveValue('Remote (US)');
    expect(screen.getByLabelText(/salary range/i)).toHaveValue('$140k - $170k');
    expect(screen.getByLabelText(/remote/i)).toBeChecked();
    expect(screen.getByLabelText(/company info/i)).toHaveValue('A fintech infra company.');
  });

  it('starts every field blank when initial is null', () => {
    renderForm({ initial: null });

    expect(screen.getByLabelText(/job title/i)).toHaveValue('');
    expect(screen.getByLabelText(/company name/i)).toHaveValue('');
    expect(screen.getByLabelText(/remote/i)).not.toBeChecked();
  });

  it('blocks submit when company name is empty, even with a populated initial minus company_name', () => {
    const { onSubmit } = renderForm({ initial: fullIntake({ company_name: null }) });

    expect(screen.getByRole('button', { name: /analyze job/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the warning banner only when both title and company_name are null in initial', () => {
    renderForm({ initial: fullIntake({ title: null, company_name: null }) });

    expect(screen.getByText(/doesn't look like a job posting/i)).toBeInTheDocument();
  });

  it('does not show the warning banner when only one of title/company_name is null', () => {
    renderForm({ initial: fullIntake({ title: null }) });

    expect(screen.queryByText(/doesn't look like a job posting/i)).not.toBeInTheDocument();
  });

  it('does not show the warning banner when initial is null (manual-fallback path)', () => {
    renderForm({ initial: null });

    expect(screen.queryByText(/doesn't look like a job posting/i)).not.toBeInTheDocument();
  });

  it('calls onBack when the Back button is clicked', () => {
    const { onBack } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('submits with raw_jd equal to the rawText prop unchanged, regardless of other field edits', () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText(/job title/i), {
      target: { value: 'Staff Backend Engineer' },
    });
    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: '  Acme Corp Edited  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze job/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_jd: RAW_TEXT,
        title: 'Staff Backend Engineer',
        company_name: 'Acme Corp Edited',
      }),
    );
  });
});
