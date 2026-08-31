'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveGapReport } from './api';
import type { GapReport } from './types';

interface GapReportViewProps {
  applicationId: string;
  gapReport: GapReport;
}

export function GapReportView({ applicationId, gapReport }: GapReportViewProps): React.JSX.Element {
  const queryClient = useQueryClient();

  // Checkboxes are disabled while a save is in flight (see `disabled` below),
  // but the payload is still built from this ref rather than the `gapReport`
  // prop directly: it keeps toggleCompleted reading the latest known state
  // even if a toggle fires in the brief window before that disabled state commits.
  const gapReportRef = useRef(gapReport);
  useEffect(() => {
    gapReportRef.current = gapReport;
  }, [gapReport]);

  const mutation = useMutation({
    mutationFn: (next: GapReport) => saveGapReport(applicationId, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application', applicationId] });
    },
  });

  function toggleCompleted(index: number) {
    const current = gapReportRef.current;
    const next: GapReport = {
      ...current,
      missing_skills: current.missing_skills.map((skill, i) =>
        i === index ? { ...skill, completed: !skill.completed } : skill,
      ),
    };
    mutation.mutate(next);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-base font-semibold">Missing skills</h2>
        {gapReport.missing_skills.length === 0 ? (
          <p className="text-sm text-zinc-500">No specific gaps identified.</p>
        ) : (
          <ul className="space-y-3">
            {gapReport.missing_skills.map((skill, i) => (
              <li key={`${skill.skill}-${i}`} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={skill.completed ?? false}
                  onChange={() => toggleCompleted(i)}
                  disabled={mutation.isPending}
                  className="mt-1 h-4 w-4 rounded border-zinc-300"
                />
                <div>
                  <p
                    className={`text-sm font-medium ${skill.completed ? 'text-zinc-400 line-through' : 'text-zinc-900'}`}
                  >
                    {skill.skill}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-normal ${
                        skill.priority === 'mandatory'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      {skill.priority}
                    </span>
                  </p>
                  {skill.suggested_resources.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {skill.suggested_resources.join(', ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {gapReport.strengths.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold">Strengths</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600">
            {gapReport.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {gapReport.recommendations.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold">Recommendations</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600">
            {gapReport.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {mutation.isError && (
        <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}
