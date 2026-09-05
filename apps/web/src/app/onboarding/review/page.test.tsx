import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OnboardingReviewPage from './page';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function buildProfile(overrides: Partial<MasterDB> = {}): MasterDB {
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
    ...overrides,
  };
}

describe('OnboardingReviewPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    pushMock.mockReset();
  });

  it('renders raw_achievements bullets as the primary content for an experience entry, not the technologies_used dump', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      buildProfile({
        experience: [
          {
            company: 'Acme Corp',
            company_industry: 'Software',
            role: 'Backend Engineer',
            location: 'Remote',
            location_type: 'Remote',
            startDate: 'Jan 2023',
            endDate: 'Present',
            isCurrent: true,
            core_competencies: [],
            technologies_used: ['RAG', 'Fine-tuning', 'MCP', 'AI Agents'],
            raw_achievements: ['Built the payments service handling 10k requests/day.'],
            quantifiable_metrics: [],
          },
        ],
      }),
    );

    render(<OnboardingReviewPage />);

    const achievement = await screen.findByText(
      'Built the payments service handling 10k requests/day.',
    );
    expect(achievement.tagName).toBe('LI');

    // The old bug rendered technologies_used.join(', ') as if it were the
    // achievement description. It may still appear as a small secondary tag
    // line, but it must never be the primary (list-item) content.
    const technologies = screen.getByText('RAG, Fine-tuning, MCP, AI Agents');
    expect(technologies.tagName).not.toBe('LI');
  });

  it('renders a Certifications section when profile.certifications is non-empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      buildProfile({
        certifications: [
          {
            name: 'AWS Certified Developer',
            issuer: 'AWS',
            date: '2023',
            expiration_date: '',
            credential_id: '',
            link: '',
            description: '',
          },
        ],
      }),
    );

    render(<OnboardingReviewPage />);

    expect(await screen.findByText('Certifications')).toBeInTheDocument();
    expect(screen.getByText('AWS Certified Developer')).toBeInTheDocument();
  });

  it('does not render a Certifications section when profile.certifications is empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue(buildProfile({ certifications: [] }));

    render(<OnboardingReviewPage />);

    await waitFor(() => expect(screen.getByText('Review your profile')).toBeInTheDocument());
    expect(screen.queryByText('Certifications')).not.toBeInTheDocument();
  });
});
