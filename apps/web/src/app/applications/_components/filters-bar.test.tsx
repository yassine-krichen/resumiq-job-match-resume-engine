import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FiltersBar } from './filters-bar';
import type { ApplicationsFilters } from './types';

function renderBar(filters: ApplicationsFilters = {}) {
  const onChange = vi.fn();
  const utils = render(<FiltersBar filters={filters} onChange={onChange} />);
  return { onChange, ...utils };
}

describe('FiltersBar', () => {
  it('omits status, company, dates, and match-score bounds from the payload when left unset', () => {
    const { onChange } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith({
      status: undefined,
      company: undefined,
      date_from: undefined,
      date_to: undefined,
      match_score_min: undefined,
      match_score_max: undefined,
    });
  });

  it('includes the selected status in the onChange payload', () => {
    const { onChange } = renderBar();

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'ready' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('trims a filled-in company name before sending it in the onChange payload', () => {
    const { onChange } = renderBar();

    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: '  Acme Corp  ' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ company: 'Acme Corp' }));
  });

  it('sends date_from and date_to as entered by the date inputs', () => {
    const { onChange } = renderBar();

    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '2026-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ date_from: '2026-01-01', date_to: '2026-01-31' }),
    );
  });

  it('converts entered match-score min/max bounds to numbers in the onChange payload', () => {
    const { onChange } = renderBar();

    fireEvent.change(screen.getByLabelText(/match score min/i), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/match score max/i), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ match_score_min: 40, match_score_max: 90 }),
    );
  });

  it('seeds every field from the filters prop passed in on mount', () => {
    renderBar({
      status: 'ready',
      company: 'Acme Corp',
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      match_score_min: 40,
      match_score_max: 90,
    });

    expect(screen.getByLabelText(/status/i)).toHaveValue('ready');
    expect(screen.getByLabelText(/company/i)).toHaveValue('Acme Corp');
    expect(screen.getByLabelText(/from/i)).toHaveValue('2026-01-01');
    expect(screen.getByLabelText(/^to$/i)).toHaveValue('2026-01-31');
    expect(screen.getByLabelText(/match score min/i)).toHaveValue(40);
    expect(screen.getByLabelText(/match score max/i)).toHaveValue(90);
  });
});
