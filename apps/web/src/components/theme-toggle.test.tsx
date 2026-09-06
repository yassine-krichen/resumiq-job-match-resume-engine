import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useTheme } from 'next-themes';
import { ThemeToggle } from './theme-toggle';

vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}));

function mockTheme(resolvedTheme: string | undefined, setTheme = vi.fn()) {
  vi.mocked(useTheme).mockReturnValue({
    resolvedTheme,
    setTheme,
  } as unknown as ReturnType<typeof useTheme>);
  return setTheme;
}

describe('ThemeToggle', () => {
  it('renders a disabled placeholder before mount, then the toggle after mount', async () => {
    mockTheme('light');
    render(<ThemeToggle />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /toggle theme/i })).toBeEnabled();
    });
  });

  it('switches from light to dark when clicked', async () => {
    const setTheme = mockTheme('light');
    render(<ThemeToggle />);

    const button = await screen.findByRole('button', { name: /toggle theme/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('switches from dark to light when clicked', async () => {
    const setTheme = mockTheme('dark');
    render(<ThemeToggle />);

    const button = await screen.findByRole('button', { name: /toggle theme/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(setTheme).toHaveBeenCalledWith('light');
  });
});
