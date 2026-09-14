import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('renders the given title', () => {
    render(<PageHeader title="Career Profile" />);

    expect(screen.getByText('Career Profile')).toBeInTheDocument();
  });

  it('renders a back-navigation link to /dashboard', () => {
    render(<PageHeader title="Career Profile" />);

    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('renders the actions slot content when provided', () => {
    render(<PageHeader title="Settings" actions={<button>Save</button>} />);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('does not render any action controls when actions is omitted', () => {
    render(<PageHeader title="Settings" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
