import Link from 'next/link';
import { STATUS_LABELS, type ApplicationListItem } from './types';

// Same score-banding thresholds as apply/manual's MatchScoreDisplay, kept
// local — that component's `scoreBand` isn't exported and pulling in the
// accordion-heavy display component just for its color logic would add more
// coupling than this one-off badge is worth.
function matchScoreBadgeClass(score: number): string {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700';
  if (score >= 50) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

interface ApplicationsTableProps {
  items: ApplicationListItem[];
}

export function ApplicationsTable({ items }: ApplicationsTableProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="w-full max-w-5xl rounded-xl border border-dashed border-border bg-card p-12 text-center">
        <p className="text-muted-foreground">No applications match these filters.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Match</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-muted">
              <td className="px-4 py-3">
                <Link
                  href={`/applications/${item.id}`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {item.job.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{item.job.companyName}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${matchScoreBadgeClass(item.matchScore)}`}
                >
                  {item.matchScore}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {STATUS_LABELS[item.status] ?? item.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
