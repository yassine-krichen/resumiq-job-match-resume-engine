import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MatchScoreDisplay } from './match-score-display';

describe('MatchScoreDisplay', () => {
  it('labels a score of 70 (the green threshold boundary) as a strong match', () => {
    render(<MatchScoreDisplay score={70} reasons={[]} />);
    expect(screen.getByText('Strong match')).toBeInTheDocument();
  });

  it('labels a score of 69 (just below the green threshold) as a moderate match, not strong', () => {
    render(<MatchScoreDisplay score={69} reasons={[]} />);
    expect(screen.getByText('Moderate match')).toBeInTheDocument();
  });

  it('labels a score of 50 (the amber threshold boundary) as a moderate match', () => {
    render(<MatchScoreDisplay score={50} reasons={[]} />);
    expect(screen.getByText('Moderate match')).toBeInTheDocument();
  });

  it('labels a score of 49 (just below the amber threshold) as below threshold', () => {
    render(<MatchScoreDisplay score={49} reasons={[]} />);
    expect(screen.getByText('Below threshold')).toBeInTheDocument();
  });

  it('labels a score of 0 as below threshold', () => {
    render(<MatchScoreDisplay score={0} reasons={[]} />);
    expect(screen.getByText('Below threshold')).toBeInTheDocument();
  });

  it('does not render the "Why this score?" accordion when there are no reasons', () => {
    render(<MatchScoreDisplay score={80} reasons={[]} />);
    expect(screen.queryByText('Why this score?')).not.toBeInTheDocument();
  });

  it('renders every given reason inside the "Why this score?" accordion once expanded', () => {
    render(
      <MatchScoreDisplay
        score={80}
        reasons={['Strong TypeScript match', 'Missing Kubernetes experience']}
      />,
    );

    fireEvent.click(screen.getByText('Why this score?'));

    expect(screen.getByText('Strong TypeScript match')).toBeInTheDocument();
    expect(screen.getByText('Missing Kubernetes experience')).toBeInTheDocument();
  });
});
