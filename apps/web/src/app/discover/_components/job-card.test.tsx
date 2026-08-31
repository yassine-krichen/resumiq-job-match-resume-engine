import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JobCard } from './job-card';
import { buildDiscoverJob, buildFeedItem } from './test-fixtures';

describe('JobCard', () => {
  it('renders the job title, company, and match score', () => {
    render(
      <JobCard
        item={buildFeedItem({
          matchScore: 82,
          job: buildDiscoverJob({ title: 'Backend Engineer', companyName: 'Acme Corp' }),
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('bands the match score the same way MatchScoreDisplay does for a strong match (>= 70)', () => {
    render(<JobCard item={buildFeedItem({ matchScore: 85 })} />);
    expect(screen.getByText('Strong match')).toBeInTheDocument();
  });

  it('never shows the "Why this score?" accordion, since discover-feed items carry no per-item reasons', () => {
    render(<JobCard item={buildFeedItem()} />);
    expect(screen.queryByText('Why this score?')).not.toBeInTheDocument();
  });

  it('shows at most 6 mandatory technical skills as tags', () => {
    render(
      <JobCard
        item={buildFeedItem({
          job: buildDiscoverJob({
            parsedJd: { mandatory_technical_skills: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
          }),
        })}
      />,
    );

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('F')).toBeInTheDocument();
    expect(screen.queryByText('G')).not.toBeInTheDocument();
  });

  it('shows "Location unspecified" when the job has no location and is not remote', () => {
    render(
      <JobCard item={buildFeedItem({ job: buildDiscoverJob({ location: null, remote: false }) })} />,
    );
    expect(screen.getByText(/Location unspecified/)).toBeInTheDocument();
  });

  it('appends "Remote" to a specific location when the job is remote', () => {
    render(
      <JobCard
        item={buildFeedItem({ job: buildDiscoverJob({ location: 'Berlin', remote: true }) })}
      />,
    );
    expect(screen.getByText(/Berlin · Remote/)).toBeInTheDocument();
  });

  it('appends the salary range when one is present', () => {
    render(
      <JobCard
        item={buildFeedItem({
          job: buildDiscoverJob({ location: 'Berlin', remote: false, salaryRange: '$120k-$150k' }),
        })}
      />,
    );
    expect(screen.getByText('Berlin · $120k-$150k')).toBeInTheDocument();
  });
});
