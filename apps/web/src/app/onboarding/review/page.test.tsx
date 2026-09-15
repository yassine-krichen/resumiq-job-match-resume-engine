import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import OnboardingReviewPage from './page';
import { apiFetch } from '@/lib/api';
import { loadPendingEntries, savePendingEntries } from '../_lib/pending-entries';
import type { IngestEntryDto, MasterDB } from '@resumiq/schemas';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const experienceEntry1: IngestEntryDto = {
  type: 'experience',
  entry: {
    company: 'Acme Corp',
    company_industry: 'Software',
    role: 'Engineer',
    location: 'Remote',
    location_type: 'Remote',
    startDate: 'Jan 2023',
    endDate: 'Present',
    isCurrent: true,
    core_competencies: [],
    technologies_used: [],
    raw_achievements: [],
    quantifiable_metrics: [],
  },
};

const experienceEntry2: IngestEntryDto = {
  type: 'experience',
  entry: {
    company: 'Globex Corp',
    company_industry: 'Software',
    role: 'Engineer',
    location: 'Remote',
    location_type: 'Remote',
    startDate: 'Jan 2023',
    endDate: 'Present',
    isCurrent: true,
    core_competencies: [],
    technologies_used: [],
    raw_achievements: [],
    quantifiable_metrics: [],
  },
};

const certificationEntry: IngestEntryDto = {
  type: 'certification',
  entry: {
    name: 'AWS Developer',
    issuer: 'AWS',
    date: '2023',
    expiration_date: '',
    credential_id: '',
    link: '',
    description: '',
  },
};

const skillsEntry: IngestEntryDto = {
  type: 'skills',
  entry: { programming_languages: ['TypeScript', 'Python'], frameworks_and_libraries: ['React'] },
};

const summaryEntry: IngestEntryDto = {
  type: 'summary',
  entry: { target_role: 'Backend Engineer', content: 'Backend engineer with 5 years of experience.' },
};

const publicationEntry: IngestEntryDto = {
  type: 'publication',
  entry: { title: 'Scaling Postgres at 10x', venue: 'ReactConf 2024', date: '2024' },
};

const publicationEntryWithAllFields: IngestEntryDto = {
  type: 'publication',
  entry: {
    title: 'Scaling Postgres at 10x',
    venue: 'ReactConf 2024',
    date: '2024',
    url: 'https://example.com/talk',
    description: 'A deep dive into read replicas.',
  },
};

const volunteeringEntry: IngestEntryDto = {
  type: 'volunteering',
  entry: { organization: 'Code.org', role: 'Mentor', startDate: '2022', isCurrent: true },
};

const volunteeringEntryWithAllFields: IngestEntryDto = {
  type: 'volunteering',
  entry: {
    organization: 'Code.org',
    role: 'Mentor',
    location: 'Remote',
    startDate: '2022',
    isCurrent: true,
    description: 'Taught intro programming to high schoolers.',
  },
};

const skillsEntryWithAllFields: IngestEntryDto = {
  type: 'skills',
  entry: {
    programming_languages: ['TypeScript'],
    frameworks_and_libraries: ['React'],
    infrastructure_and_tools: ['Docker'],
    databases: ['Postgres'],
    soft_skills: ['Communication'],
  },
};

const interestEntry1: IngestEntryDto = { type: 'interest', entry: 'Chess' };
const interestEntry2: IngestEntryDto = { type: 'interest', entry: 'Marathon Running' };

/** Scopes queries to the row/card containing the given title text, the same
 * way a user would locate "the button next to this entry" rather than
 * relying on the entry's position in a flat DOM query. */
function rowFor(title: string): ReturnType<typeof within> {
  const titleEl = screen.getByText(title);
  const row = titleEl.closest('div')?.parentElement;
  if (!row) throw new Error(`Could not find a row containing "${title}"`);
  return within(row as HTMLElement);
}

function buildProfile(): MasterDB {
  return {
    personal_info: { name: '', location: '', phone: '', email: '', work_authorization: [], clearances: [], links: [] },
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: { programming_languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [], spoken_languages: [], soft_skills: [] },
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
  };
}

describe('OnboardingReviewPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    pushMock.mockReset();
    sessionStorage.clear();
  });

  it('shows a "nothing to review" empty state and a way back to paste when no entries are pending', async () => {
    render(<OnboardingReviewPage />);

    expect(
      await screen.findByText('Nothing to review — paste some career text first.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /go to paste/i }));

    expect(pushMock).toHaveBeenCalledWith('/onboarding');
  });

  it('groups pending entries by type into labeled sections with an accurate count badge', async () => {
    savePendingEntries([experienceEntry1, experienceEntry2, certificationEntry, interestEntry1]);

    render(<OnboardingReviewPage />);

    const experienceHeading = await screen.findByRole('heading', { name: /experience/i });
    expect(within(experienceHeading).getByText('2')).toBeInTheDocument();

    const certHeading = screen.getByRole('heading', { name: /certifications/i });
    expect(within(certHeading).getByText('1')).toBeInTheDocument();

    const interestHeading = screen.getByRole('heading', { name: /interests/i });
    expect(within(interestHeading).getByText('1')).toBeInTheDocument();

    expect(screen.queryByRole('heading', { name: /^projects/i })).not.toBeInTheDocument();
  });

  it('renders the 4 new taxonomy types and skills as plain view+remove cards, without an edit modal', async () => {
    savePendingEntries([skillsEntry, summaryEntry, publicationEntry, volunteeringEntry, interestEntry1]);

    render(<OnboardingReviewPage />);

    // "Languages: " is a bold <span> sibling to the plain-text value, so the
    // two live in separate text nodes under the same <p> — a plain string or
    // regex matcher can't match text split across sibling nodes. Match on
    // the paragraph's full textContent instead.
    expect(
      await screen.findByText(
        (_, element) => element?.textContent === 'Languages: TypeScript, Python',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
    expect(screen.getByText('Backend engineer with 5 years of experience.')).toBeInTheDocument();
    expect(screen.getByText('Scaling Postgres at 10x')).toBeInTheDocument();
    expect(screen.getByText('Mentor @ Code.org')).toBeInTheDocument();
    expect(screen.getByText('Chess')).toBeInTheDocument();

    // Plain cards only offer Remove — no Edit affordance, since there's no
    // manual-CRUD modal for these types yet.
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^remove$/i })).toHaveLength(5);
  });

  it('lets the user fix a mis-parsed entry inline via the reused AddCertificationModal before confirming', async () => {
    savePendingEntries([certificationEntry]);

    render(<OnboardingReviewPage />);
    await screen.findByText('AWS Developer');

    fireEvent.click(rowFor('AWS Developer').getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), {
      target: { value: 'AWS Certified Solutions Architect' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));

    await waitFor(() => expect(screen.queryByText('AWS Developer')).not.toBeInTheDocument());
    expect(screen.getByText('AWS Certified Solutions Architect')).toBeInTheDocument();
  });

  it("drops a mis-parsed entry via the reused AddExperienceModal's Delete action, leaving the other entry of the same type intact", async () => {
    savePendingEntries([experienceEntry1, experienceEntry2]);

    render(<OnboardingReviewPage />);
    await screen.findByText('Engineer @ Acme Corp');

    fireEvent.click(rowFor('Engineer @ Acme Corp').getByRole('button', { name: /^edit$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByText('Engineer @ Acme Corp')).not.toBeInTheDocument());
    expect(screen.getByText('Engineer @ Globex Corp')).toBeInTheDocument();
    const experienceHeading = screen.getByRole('heading', { name: /experience/i });
    expect(within(experienceHeading).getByText('1')).toBeInTheDocument();
  });

  it('removes an entry from a plain review card when Remove is clicked, keeping the other entry of the same type', async () => {
    savePendingEntries([interestEntry1, interestEntry2]);

    render(<OnboardingReviewPage />);
    await screen.findByText('Chess');

    fireEvent.click(rowFor('Chess').getByRole('button', { name: /^remove$/i }));

    expect(screen.queryByText('Chess')).not.toBeInTheDocument();
    expect(screen.getByText('Marathon Running')).toBeInTheDocument();
  });

  it('persists the reviewed entries via the confirm endpoint, clears the pending handoff, and navigates to /profile on success', async () => {
    savePendingEntries([certificationEntry, interestEntry1]);
    vi.mocked(apiFetch).mockResolvedValue(buildProfile());

    render(<OnboardingReviewPage />);
    await screen.findByText('AWS Developer');

    fireEvent.click(screen.getByRole('button', { name: /^save to profile$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/profile'));
    expect(apiFetch).toHaveBeenCalledWith('/onboarding/ingest/confirm', {
      method: 'POST',
      body: JSON.stringify({ entries: [certificationEntry, interestEntry1] }),
    });
    expect(loadPendingEntries()).toBeNull();
  });

  it("shows the confirm endpoint's error message and keeps the pending entries when persisting fails", async () => {
    savePendingEntries([certificationEntry]);
    vi.mocked(apiFetch).mockRejectedValue(new Error('HTTP 500: could not save profile'));

    render(<OnboardingReviewPage />);
    await screen.findByText('AWS Developer');

    fireEvent.click(screen.getByRole('button', { name: /^save to profile$/i }));

    expect(await screen.findByText('HTTP 500: could not save profile')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalledWith('/profile');
    expect(loadPendingEntries()).toEqual([certificationEntry]);
  });

  it('disables "Save to profile" and shows a saving indicator while the confirm request is in flight', async () => {
    savePendingEntries([certificationEntry]);
    let resolveConfirm!: (value: MasterDB) => void;
    vi.mocked(apiFetch).mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );

    render(<OnboardingReviewPage />);
    await screen.findByText('AWS Developer');

    fireEvent.click(screen.getByRole('button', { name: /^save to profile$/i }));

    const savingButton = await screen.findByRole('button', { name: /^saving\.\.\.$/i });
    expect(savingButton).toBeDisabled();

    resolveConfirm(buildProfile());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/profile'));
  });

  it('writes an inline edit through to sessionStorage immediately, so a refresh does not lose it', async () => {
    savePendingEntries([certificationEntry]);
    const { unmount } = render(<OnboardingReviewPage />);
    await screen.findByText('AWS Developer');

    fireEvent.click(rowFor('AWS Developer').getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), {
      target: { value: 'AWS Certified Solutions Architect' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));
    await waitFor(() => expect(screen.queryByText('AWS Developer')).not.toBeInTheDocument());

    // Simulate a refresh: unmount and remount a fresh instance, which reads
    // sessionStorage from scratch just like a page reload would.
    unmount();
    render(<OnboardingReviewPage />);

    expect(await screen.findByText('AWS Certified Solutions Architect')).toBeInTheDocument();
    expect(screen.queryByText('AWS Developer')).not.toBeInTheDocument();
  });

  it('writes a removal through to sessionStorage immediately, so a refresh does not resurrect the entry', async () => {
    savePendingEntries([interestEntry1, interestEntry2]);
    const { unmount } = render(<OnboardingReviewPage />);
    await screen.findByText('Chess');

    fireEvent.click(rowFor('Chess').getByRole('button', { name: /^remove$/i }));
    expect(screen.queryByText('Chess')).not.toBeInTheDocument();

    unmount();
    render(<OnboardingReviewPage />);

    await screen.findByText('Marathon Running');
    expect(screen.queryByText('Chess')).not.toBeInTheDocument();
  });

  it('shows every field that will be persisted on the plain review cards for publications, volunteering, and skills', async () => {
    savePendingEntries([
      skillsEntryWithAllFields,
      publicationEntryWithAllFields,
      volunteeringEntryWithAllFields,
    ]);

    render(<OnboardingReviewPage />);

    await screen.findByText('Scaling Postgres at 10x');
    expect(screen.getByText('https://example.com/talk')).toBeInTheDocument();
    expect(screen.getByText('A deep dive into read replicas.')).toBeInTheDocument();

    expect(screen.getByText('Mentor @ Code.org')).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.getByText('Taught intro programming to high schoolers.')).toBeInTheDocument();

    expect(
      screen.getByText((_, element) => element?.textContent === 'Infrastructure & tools: Docker'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Databases: Postgres'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Soft skills: Communication'),
    ).toBeInTheDocument();
  });

  it('disables "Save to profile" once the last pending entry has been removed', async () => {
    savePendingEntries([interestEntry1]);

    render(<OnboardingReviewPage />);
    await screen.findByText('Chess');

    fireEvent.click(rowFor('Chess').getByRole('button', { name: /^remove$/i }));

    expect(screen.getByRole('button', { name: /^save to profile$/i })).toBeDisabled();
  });
});
