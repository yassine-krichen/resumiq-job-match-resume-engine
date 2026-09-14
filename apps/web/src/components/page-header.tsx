import Link from 'next/link';

interface PageHeaderProps {
  title: string;
  /** Optional right-aligned slot — theme toggle, primary action buttons, etc. */
  actions?: React.ReactNode;
  /** Overrides the header's inner max-width, to match the page content below it. */
  containerClassName?: string;
}

/**
 * Shared page header with a real `<Link href="/dashboard">` back action —
 * deliberately not `router.back()`, which strands users on the browser's
 * native back button whenever they didn't arrive via in-app navigation.
 */
export function PageHeader({
  title,
  actions,
  containerClassName = 'mx-auto flex max-w-4xl items-center justify-between',
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className="border-b border-border bg-card px-6 py-4">
      <div className={containerClassName}>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to dashboard
        </Link>
        <h1 className="text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-3">{actions}</div>
      </div>
    </header>
  );
}
