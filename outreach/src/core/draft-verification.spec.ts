import { loadExampleConfig, loadExampleInventory } from '../testing/test-env';

import { buildCandidateFacts, buildConfigLines, evaluateVerification, sentencesOfDraft, splitSentences } from './draft-verification';
import type { VerifyInput } from './draft-verification';

const config = loadExampleConfig();
const db = loadExampleInventory();

describe('splitSentences', () => {
  it('splits on full stops, question marks and exclamation marks', () => {
    expect(splitSentences('I built it. Would you talk? Great!')).toEqual(['I built it.', 'Would you talk?', 'Great!']);
  });

  it('keeps abbreviations and decimals inside one sentence', () => {
    expect(splitSentences('I used e.g. Python 3.11 for it. Then I stopped.')).toEqual([
      'I used e.g. Python 3.11 for it.',
      'Then I stopped.',
    ]);
  });

  it('does not split before a lowercase word', () => {
    expect(splitSentences('It ran in approx. three seconds. Done.')).toEqual(['It ran in approx. three seconds.', 'Done.']);
  });

  it('splits French text with a space before the question mark', () => {
    expect(splitSentences("Auriez-vous le temps ? Merci d'avance.")).toEqual(['Auriez-vous le temps ?', "Merci d'avance."]);
  });

  it('collapses line breaks and returns nothing for blank text', () => {
    expect(splitSentences('First line.\n\nSecond line.')).toEqual(['First line.', 'Second line.']);
    expect(splitSentences('  \n ')).toEqual([]);
  });
});

describe('sentencesOfDraft', () => {
  it('numbers the sentences of the body and then the follow-up continuously', () => {
    expect(sentencesOfDraft('One. Two.', 'Three.')).toEqual([
      { i: 0, part: 'body', text: 'One.' },
      { i: 1, part: 'body', text: 'Two.' },
      { i: 2, part: 'follow_up', text: 'Three.' },
    ]);
  });
});

describe('buildCandidateFacts and buildConfigLines', () => {
  it('lists the candidate projects with their technologies and no contact details', () => {
    const facts = buildCandidateFacts(db, config).join('\n');
    expect(facts).toContain(db.projects[0].name);
    expect(facts).toContain(db.projects[0].technologies_used[0]);
    expect(facts).not.toContain(db.personal_info.email);
    expect(facts).not.toContain(db.personal_info.phone);
  });

  it('gives the availability lines of the draft language and the internship', () => {
    const lines = buildConfigLines(config, 'fr');
    expect(lines).toContain(config.outreach.availability.fr.hours_line);
    expect(lines).not.toContain(config.outreach.availability.en.hours_line);
    expect(lines.join('\n')).toMatch(/summer internship/i);
  });
});

function inputFor(sentences: string[]): VerifyInput {
  return {
    language: 'en',
    company: 'Acme Robotics',
    sentences: sentences.map((text, i) => ({ i, part: 'body' as const, text })),
    verified_claims: [{ id: 'c1', text: 'Acme open-sources its scheduler', quote: 'We open-sourced the scheduler.' }],
    candidate_facts: ['Project DocuAsk: a RAG assistant'],
    config_lines: ['I can commit about 20 hours a week'],
  };
}

describe('evaluateVerification', () => {
  const input = inputFor(['Hi Claire, I saw you open-sourced the scheduler.', 'I built DocuAsk.', 'Would you talk?']);

  it('accepts a verdict per sentence when every fact has a known source', () => {
    const result = evaluateVerification(input, {
      sentences: [
        { i: 0, supported: true, by: 'c1' },
        { i: 1, supported: true, by: 'candidate' },
        { i: 2, supported: false, by: null, fact: false },
      ],
    });
    expect(result).toEqual({ status: 'ok', issues: [] });
  });

  it('flags an unsupported sentence that states a fact', () => {
    const result = evaluateVerification(input, {
      sentences: [
        { i: 0, supported: false, by: null },
        { i: 1, supported: true, by: 'candidate' },
        { i: 2, supported: true, by: 'config' },
      ],
    });
    expect(result).toMatchObject({ status: 'ok', issues: [{ i: 0, reason: 'unsupported' }] });
  });

  it('does not flag an unsupported sentence that states no fact', () => {
    const result = evaluateVerification(inputFor(['Thanks for reading.']), { sentences: [{ i: 0, supported: false, by: null, fact: false }] });
    expect(result).toEqual({ status: 'ok', issues: [] });
  });

  it('still treats a sentence with a number as a fact when the verifier says it is not one', () => {
    const result = evaluateVerification(inputFor(['I wrote 40 tests.']), { sentences: [{ i: 0, supported: false, by: null, fact: false }] });
    expect(result).toMatchObject({ status: 'ok', issues: [{ i: 0, reason: 'unsupported' }] });
  });

  it('flags a supported sentence that names no source or a source it was not given', () => {
    const result = evaluateVerification(input, {
      sentences: [
        { i: 0, supported: true, by: null },
        { i: 1, supported: true, by: 'c9' },
        { i: 2, supported: true, by: 'config' },
      ],
    });
    expect(result).toMatchObject({
      status: 'ok',
      issues: [
        { i: 0, reason: 'no_source' },
        { i: 1, reason: 'unknown_source' },
      ],
    });
  });

  it('is invalid when a sentence has no verdict', () => {
    const result = evaluateVerification(input, { sentences: [{ i: 0, supported: true, by: 'c1' }] });
    expect(result).toMatchObject({ status: 'invalid' });
    expect(JSON.stringify(result)).toContain('1, 2');
  });

  it('is invalid when a verdict repeats or invents a sentence index', () => {
    const duplicate = evaluateVerification(inputFor(['One fact.']), {
      sentences: [
        { i: 0, supported: true, by: 'candidate' },
        { i: 0, supported: true, by: 'candidate' },
      ],
    });
    const invented = evaluateVerification(inputFor(['One fact.']), {
      sentences: [
        { i: 0, supported: true, by: 'candidate' },
        { i: 7, supported: true, by: 'candidate' },
      ],
    });
    expect(duplicate.status).toBe('invalid');
    expect(invented.status).toBe('invalid');
  });

  it('is invalid when the output is not the expected shape', () => {
    expect(evaluateVerification(input, { verdicts: [] }).status).toBe('invalid');
    expect(evaluateVerification(input, 'ok').status).toBe('invalid');
  });
});
