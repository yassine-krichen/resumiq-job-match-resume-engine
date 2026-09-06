import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface MatchScoreDisplayProps {
  score: number;
  reasons: string[];
}

// Display-only banding, independent of the backend's gap-report threshold
// (currently 50) — a score can be "at/above threshold" and still render
// yellow here if it's a borderline 50-69 match.
function scoreBand(score: number): { color: string; ring: string; label: string } {
  if (score >= 70) return { color: 'text-emerald-600', ring: 'border-emerald-500', label: 'Strong match' };
  if (score >= 50) return { color: 'text-amber-600', ring: 'border-amber-500', label: 'Moderate match' };
  return { color: 'text-red-600', ring: 'border-red-500', label: 'Below threshold' };
}

export function MatchScoreDisplay({ score, reasons }: MatchScoreDisplayProps): React.JSX.Element {
  const band = scoreBand(score);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 text-lg font-bold ${band.ring} ${band.color}`}
        >
          {score}
        </div>
        <div>
          <p className="font-medium text-foreground">Match score</p>
          <p className="text-sm text-muted-foreground">{band.label}</p>
        </div>
      </div>

      {reasons.length > 0 && (
        <Accordion className="mt-4">
          <AccordionItem value="why-this-score">
            <AccordionTrigger>Why this score?</AccordionTrigger>
            <AccordionContent>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
