import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from './page';

// better-auth/react's createAuthClient hits the network/reads browser APIs
// at module init — stub it since this is a render-only smoke test.
vi.mock('@/lib/auth-client', () => ({
  signIn: {
    social: vi.fn(),
  },
}));

describe('LoginPage', () => {
  it('renders both the GitHub and LinkedIn OAuth options', () => {
    render(<LoginPage />);

    expect(
      screen.getByRole('button', { name: /continue with github/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue with linkedin/i }),
    ).toBeInTheDocument();
  });
});
