import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import SettingsPage from './page';
import { useUpdateUserSettings, useUserSettings } from '@/hooks/use-user-settings';
import type { UpdateUserSettings, UserSettings } from '@/hooks/use-user-settings';

// The settings hook has its own direct test suite
// (src/hooks/use-user-settings.test.tsx) — stubbed here so this suite stays
// focused on how the page renders/derives its form from the hook's data and
// what it sends back through the mutation, not the hook's fetch/cache plumbing.
vi.mock('@/hooks/use-user-settings', () => ({
  useUserSettings: vi.fn(),
  useUpdateUserSettings: vi.fn(),
}));

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    match_threshold: 50,
    preferred_locations: ['Berlin', 'Remote'],
    target_roles: ['Backend Engineer'],
    seniority: 'Senior',
    resume_template: 'default',
    ai_provider_override: undefined,
    auto_send_email: false,
    notify_on_new_jobs: true,
    category_tags: ['backend'],
    work_mode: ['remote'],
    ...overrides,
  };
}

function mockSettingsQuery(overrides: Partial<UseQueryResult<UserSettings>> = {}) {
  vi.mocked(useUserSettings).mockReturnValue({
    data: buildSettings(),
    isLoading: false,
    isError: false,
    error: null,
    ...overrides,
  } as UseQueryResult<UserSettings>);
}

function mockUpdateMutation(
  overrides: Partial<UseMutationResult<UserSettings, Error, UpdateUserSettings>> = {},
) {
  const mutate = vi.fn();
  vi.mocked(useUpdateUserSettings).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    ...overrides,
  } as UseMutationResult<UserSettings, Error, UpdateUserSettings>);
  return mutate;
}

function renderPage() {
  return render(<SettingsPage />);
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(useUserSettings).mockReset();
    vi.mocked(useUpdateUserSettings).mockReset();
    mockSettingsQuery();
    mockUpdateMutation();
  });

  it('shows the loading message while settings are being fetched', () => {
    mockSettingsQuery({ data: undefined, isLoading: true });

    renderPage();

    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
  });

  it('shows the fetch error message when GET /jobs/settings fails', () => {
    mockSettingsQuery({ data: undefined, isError: true, error: new Error('API 500: failed') });

    renderPage();

    expect(screen.getByText('API 500: failed')).toBeInTheDocument();
  });

  it('seeds all editable fields from the fetched settings', () => {
    mockSettingsQuery({
      data: buildSettings({
        match_threshold: 65,
        preferred_locations: ['Berlin', 'Remote'],
        target_roles: ['Backend Engineer', 'Platform Engineer'],
        seniority: 'Staff',
        category_tags: ['backend', 'data'],
        work_mode: ['remote', 'hybrid'],
        auto_send_email: true,
        notify_on_new_jobs: false,
      }),
    });

    renderPage();

    expect(screen.getByLabelText(/match threshold/i)).toHaveValue(65);
    expect(screen.getByLabelText(/preferred locations/i)).toHaveValue('Berlin, Remote');
    expect(screen.getByLabelText(/target roles/i)).toHaveValue('Backend Engineer, Platform Engineer');
    expect(screen.getByLabelText('Seniority')).toHaveValue('Staff');
    expect(screen.getByLabelText(/category \/ field/i)).toHaveValue('backend, data');
    expect(screen.getByRole('checkbox', { name: 'remote' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'hybrid' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'onsite' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /auto-send email/i })).toHaveAttribute(
      'data-checked',
      '',
    );
    expect(screen.getByRole('switch', { name: /notify on new jobs/i })).toHaveAttribute(
      'data-unchecked',
      '',
    );
  });

  it('saves every editable field via the update mutation, parsing comma-separated lists and coercing the threshold to a number', () => {
    const mutate = mockUpdateMutation();
    renderPage();

    fireEvent.change(screen.getByLabelText(/match threshold/i), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText(/preferred locations/i), {
      target: { value: 'Paris,  Remote ' },
    });
    fireEvent.change(screen.getByLabelText(/target roles/i), {
      target: { value: 'Staff Engineer' },
    });
    fireEvent.change(screen.getByLabelText('Seniority'), { target: { value: 'Staff' } });
    fireEvent.change(screen.getByLabelText(/category \/ field/i), { target: { value: 'infra' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'onsite' }));
    fireEvent.click(screen.getByRole('switch', { name: /auto-send email/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      match_threshold: 75,
      preferred_locations: ['Paris', 'Remote'],
      target_roles: ['Staff Engineer'],
      seniority: 'Staff',
      category_tags: ['infra'],
      work_mode: ['remote', 'onsite'],
      auto_send_email: true,
      notify_on_new_jobs: true,
    });
  });

  it('shows the save error message when the update mutation fails', () => {
    mockUpdateMutation({ isError: true, error: new Error('API 400: invalid threshold') });

    renderPage();

    expect(screen.getByText('API 400: invalid threshold')).toBeInTheDocument();
  });

  it('shows a confirmation message once settings are saved successfully', () => {
    mockUpdateMutation({ isSuccess: true });

    renderPage();

    expect(screen.getByText('Settings saved.')).toBeInTheDocument();
  });

  describe('resume_template / ai_provider_override — not yet configurable', () => {
    it('renders resume_template as a disabled select with a "coming soon" caption, showing the current hardcoded value', () => {
      mockSettingsQuery({ data: buildSettings({ resume_template: 'modern-one-page' }) });

      renderPage();

      const select = screen.getByLabelText(/resume template/i);
      expect(select).toBeDisabled();
      expect(select).toHaveValue('modern-one-page');
      expect(screen.getByText('Coming soon — currently hardcoded.')).toBeInTheDocument();
    });

    it('renders ai_provider_override as a disabled input with a "coming soon" caption', () => {
      mockSettingsQuery({ data: buildSettings({ ai_provider_override: undefined }) });

      renderPage();

      const input = screen.getByLabelText(/ai provider override/i);
      expect(input).toBeDisabled();
      expect(
        screen.getByText("Coming soon — the LLM layer doesn't support a per-user override yet."),
      ).toBeInTheDocument();
    });

    it('never fires an update when the disabled resume_template/ai_provider_override fields receive change events', () => {
      const mutate = mockUpdateMutation();
      renderPage();

      fireEvent.change(screen.getByLabelText(/resume template/i), { target: { value: 'compact' } });
      fireEvent.change(screen.getByLabelText(/ai provider override/i), {
        target: { value: 'anthropic' },
      });

      expect(mutate).not.toHaveBeenCalled();
    });

    it('omits resume_template and ai_provider_override from the payload sent by "Save settings", even though the fields are visible on the form', () => {
      const mutate = mockUpdateMutation();
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

      const [payload] = mutate.mock.calls[0] as [Record<string, unknown>];
      expect(payload).not.toHaveProperty('resume_template');
      expect(payload).not.toHaveProperty('ai_provider_override');
    });
  });
});
