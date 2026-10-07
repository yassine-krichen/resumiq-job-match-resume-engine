import { countryOf, fitScore, hookClaim, isLowConfidence } from './review-items';
import type { ReviewItem } from './review-items';

// The detail pane as plain wrapped lines, so the screen can scroll it by slicing and a test can read it.

export type LineTone = 'title' | 'label' | 'body' | 'muted' | 'warn' | 'good' | 'link';

export interface DetailLine {
  text: string;
  tone: LineTone;
}

/** Greedy word wrap; a word longer than the width is split. Blank lines in the input are kept. */
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(8, width);
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > limit) {
        if (line !== '') {
          lines.push(line);
          line = '';
        }
        lines.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      if (line === '') line = rest;
      else if (line.length + 1 + rest.length <= limit) line += ` ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function buildDetailLines(item: ReviewItem, width: number): DetailLine[] {
  const inner = Math.max(10, width - 2);
  const lines: DetailLine[] = [];
  const section = (label: string): void => {
    if (lines.length > 0) lines.push({ text: '', tone: 'body' });
    lines.push({ text: label, tone: 'label' });
  };
  const paragraph = (text: string, tone: DetailLine['tone'] = 'body'): void => {
    for (const text_ of wrapText(text, inner)) lines.push({ text: text_, tone });
  };

  const fit = fitScore(item);
  const { draft } = item;
  paragraph(
    `${item.company.name} · ${countryOf(item)} · ${draft?.language ?? item.dossier?.data.language ?? '--'} · fit ${fit ?? '?'}${draft?.generic ? ' · generic' : ''}`,
    'title',
  );
  const contact = item.contact;
  const sourced = contact?.emailSource ? ` · ${isLowConfidence(contact) ? 'contact_confidence: low · ' : ''}${contact.emailSource}` : '';
  paragraph(
    (contact ? `to ${contact.name ? `${contact.name} ` : ''}<${contact.email}>` : 'to (no contact)') + sourced,
    isLowConfidence(contact) ? 'warn' : 'muted',
  );
  paragraph(`${item.company.status} · ${draft ? `draft v${draft.version}` : 'no draft'}`, 'muted');

  if (item.manualReason !== null) {
    section('NEEDS YOUR DECISION');
    paragraph(item.manualReason, 'warn');
    paragraph(
      draft
        ? 'e to edit it (the email checks run again; a saved edit puts it back in the normal queue), a to approve anyway (asks you to confirm), or k to kill it.'
        : 'No draft was written for this company. k to kill it; nothing else can be done here.',
      'muted',
    );
  }

  if (draft) {
    section('SUBJECT');
    paragraph(draft.subject);
    section('EMAIL');
    paragraph(draft.body);
    section('FOLLOW-UP (same thread, after the first email)');
    paragraph(draft.followUpBody);

    section('HOOK');
    const claim = hookClaim(item);
    if (claim) {
      paragraph(claim.text);
      paragraph(`"${claim.quote}"`, 'muted');
      paragraph(claim.url, 'link');
    } else {
      paragraph(draft.generic ? 'none (generic draft)' : 'the hook claim is not in the dossier', draft.generic ? 'muted' : 'warn');
    }

    section('RESUME');
    paragraph(`${draft.resumeKind === 'tailored' ? 'tailored' : 'track'} · ${draft.resumePdfPath}`, 'muted');
  }

  section('CHECKS');
  if (item.failures.length === 0 && item.notes.length === 0) paragraph('all email checks pass', 'good');
  for (const failure of item.failures) paragraph(`✗ ${failure.rule}: ${failure.detail}`, 'warn');
  for (const note of item.notes) paragraph(`! ${note}`, 'warn');
  if (item.failures.length === 0 && item.notes.length > 0) paragraph('email checks pass', 'good');
  return lines;
}
