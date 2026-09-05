import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// better-auth/react's createAuthClient hits the network/reads browser APIs
// at module init — stub it since this is a render-only smoke test.
const signInEmailMock = vi.fn();
const signUpEmailMock = vi.fn();
const signInSocialMock = vi.fn();

vi.mock('@/lib/auth-client', () => ({
  signIn: {
    social: (...args: unknown[]) => signInSocialMock(...args),
    email: (...args: unknown[]) => signInEmailMock(...args),
  },
  signUp: {
    email: (...args: unknown[]) => signUpEmailMock(...args),
  },
}));

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockReset();
    signInEmailMock.mockReset();
    signUpEmailMock.mockReset();
    signInSocialMock.mockReset();
  });

  it('renders both the GitHub and LinkedIn OAuth options', () => {
    render(<LoginPage />);

    expect(
      screen.getByRole('button', { name: /continue with github/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue with linkedin/i }),
    ).toBeInTheDocument();
  });

  it('calls signIn.social with the github provider', async () => {
    signInSocialMock.mockResolvedValue({ data: null, error: null });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /continue with github/i }));

    await waitFor(() =>
      expect(signInSocialMock).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: '/dashboard',
      }),
    );
  });

  it('calls signIn.social with the linkedin provider', async () => {
    signInSocialMock.mockResolvedValue({ data: null, error: null });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /continue with linkedin/i }));

    await waitFor(() =>
      expect(signInSocialMock).toHaveBeenCalledWith({
        provider: 'linkedin',
        callbackURL: '/dashboard',
      }),
    );
  });

  it('defaults to the sign-in form with only email and password fields', () => {
    render(<LoginPage />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
  });

  it('switches to the sign-up form and reveals the name field', () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /sign up tab/i }));

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it('signs in with email/password and redirects to the dashboard on success', async () => {
    signInEmailMock.mockResolvedValue({ data: { user: { id: '1' } }, error: null });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() =>
      expect(signInEmailMock).toHaveBeenCalledWith({
        email: 'jane@example.com',
        password: 'password123',
      }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('signs up with name/email/password and redirects to the dashboard on success', async () => {
    signUpEmailMock.mockResolvedValue({ data: { user: { id: '1' } }, error: null });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /sign up tab/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(signUpEmailMock).toHaveBeenCalledWith({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123',
      }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows an inline error message when sign-in fails', async () => {
    signInEmailMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' },
    });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() =>
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows an inline error message when sign-up fails', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { message: 'Email already in use' },
    });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /sign up tab/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(screen.getByText('Email already in use')).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('clears a stale error message when switching between sign-in and sign-up tabs', async () => {
    signInEmailMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' },
    });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() =>
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /sign up tab/i }));

    expect(screen.queryByText('Invalid email or password')).not.toBeInTheDocument();
  });
});
