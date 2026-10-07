import type { OutreachConfig, OutreachDraft, OutreachLanguage } from '../schemas/outreach';

import { claim, companyName, config, enDraft, frDraft, masterDb } from './__fixtures__/outreach-fixtures';
import { critiqueDraft } from './critic';
import type { CriticRule } from './critic';

const baseDrafts: Record<OutreachLanguage, OutreachDraft> = { en: enDraft, fr: frDraft };

function critique(
  language: OutreachLanguage,
  change: (draft: OutreachDraft) => OutreachDraft = (draft) => draft,
  options: { config?: OutreachConfig; timezone?: string } = {},
): CriticRule[] {
  const result = critiqueDraft({
    draft: change(baseDrafts[language]),
    language,
    companyName,
    timezone: options.timezone ?? 'Europe/Paris',
    config: options.config ?? config,
    verifiedClaims: [claim],
    masterDb,
  });
  return result.failures.map((failure) => failure.rule);
}

const languages: OutreachLanguage[] = ['en', 'fr'];

describe.each(languages)('critiqueDraft (%s)', (language) => {
  it('passes a well-formed draft', () => {
    const result = critiqueDraft({
      draft: baseDrafts[language],
      language,
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    });

    expect(result).toEqual({ pass: true, failures: [] });
  });

  it('fails a subject longer than 60 characters', () => {
    expect(critique(language, (d) => ({ ...d, subject: 'A very long subject line about fleet schedulers and part-time work' }))).toContain(
      'subject_length',
    );
  });

  it('fails an exclamation mark in the subject', () => {
    expect(critique(language, (d) => ({ ...d, subject: `${d.subject}!` }))).toContain('subject_exclamation');
  });

  it('fails an all-caps word in the subject but allows short acronyms', () => {
    expect(critique(language, (d) => ({ ...d, subject: 'URGENT developer for you' }))).toContain('subject_all_caps');
    expect(critique(language, (d) => ({ ...d, subject: 'AI developer for Acme' }))).not.toContain('subject_all_caps');
  });

  it('fails a body that is too short or too long', () => {
    expect(critique(language, (d) => ({ ...d, body: `${d.anchor_phrase} ${d.cta}` }))).toContain('body_word_count');
    expect(critique(language, (d) => ({ ...d, body: `${d.body} ${'word '.repeat(80)}` }))).toContain('body_word_count');
  });

  it('fails a follow-up outside 25-70 words', () => {
    expect(critique(language, (d) => ({ ...d, follow_up_body: 'Short note.' }))).toContain('follow_up_word_count');
    expect(critique(language, (d) => ({ ...d, follow_up_body: 'word '.repeat(80) }))).toContain('follow_up_word_count');
  });

  it('fails a banned phrase in the body', () => {
    const banned = language === 'en' ? 'I am passionate about robotics.' : 'Je suis passionné de robotique.';

    expect(critique(language, (d) => ({ ...d, body: `${d.body} ${banned}` }))).toContain('banned_phrase');
  });

  it('fails a banned phrase in the other language too', () => {
    const banned = language === 'en' ? "N'hésitez pas à répondre." : 'I am reaching out today.';

    expect(critique(language, (d) => ({ ...d, body: `${d.body} ${banned}` }))).toContain('banned_phrase');
  });

  it('fails a filler follow-up', () => {
    expect(
      critique(language, (d) => ({ ...d, follow_up_body: `${d.follow_up_body} Just following up on my note.` })),
    ).toContain('banned_phrase');
  });

  it('fails a call to action that is not in the body exactly once', () => {
    expect(critique(language, (d) => ({ ...d, cta: 'A sentence that is nowhere in the body.' }))).toContain(
      'call_to_action',
    );
    expect(critique(language, (d) => ({ ...d, body: `${d.body} ${d.cta}` }))).toContain('call_to_action');
  });

  it('fails more than one question mark', () => {
    const extra = language === 'en' ? 'Does that work? Or not?' : 'Cela convient ? Ou pas ?';

    expect(critique(language, (d) => ({ ...d, body: `${d.body} ${extra}` }))).toContain('question_marks');
  });

  it('fails a hook that does not point to a verified claim', () => {
    expect(critique(language, (d) => ({ ...d, hook_claim_id: 'unverified' }))).toContain('hook');
  });

  it('fails an anchor phrase that is not verbatim in the body', () => {
    expect(critique(language, (d) => ({ ...d, anchor_phrase: 'a phrase that is not in the email' }))).toContain('hook');
  });

  it('does not require a hook from a generic draft', () => {
    const generic = (d: OutreachDraft): OutreachDraft => ({ ...d, generic: true, hook_claim_id: null, anchor_phrase: null });

    expect(critique(language, generic)).not.toContain('hook');
  });

  it('fails when the hours, start date or overlap line is missing', () => {
    const lines = config.availability[language];

    for (const line of [lines.hours_line, lines.start_line, lines.overlap.europe]) {
      expect(critique(language, (d) => ({ ...d, body: d.body.replace(line, 'something else entirely') }))).toContain(
        'availability',
      );
    }
  });

  it('requires the overlap line that matches the recipient region', () => {
    expect(critique(language, undefined, { timezone: 'America/New_York' })).toContain('availability');
  });

  it('fails a number that is in neither the profile, the cited quote nor the config', () => {
    const invented = language === 'en' ? 'I cut costs by 97%.' : 'J\'ai réduit les coûts de 97 %.';

    expect(critique(language, (d) => ({ ...d, body: `${d.body} ${invented}` }))).toContain('invented_number');
  });

  it('accepts numbers that come from the profile and the config', () => {
    expect(critique(language)).not.toContain('invented_number');
  });

  it('fails a project that is not in data_inventory', () => {
    expect(critique(language, (d) => ({ ...d, mentioned_projects: ['Ghost Project'] }))).toContain('unknown_project');
  });

  it('fails a non-generic draft with no proof point named in the body', () => {
    expect(critique(language, (d) => ({ ...d, mentioned_projects: [] }))).toContain('proof_point');
    expect(critique(language, (d) => ({ ...d, mentioned_projects: ['Resume Engine'] }))).toContain('proof_point');
  });

  it('fails a link that is not one of your own and accepts a deeper path under your own repo', () => {
    expect(critique(language, (d) => ({ ...d, body: `${d.body} See https://evil.example/me` }))).toContain('foreign_link');
    expect(critique(language, (d) => ({ ...d, body: `${d.body} Code: github.com/jane-doe-example/tickit/issues` }))).not.toContain(
      'foreign_link',
    );
  });

  it('fails a placeholder', () => {
    expect(critique(language, (d) => ({ ...d, body: `${d.body} [Your Name]` }))).toContain('placeholder');
    expect(critique(language, (d) => ({ ...d, body: `${d.body} {{company}}` }))).toContain('placeholder');
  });

  it('fails markdown', () => {
    expect(critique(language, (d) => ({ ...d, body: `${d.body} This is **important**.` }))).toContain('markdown');
    expect(critique(language, (d) => ({ ...d, body: `${d.body}\n- a bullet point` }))).toContain('markdown');
  });

  it('fails an em dash', () => {
    expect(critique(language, (d) => ({ ...d, body: `${d.body} It works — really.` }))).toContain('em_dash');
  });

  it('fails when the company name is in neither the subject nor the body', () => {
    expect(
      critique(language, (d) => ({
        ...d,
        body: d.body.replace('Acme Robotics', 'your company'),
        anchor_phrase: d.anchor_phrase,
      })),
    ).toContain('company_name');
  });

  it('accepts the company name without its legal suffix', () => {
    const result = critiqueDraft({
      draft: baseDrafts[language],
      language,
      companyName: 'Acme Robotics Inc.',
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    });

    expect(result.failures.map((f) => f.rule)).not.toContain('company_name');
  });

  it('requires the summer internship to be mentioned when the config says it is available', () => {
    const withoutInternship = (d: OutreachDraft): OutreachDraft => ({
      ...d,
      body: d.body.replace(language === 'en' ? 'or join you for a summer 2027 internship' : "ou pour un stage d'été 2027", 'for now'),
    });

    expect(critique(language, withoutInternship)).toContain('internship_mention');
    expect(
      critique(language, withoutInternship, { config: { ...config, summer_internship: { available: false } } }),
    ).not.toContain('internship_mention');
  });
});

describe('critiqueDraft number allowlist', () => {
  function numberFailures(draft: OutreachDraft, claimQuote = claim.quote): string[] {
    return critiqueDraft({
      draft,
      language: 'en',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [{ ...claim, quote: claimQuote }],
      masterDb,
    })
      .failures.filter((failure) => failure.rule === 'invented_number')
      .map((failure) => failure.detail);
  }

  it('rejects a number that is in the profile but not in an entry the draft mentions', () => {
    // 15 is a metric of Acme Corp; the draft only mentions TickIT.
    expect(numberFailures({ ...enDraft, body: `${enDraft.body} I cut reports to 15 minutes.` })).toHaveLength(1);
  });

  it('rejects digits from unrelated profile fields such as the phone number', () => {
    expect(numberFailures({ ...enDraft, body: `${enDraft.body} Call +216 00 000 000.` }).length).toBeGreaterThan(0);
  });

  it('rejects a number that is only in the claim summary text, not in its verbatim quote', () => {
    const text = 'Acme Robotics open-sourced its fleet scheduler used by 900 warehouses';

    const failures = critiqueDraft({
      draft: { ...enDraft, body: `${enDraft.body} It serves 900 warehouses.` },
      language: 'en',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [{ ...claim, text }],
      masterDb,
    }).failures;

    expect(failures.map((failure) => failure.rule)).toContain('invented_number');
  });

  it('accepts a number from the cited quote and numbers from a mentioned entry', () => {
    const quote = 'Today we are open-sourcing the Acme fleet scheduler 2.0 release.';

    expect(numberFailures({ ...enDraft, body: `${enDraft.body} Version 2.0 looks great.` }, quote)).toEqual([]);
    expect(numberFailures({ ...enDraft, body: `${enDraft.body} I migrated 12,000 cases.` })).toEqual([]);
  });

  it('accepts the config internship start date and weeks', () => {
    const body = `${enDraft.body} I can stay 8 weeks from 2027-06-01.`;

    expect(numberFailures({ ...enDraft, body })).toEqual([]);
  });
});

describe('critiqueDraft details', () => {
  it.each([
    'I hope this email finds you well.',
    'I hope you are doing well.',
    "I'm writing to ask about openings.",
    'I hope you’re doing well.',
  ])('fails the banned English variant "%s"', (phrase) => {
    const rules = critiqueDraft({
      draft: { ...enDraft, body: `${enDraft.body} ${phrase}` },
      language: 'en',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    }).failures.map((failure) => failure.rule);

    expect(rules).toContain('banned_phrase');
  });

  it('fails the banned French variant "je vous écris"', () => {
    const rules = critiqueDraft({
      draft: { ...frDraft, body: `${frDraft.body} Je vous écris aujourd'hui.` },
      language: 'fr',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    }).failures.map((failure) => failure.rule);

    expect(rules).toContain('banned_phrase');
  });

  function rulesFor(draft: OutreachDraft, language: OutreachLanguage = 'en', name = companyName): CriticRule[] {
    return critiqueDraft({
      draft,
      language,
      companyName: name,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    }).failures.map((failure) => failure.rule);
  }

  it('counts a question mark in the subject toward the single allowed question mark', () => {
    expect(rulesFor({ ...enDraft, subject: 'Open to a part-time developer?' })).toContain('question_marks');
  });

  it('does not accept "backstage" as the French word "stage"', () => {
    const body = frDraft.body.replace("un stage d'été 2027", 'un backstage');

    expect(rulesFor({ ...frDraft, body }, 'fr')).toContain('internship_mention');
  });

  it('does not accept a longer word as the company name', () => {
    const body = enDraft.body.replace('Acme Robotics', 'Acmesoft Robotics');

    expect(rulesFor({ ...enDraft, body }, 'en', 'Acme')).toContain('company_name');
    expect(rulesFor(enDraft, 'en', 'Acme Robotics')).not.toContain('company_name');
  });

  it('flags a bare-domain link and ignores the domain part of an email address', () => {
    expect(rulesFor({ ...enDraft, body: `${enDraft.body} Details at acme.io/x` })).toContain('foreign_link');
    expect(rulesFor({ ...enDraft, body: `${enDraft.body} Reach me at jane.doe@example.com` })).not.toContain('foreign_link');
    expect(rulesFor({ ...enDraft, body: `${enDraft.body} Code is at github.com/jane-doe-example/tickit` })).not.toContain('foreign_link');
  });

  it('checks the language of the body and the follow-up separately', () => {
    const englishBodyFrenchFollowUp = { ...enDraft, follow_up_body: frDraft.follow_up_body };
    const frenchBodyEnglishFollowUp = { ...frDraft, follow_up_body: enDraft.follow_up_body };

    expect(rulesFor(englishBodyFrenchFollowUp, 'en')).toContain('language');
    expect(rulesFor(frenchBodyEnglishFollowUp, 'fr')).toContain('language');
  });
});

describe('critiqueDraft language check', () => {
  it('fails French text when English is expected, and the reverse', () => {
    const frenchAsEnglish = critiqueDraft({
      draft: frDraft,
      language: 'en',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    });
    const englishAsFrench = critiqueDraft({
      draft: enDraft,
      language: 'fr',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    });

    expect(frenchAsEnglish.failures.map((f) => f.rule)).toContain('language');
    expect(englishAsFrench.failures.map((f) => f.rule)).toContain('language');
  });
});

describe('critiqueDraft reporting', () => {
  it('reports every failure at once so the writer can fix them together', () => {
    const result = critiqueDraft({
      draft: { ...enDraft, subject: 'URGENT!', body: 'Short and passionate.' },
      language: 'en',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims: [claim],
      masterDb,
    });
    const rules = result.failures.map((failure) => failure.rule);

    expect(result.pass).toBe(false);
    expect(rules).toEqual(expect.arrayContaining(['subject_exclamation', 'subject_all_caps', 'body_word_count', 'banned_phrase']));
  });
});

describe('critiqueDraft follow-up claim', () => {
  const secondClaim = {
    id: 'c2',
    text: 'Acme Robotics ships to 12 countries',
    url: 'https://acme-robotics.example/about',
    snapshot_id: 'about.html',
    quote: 'Acme Robotics ships its fleet software to customers in 12 countries.',
  };

  function critiqueWith(change: (draft: OutreachDraft) => OutreachDraft, verifiedClaims = [claim, secondClaim]) {
    return critiqueDraft({
      draft: change(enDraft),
      language: 'en',
      companyName,
      timezone: 'Europe/Paris',
      config,
      verifiedClaims,
      masterDb,
    });
  }

  it('accepts a follow-up that cites a verified claim and may use numbers from its quote', () => {
    const result = critiqueWith((d) => ({
      ...d,
      follow_up_claim_id: 'c2',
      follow_up_body:
        'Hi Claire, one more thought: shipping fleet software to customers in 12 countries means the scheduler must cope with ' +
        'very different warehouse setups, and TickIT taught me to design for that. I am happy to work around your calendar. Thanks for reading.',
    }));
    expect(result.failures).toEqual([]);
  });

  it('fails a follow-up that cites a claim that was not verified', () => {
    const result = critiqueWith((d) => ({ ...d, follow_up_claim_id: 'c9' }));
    expect(result.failures.map((failure) => failure.rule)).toContain('follow_up_claim');
  });

  it('fails a follow-up that cites an unverified claim even when the claim exists in the dossier but was dropped', () => {
    const result = critiqueWith((d) => ({ ...d, follow_up_claim_id: 'c2' }), [claim]);
    expect(result.failures.map((failure) => failure.rule)).toContain('follow_up_claim');
  });

  it('keeps rejecting a number in the follow-up that no cited quote or entry contains', () => {
    const result = critiqueWith((d) => ({ ...d, follow_up_body: `${d.follow_up_body} We ship to 17 countries.` }));
    expect(result.failures.map((failure) => failure.rule)).toContain('invented_number');
  });

  it('treats a missing or null follow_up_claim_id as no citation', () => {
    expect(critiqueWith((d) => ({ ...d, follow_up_claim_id: null })).pass).toBe(true);
    expect(critiqueWith((d) => d).pass).toBe(true);
  });
});
