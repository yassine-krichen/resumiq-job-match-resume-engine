import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InterviewPrepReport } from './interview-prep-report';
import { buildInterviewPrepReport } from '../../../apply/manual/_components/test-fixtures';

describe('InterviewPrepReport', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders each technical topic with its probability badge', () => {
    render(
      <InterviewPrepReport
        report={buildInterviewPrepReport({
          technical_topics: [
            { topic: 'Kubernetes', probability: 'high', reasoning: 'Listed as required.' },
            { topic: 'GraphQL', probability: 'low', reasoning: 'Barely mentioned.' },
          ],
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /high.*Kubernetes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /low.*GraphQL/ })).toBeInTheDocument();
  });

  it.each([
    ['high', 'bg-red-100'],
    ['medium', 'bg-amber-100'],
    ['low', 'bg-zinc-100'],
  ] as const)('gives a %s-probability topic the %s badge class', (probability, expectedClass) => {
    render(
      <InterviewPrepReport
        report={buildInterviewPrepReport({
          technical_topics: [{ topic: 'Kubernetes', probability, reasoning: 'x' }],
        })}
      />,
    );

    expect(screen.getByText(probability)).toHaveClass(expectedClass);
  });

  it('reveals a technical topic\'s reasoning once its accordion trigger is expanded', () => {
    render(
      <InterviewPrepReport
        report={buildInterviewPrepReport({
          technical_topics: [
            { topic: 'Kubernetes', probability: 'high', reasoning: 'Listed as a required skill.' },
          ],
        })}
      />,
    );

    expect(screen.queryByText('Listed as a required skill.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Kubernetes/ }));

    expect(screen.getByText('Listed as a required skill.')).toBeInTheDocument();
  });

  it('shows a fallback message when there are no technical topics', () => {
    render(<InterviewPrepReport report={buildInterviewPrepReport({ technical_topics: [] })} />);

    expect(screen.getByText('No topics identified.')).toBeInTheDocument();
  });

  it('renders each gap with its suggested framing', () => {
    render(
      <InterviewPrepReport
        report={buildInterviewPrepReport({
          gaps_to_address: [
            { gap: 'No production Kubernetes experience', suggested_framing: 'Frame via Docker exposure.' },
          ],
        })}
      />,
    );

    expect(screen.getByText('No production Kubernetes experience')).toBeInTheDocument();
    expect(screen.getByText('Frame via Docker exposure.')).toBeInTheDocument();
  });

  it('shows a fallback message when there are no gaps to address', () => {
    render(<InterviewPrepReport report={buildInterviewPrepReport({ gaps_to_address: [] })} />);

    expect(screen.getByText('No gaps identified.')).toBeInTheDocument();
  });

  it('shows a behavioral question and reveals its company signal and suggested angle once expanded', () => {
    render(
      <InterviewPrepReport
        report={buildInterviewPrepReport({
          behavioral_questions: [
            {
              question: 'Tell me about a conflict with a teammate.',
              company_signal: 'Values collaboration.',
              suggested_angle: 'Use the Acme Corp story.',
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Tell me about a conflict with a teammate.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Values collaboration.')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Tell me about a conflict with a teammate.' }),
    );

    expect(screen.getByText('Values collaboration.')).toBeInTheDocument();
    expect(screen.getByText('Use the Acme Corp story.')).toBeInTheDocument();
  });

  it('renders each talking point with what it is matched to', () => {
    render(
      <InterviewPrepReport
        report={buildInterviewPrepReport({
          talking_points: [
            { point: 'Scaled a system to 10x traffic.', matched_to: 'Scalability requirement.' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Scaled a system to 10x traffic.')).toBeInTheDocument();
    expect(screen.getByText(/Matched to:/)).toHaveTextContent(
      'Matched to: Scalability requirement.',
    );
  });

  it('copies a plain-text summary covering all four sections to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const report = buildInterviewPrepReport({
      technical_topics: [{ topic: 'Kubernetes', probability: 'high', reasoning: 'Required skill.' }],
      gaps_to_address: [{ gap: 'No K8s experience', suggested_framing: 'Frame via Docker.' }],
      behavioral_questions: [
        {
          question: 'Tell me about a conflict.',
          company_signal: 'Values collaboration.',
          suggested_angle: 'Acme story.',
        },
      ],
      talking_points: [{ point: 'Scaled to 10x traffic.', matched_to: 'Scalability need.' }],
    });

    render(<InterviewPrepReport report={report} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedText = writeText.mock.calls[0][0] as string;
    expect(copiedText).toContain('Kubernetes');
    expect(copiedText).toContain('Required skill.');
    expect(copiedText).toContain('No K8s experience');
    expect(copiedText).toContain('Frame via Docker.');
    expect(copiedText).toContain('Tell me about a conflict.');
    expect(copiedText).toContain('Values collaboration.');
    expect(copiedText).toContain('Scaled to 10x traffic.');
    expect(copiedText).toContain('Scalability need.');
    await screen.findByRole('button', { name: /copied/i });
  });

  it('shows an error message and keeps the label as "Copy" when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<InterviewPrepReport report={buildInterviewPrepReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    await screen.findByText('Could not copy to clipboard.');
    expect(screen.queryByRole('button', { name: /copied/i })).not.toBeInTheDocument();
  });

  it('calls window.print() when the print button is clicked', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(<InterviewPrepReport report={buildInterviewPrepReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /print/i }));

    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
