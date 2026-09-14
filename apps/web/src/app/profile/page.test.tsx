import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ProfilePage from './page';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';

// `apiFetch` is called directly by the page (no `./api` wrapper module here)
// — mock it at the `@/lib/api` boundary, same as other pages that call it
// straight from `@/lib/api`.
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

const pushMock = vi.fn();
const replaceMock = vi.fn();
const backMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: backMock }),
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

function renderPage() {
  return render(<ProfilePage />);
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    pushMock.mockReset();
    replaceMock.mockReset();
    backMock.mockReset();
  });

  it('shows a loading state while GET /profile is in flight', () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('redirects to /onboarding when GET /profile returns a 404 (no profile created yet)', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('API 404: not found'));

    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/onboarding'));
  });

  it('shows the error message for a non-404 GET /profile failure, without redirecting', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('API 500: server error'));

    renderPage();

    await waitFor(() => expect(screen.getByText('API 500: server error')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the roles/projects/degrees/skills counts from the fetched profile', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      buildProfile({
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
        skills: {
          programming_languages: ['TypeScript', 'Python'],
          frameworks_and_libraries: ['NestJS'],
          infrastructure_and_tools: [],
          databases: [],
          spoken_languages: [],
          soft_skills: [],
        },
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Career Profile')).toBeInTheDocument());
    // 'Projects' and 'Skills' also label rows in the "Profile strength" section
    // below, so scope the lookup to the summary-stats grid to disambiguate.
    const statsGrid = screen.getByText('Roles').closest('.grid') as HTMLElement;
    const statLabels = ['Roles', 'Projects', 'Degrees', 'Skills'];
    const statValues = ['1', '0', '0', '3'];
    statLabels.forEach((label, i) => {
      const labelEl = within(statsGrid).getByText(label);
      const card = labelEl.closest('div') as HTMLElement;
      expect(within(card).getByText(statValues[i])).toBeInTheDocument();
    });
  });

  it('fills the strength bar to 100% and marks it complete once a section meets its target count', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      buildProfile({
        projects: [
          { name: 'A', context: '', links: [], startDate: '', endDate: '', technologies_used: [], raw_achievements: [], quantifiable_metrics: [] },
          { name: 'B', context: '', links: [], startDate: '', endDate: '', technologies_used: [], raw_achievements: [], quantifiable_metrics: [] },
        ],
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Profile strength')).toBeInTheDocument());
    const projectsRow = screen.getByText('Projects', { selector: 'span' }).closest('div')!
      .parentElement as HTMLElement;
    const fill = projectsRow.querySelector('.bg-emerald-500') as HTMLElement;
    expect(fill).toHaveStyle({ width: '100%' });
  });

  it('leaves the strength bar under 100% (not emerald) when a section is below its target count', async () => {
    vi.mocked(apiFetch).mockResolvedValue(buildProfile({ projects: [] }));

    renderPage();

    await waitFor(() => expect(screen.getByText('Profile strength')).toBeInTheDocument());
    const projectsRow = screen.getByText('Projects', { selector: 'span' }).closest('div')!
      .parentElement as HTMLElement;
    const fill = projectsRow.querySelector('.bg-muted-foreground') as HTMLElement;
    expect(fill).toHaveStyle({ width: '0%' });
  });

  it('shows the empty-achievements message when awards_and_honors is empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue(buildProfile({ awards_and_honors: [] }));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('No achievements added yet.')).toBeInTheDocument(),
    );
  });

  it('renders existing achievements with their date and related skills', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      buildProfile({
        awards_and_honors: [
          {
            title: 'Employee of the Year',
            issuer: '',
            date: '2024-03',
            description: 'Recognized for outstanding delivery.',
            related_skills: ['Leadership'],
          },
        ],
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Employee of the Year')).toBeInTheDocument());
    expect(screen.getByText('2024-03')).toBeInTheDocument();
    expect(screen.getByText('Recognized for outstanding delivery.')).toBeInTheDocument();
    expect(screen.getByText('Leadership')).toBeInTheDocument();
  });

  it('adds a new achievement to the existing awards list and PATCHes /profile with the full updated array, not just the new entry', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      buildProfile({
        awards_and_honors: [
          {
            title: 'Existing Award',
            issuer: '',
            date: '2023-01',
            description: '',
            related_skills: [],
          },
        ],
      }),
    );
    vi.mocked(apiFetch).mockResolvedValueOnce(buildProfile());

    renderPage();
    await waitFor(() => expect(screen.getByText('Existing Award')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ add achievement/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New Award' } });
    fireEvent.click(screen.getByRole('button', { name: /^add achievement$/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          awards_and_honors: [
            {
              title: 'Existing Award',
              issuer: '',
              date: '2023-01',
              description: '',
              related_skills: [],
            },
            {
              title: 'New Award',
              issuer: '',
              date: '',
              description: '',
              related_skills: [],
            },
          ],
        }),
      }),
    );
  });

  it('shows an error message when adding an achievement fails, without crashing the page', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(buildProfile());
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('API 500: could not save achievement'));

    renderPage();
    await waitFor(() => expect(screen.getByText('No achievements added yet.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ add achievement/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New Award' } });
    fireEvent.click(screen.getByRole('button', { name: /^add achievement$/i }));

    // The error surfaces both as the page-level banner and inside the still-open
    // modal, so two elements now carry this message.
    await waitFor(() =>
      expect(screen.getAllByText('API 500: could not save achievement')).toHaveLength(2),
    );
    // The modal stays open with the typed title intact — the user doesn't
    // have to retype it after a failed save.
    expect(screen.getByLabelText(/title/i)).toHaveValue('New Award');
  });

  it('shows an empty-state message for experience, projects, and education when their arrays are empty, instead of hiding the sections', async () => {
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());

    renderPage();

    await waitFor(() => expect(screen.getByText('No experience added yet.')).toBeInTheDocument());
    expect(screen.getByText('No projects added yet.')).toBeInTheDocument();
    expect(screen.getByText('No education added yet.')).toBeInTheDocument();
    // The section headers themselves are still rendered (not hidden), each
    // with its own "+ Add X" trigger available even with zero entries.
    expect(screen.getByRole('button', { name: /^\+ add experience$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^\+ add project$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^\+ add education$/i })).toBeInTheDocument();
  });

  it('shows the empty-certifications message when certifications is empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue(buildProfile({ certifications: [] }));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('No certifications added yet.')).toBeInTheDocument(),
    );
  });

  it('renders existing certifications with their name, issuer, and date, not just a count', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      buildProfile({
        certifications: [
          {
            name: 'AWS Certified Solutions Architect',
            issuer: 'Amazon Web Services',
            date: '2022-05',
            expiration_date: '',
            credential_id: '',
            link: '',
            description: '',
          },
        ],
      }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('AWS Certified Solutions Architect')).toBeInTheDocument(),
    );
    expect(screen.getByText('Amazon Web Services')).toBeInTheDocument();
    expect(screen.getByText('2022-05')).toBeInTheDocument();
  });

  it('renders an inline Edit trigger for every experience entry', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      buildProfile({
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
          {
            company: 'Beta Inc',
            company_industry: '',
            role: 'Senior Engineer',
            location: '',
            location_type: '',
            startDate: '2018',
            endDate: '2020',
            isCurrent: false,
            core_competencies: [],
            technologies_used: [],
            raw_achievements: [],
            quantifiable_metrics: [],
          },
        ],
      }),
    );

    renderPage();

    // Company/location render as sibling text nodes within the same <p>
    // ("Acme · "), so an exact-string matcher never matches — use a regex,
    // which RTL matches as a substring against the node's text content.
    await waitFor(() => expect(screen.getByText(/Acme/)).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /^edit$/i })).toHaveLength(2);
  });
});
