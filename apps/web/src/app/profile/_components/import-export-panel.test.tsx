import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportExportPanel } from './import-export-panel';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';

// Mocked at the `@/lib/api` boundary, same pattern as `profile/page.test.tsx`
// and other profile-adjacent component tests.
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

function buildProfile(overrides: Partial<MasterDB> = {}): MasterDB {
  return {
    personal_info: {
      name: 'Jane Doe',
      location: 'Berlin',
      phone: '',
      email: 'jane@example.com',
      work_authorization: [],
      clearances: [],
      links: [],
    },
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: {
      programming_languages: [],
      frameworks_and_libraries: [],
      infrastructure_and_tools: [],
      databases: [],
      spoken_languages: [],
      soft_skills: [],
    },
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
    ...overrides,
  };
}

function renderPanel(profile: MasterDB = buildProfile()) {
  const onImported = vi.fn();
  const utils = render(<ImportExportPanel profile={profile} onImported={onImported} />);
  return { onImported, ...utils };
}

/** The file input is intentionally hidden with no accessible name (it's
 * triggered via the "Import profile" button) — select it directly the way
 * RTL's own docs recommend for unlabeled file inputs. */
function getFileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('ImportExportPanel', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  describe('export', () => {
    it('downloads the profile as a career-profile.json blob when "Export profile" is clicked', () => {
      // jsdom does not implement blob URL creation/revocation.
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-export-url');
      global.URL.revokeObjectURL = vi.fn();
      let downloadedFilename = '';
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloadedFilename = this.download;
      });
      const profile = buildProfile({ personal_info: { ...buildProfile().personal_info, name: 'Export Me' } });

      renderPanel(profile);
      fireEvent.click(screen.getByRole('button', { name: /^export profile$/i }));

      expect(downloadedFilename).toBe('career-profile.json');
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-export-url');
    });
  });

  describe('import', () => {
    it('sends the parsed file contents to POST /profile/import, shows a success message, and calls onImported with the merged profile', async () => {
      const merged = buildProfile({
        experience: [
          {
            company: 'Acme',
            company_industry: '',
            role: 'Engineer',
            location: '',
            location_type: '',
            startDate: '2020',
            endDate: '',
            isCurrent: true,
            core_competencies: [],
            technologies_used: [],
            raw_achievements: [],
            quantifiable_metrics: [],
          },
        ],
      });
      vi.mocked(apiFetch).mockResolvedValue(merged);
      const importPayload = buildProfile();

      const { container, onImported } = renderPanel();
      const input = getFileInput(container);
      const file = new File([JSON.stringify(importPayload)], 'career-profile.json', {
        type: 'application/json',
      });

      selectFile(input, file);

      await waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith('/profile/import', {
          method: 'POST',
          body: JSON.stringify(importPayload),
        }),
      );
      await waitFor(() => expect(onImported).toHaveBeenCalledWith(merged));
      expect(
        screen.getByText('Profile imported and merged successfully.'),
      ).toBeInTheDocument();
    });

    it('shows a loading indicator on the import trigger while the import request is in flight', async () => {
      let resolveImport!: (value: MasterDB) => void;
      vi.mocked(apiFetch).mockReturnValue(
        new Promise<MasterDB>((resolve) => {
          resolveImport = resolve;
        }),
      );

      const { container } = renderPanel();
      const input = getFileInput(container);
      const file = new File([JSON.stringify(buildProfile())], 'career-profile.json', {
        type: 'application/json',
      });

      selectFile(input, file);

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^importing\.\.\.$/i })).toBeDisabled(),
      );

      resolveImport(buildProfile());

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^import profile$/i })).not.toBeDisabled(),
      );
    });

    it('shows an inline error and does not call onImported when the selected file is not valid JSON', async () => {
      const { container, onImported } = renderPanel();
      const input = getFileInput(container);
      const file = new File(['not json at all'], 'career-profile.json', {
        type: 'application/json',
      });

      selectFile(input, file);

      await waitFor(() =>
        expect(screen.getByText('That file is not valid JSON.')).toBeInTheDocument(),
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(onImported).not.toHaveBeenCalled();
    });

    it('shows an inline error and does not call onImported when the API rejects the import', async () => {
      vi.mocked(apiFetch).mockRejectedValue(new Error('API 400: personal_info.name is required'));

      const { container, onImported } = renderPanel();
      const input = getFileInput(container);
      const file = new File([JSON.stringify(buildProfile())], 'career-profile.json', {
        type: 'application/json',
      });

      selectFile(input, file);

      await waitFor(() =>
        expect(screen.getByText('API 400: personal_info.name is required')).toBeInTheDocument(),
      );
      expect(onImported).not.toHaveBeenCalled();
    });

    it('resets the file input value after a selection so re-selecting the same file re-fires the change handler', async () => {
      vi.mocked(apiFetch).mockResolvedValue(buildProfile());

      const { container } = renderPanel();
      const input = getFileInput(container);
      const file = new File([JSON.stringify(buildProfile())], 'career-profile.json', {
        type: 'application/json',
      });

      selectFile(input, file);

      await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
      expect(input.value).toBe('');
    });
  });
});
