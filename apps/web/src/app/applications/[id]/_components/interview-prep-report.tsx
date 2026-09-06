'use client';

import { useEffect, useRef, useState } from 'react';
import { Printer, Copy, Check } from 'lucide-react';
import type { InterviewPrepReportDto } from '@resumiq/schemas';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';

interface InterviewPrepReportProps {
  report: InterviewPrepReportDto;
}

// Same red/amber/zinc priority-color convention as GapReportView's
// mandatory/nice-to-have badges — here "high probability of coming up"
// is the thing worth flagging loudly.
function probabilityBadgeClass(probability: 'high' | 'medium' | 'low'): string {
  if (probability === 'high') return 'bg-red-100 text-red-700';
  if (probability === 'medium') return 'bg-amber-100 text-amber-700';
  return 'bg-muted text-muted-foreground';
}

function reportToPlainText(report: InterviewPrepReportDto): string {
  const lines: string[] = ['Interview Prep Report', ''];

  lines.push('Likely technical topics', '-----------------------');
  for (const t of report.technical_topics) {
    lines.push(`- [${t.probability}] ${t.topic}`, `  ${t.reasoning}`);
  }

  lines.push('', 'Gaps to address', '----------------');
  for (const g of report.gaps_to_address) {
    lines.push(`- ${g.gap}`, `  Suggested framing: ${g.suggested_framing}`);
  }

  lines.push('', 'Behavioral questions', '---------------------');
  for (const q of report.behavioral_questions) {
    lines.push(`- ${q.question}`, `  Company signal: ${q.company_signal}`, `  Suggested angle: ${q.suggested_angle}`);
  }

  lines.push('', 'Talking points', '---------------');
  for (const p of report.talking_points) {
    lines.push(`- ${p.point}`, `  Matched to: ${p.matched_to}`);
  }

  return lines.join('\n');
}

export function InterviewPrepReport({ report }: InterviewPrepReportProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const revertCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revertCopiedTimeoutRef.current) clearTimeout(revertCopiedTimeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    if (revertCopiedTimeoutRef.current) clearTimeout(revertCopiedTimeoutRef.current);

    try {
      await navigator.clipboard.writeText(reportToPlainText(report));
      setCopyError('');
      setCopied(true);
      revertCopiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError('Could not copy to clipboard.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-lg font-semibold text-foreground">Interview prep report</h2>
        <div className="flex items-center gap-2">
          {copyError && <p className="text-sm text-red-600">{copyError}</p>}
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="mb-3 text-base font-semibold">Likely technical topics</h3>
        {report.technical_topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No topics identified.</p>
        ) : (
          <Accordion>
            {report.technical_topics.map((t, i) => (
              <AccordionItem key={`${t.topic}-${i}`} value={`topic-${i}`}>
                <AccordionTrigger>
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-normal ${probabilityBadgeClass(t.probability)}`}
                    >
                      {t.probability}
                    </span>
                    {t.topic}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground">{t.reasoning}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="mb-3 text-base font-semibold">Gaps to address</h3>
        {report.gaps_to_address.length === 0 ? (
          <p className="text-sm text-muted-foreground">No gaps identified.</p>
        ) : (
          <ul className="space-y-3">
            {report.gaps_to_address.map((g, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-foreground">{g.gap}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{g.suggested_framing}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="mb-3 text-base font-semibold">Behavioral questions</h3>
        {report.behavioral_questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No behavioral questions identified.</p>
        ) : (
          <Accordion>
            {report.behavioral_questions.map((q, i) => (
              <AccordionItem key={`${q.question}-${i}`} value={`behavioral-${i}`}>
                <AccordionTrigger>{q.question}</AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Company signal: </span>
                    {q.company_signal}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Suggested angle: </span>
                    {q.suggested_angle}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="mb-3 text-base font-semibold">Talking points</h3>
        {report.talking_points.length === 0 ? (
          <p className="text-sm text-muted-foreground">No talking points identified.</p>
        ) : (
          <ul className="space-y-3">
            {report.talking_points.map((p, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-foreground">{p.point}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">Matched to: {p.matched_to}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
