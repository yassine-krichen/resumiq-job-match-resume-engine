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
      <div className="w-full max-w-5xl rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center">
        <p className="text-zinc-400">No applications match these filters.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Match</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-zinc-50">
              <td className="px-4 py-3">
                <Link
                  href={`/applications/${item.id}`}
                  className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                >
                  {item.job.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-600">{item.job.companyName}</td>
              <td className="px-4 py-3 text-zinc-500">
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
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
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
