// Reused directly from /apply/manual rather than duplicated — same score
// banding/reasons accordion, whether the score comes from a full analysis
// or a discover-feed match preview.
import { MatchScoreDisplay } from '../../apply/manual/_components/match-score-display';
import type { DiscoverFeedItem } from './types';

const MAX_SKILLS_SHOWN = 6;

interface JobCardProps {
  item: DiscoverFeedItem;
}

function locationSummary(job: DiscoverFeedItem['job']): string {
  const parts = [job.location, job.remote ? 'Remote' : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Location unspecified';
}

export function JobCard({ item }: JobCardProps): React.JSX.Element {
  const { job, matchScore } = item;
  const topSkills = job.parsedJd?.mandatory_technical_skills?.slice(0, MAX_SKILLS_SHOWN) ?? [];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{job.title}</h2>
        <p className="text-sm text-muted-foreground">{job.companyName}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {locationSummary(job)}
          {job.salaryRange ? ` · ${job.salaryRange}` : ''}
        </p>
        {job.parsedJd?.seniority && (
          <p className="mt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {job.parsedJd.seniority}
          </p>
        )}
      </div>

      {topSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topSkills.map((skill) => (
            <span key={skill} className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
              {skill}
            </span>
          ))}
        </div>
      )}

      <MatchScoreDisplay score={matchScore} reasons={[]} />
    </div>
  );
}
