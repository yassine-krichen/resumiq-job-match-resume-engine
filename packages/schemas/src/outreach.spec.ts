import {
  OutreachClaimSchema,
  OutreachConfigSchema,
  OutreachDossierSchema,
  OutreachDraftSchema,
  OutreachInputRowSchema,
  OutreachTailoringSchema,
} from './index';

const claim = {
  id: 'c1',
  text: 'Acme open-sourced its fleet scheduler',
  url: 'https://acme.example/blog/scheduler',
  snapshot_id: 'blog.html',
  quote: 'Today we are open-sourcing the Acme fleet scheduler.',
};

const dossier = {
  company: 'Acme Robotics',
  country: 'fr',
  language: 'fr',
  timezone: 'Europe/Paris',
  claims: [claim],
  fit: { score: 4, reasons: ['TypeScript and infra overlap'], track: 'swe' },
};

const lines = {
  hours_line: 'about 20 hours a week',
  start_line: 'starting October 12',
  ask_line: 'part-time now, or a summer 2027 internship',
  overlap: { europe: 'UTC+1', us: '12:00-16:00 ET', other: 'most of your day' },
};

const config = {
  hours_per_week: 20,
  start_date: '2026-10-12',
  summer_internship: { available: true },
  availability: { en: lines, fr: lines },
  daily_cap: 20,
  sender_name: 'Yassine Krichen',
  provider: 'gmail',
};

describe('OutreachInputRowSchema', () => {
  it('turns empty strings and nulls in optional fields into undefined', () => {
    const row = OutreachInputRowSchema.parse({ company: ' Acme ', email: 'a@acme.com', name: '', role: null, notes: ' x ' });

    expect(row).toEqual({ company: 'Acme', email: 'a@acme.com', notes: 'x' });
  });

  it('requires a company and a valid email', () => {
    expect(OutreachInputRowSchema.safeParse({ company: '', email: 'a@acme.com' }).success).toBe(false);
    expect(OutreachInputRowSchema.safeParse({ company: 'Acme', email: 'nope' }).success).toBe(false);
  });
});

describe('OutreachClaimSchema', () => {
  it('rejects a quote shorter than 20 or longer than 300 characters', () => {
    expect(OutreachClaimSchema.safeParse({ ...claim, quote: 'too short' }).success).toBe(false);
    expect(OutreachClaimSchema.safeParse({ ...claim, quote: 'x'.repeat(301) }).success).toBe(false);
    expect(OutreachClaimSchema.safeParse({ ...claim, quote: 'x'.repeat(300) }).success).toBe(true);
  });

  it('rejects a non-http URL', () => {
    expect(OutreachClaimSchema.safeParse({ ...claim, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(OutreachClaimSchema.safeParse({ ...claim, url: 'ftp://acme.example/x' }).success).toBe(false);
  });
});

describe('OutreachDossierSchema', () => {
  it('normalizes the country code to uppercase', () => {
    expect(OutreachDossierSchema.parse(dossier).country).toBe('FR');
  });

  it.each([
    ['a country that is not ISO-2', { country: 'FRA' }],
    ['a language other than en or fr', { language: 'de' }],
    ['a timezone that is not IANA', { timezone: 'Paris' }],
    ['an abbreviation instead of a zone', { timezone: 'EST' }],
    ['a fit score of 6', { fit: { score: 6, reasons: ['x'], track: 'swe' } }],
    ['a fit score of 0', { fit: { score: 0, reasons: ['x'], track: 'swe' } }],
    ['an unknown track', { fit: { score: 3, reasons: ['x'], track: 'data' } }],
    ['no fit reasons', { fit: { score: 3, reasons: [], track: 'ai' } }],
    ['duplicate claim ids', { claims: [claim, claim] }],
  ])('rejects %s', (_label, change) => {
    expect(OutreachDossierSchema.safeParse({ ...dossier, ...change }).success).toBe(false);
  });

  it('defaults the company tech stack to an empty list and keeps a provided one', () => {
    expect(OutreachDossierSchema.parse(dossier).tech_stack).toEqual([]);
    expect(OutreachDossierSchema.parse({ ...dossier, tech_stack: ['Kafka', 'Go'] }).tech_stack).toEqual(['Kafka', 'Go']);
  });

  it('accepts a dossier with no claims, which becomes a generic draft later', () => {
    expect(OutreachDossierSchema.safeParse({ ...dossier, claims: [] }).success).toBe(true);
  });
});

describe('OutreachTailoringSchema', () => {
  const bullet = (source: string) => ({ text: 'A rewritten bullet about shipping.', source_entry: source });
  const tailoring = {
    summary: 'Engineer who ships reliable internal tools.',
    entries: [
      { kind: 'project', name: 'TickIT', bullets: [bullet('TickIT')] },
      { kind: 'experience', name: 'Orange', bullets: [bullet('Orange')] },
    ],
    skills: { programming_languages: ['Java'] },
  };

  it('defaults omitted skill categories to empty lists', () => {
    expect(OutreachTailoringSchema.parse(tailoring).skills.databases).toEqual([]);
  });

  it('allows 4 bullets on an experience but only 3 on a project', () => {
    const four = [bullet('x'), bullet('x'), bullet('x'), bullet('x')];

    const experience = { ...tailoring, entries: [{ kind: 'experience', name: 'Orange', bullets: four }, tailoring.entries[0]] };
    const project = { ...tailoring, entries: [{ kind: 'project', name: 'TickIT', bullets: four }, tailoring.entries[1]] };

    expect(OutreachTailoringSchema.safeParse(experience).success).toBe(true);
    expect(OutreachTailoringSchema.safeParse(project).success).toBe(false);
  });

  it('requires 2 to 4 entries and rejects duplicates', () => {
    expect(OutreachTailoringSchema.safeParse({ ...tailoring, entries: [tailoring.entries[0]] }).success).toBe(false);
    expect(OutreachTailoringSchema.safeParse({ ...tailoring, entries: [tailoring.entries[0], tailoring.entries[0]] }).success).toBe(
      false,
    );
  });
});

describe('OutreachDraftSchema', () => {
  const draft = {
    subject: 's',
    body: 'b',
    follow_up_body: 'f',
    cta: 'c',
    hook_claim_id: 'c1',
    anchor_phrase: 'phrase',
    mentioned_projects: [],
    generic: false,
  };

  it('requires a hook and an anchor phrase unless the draft is generic', () => {
    expect(OutreachDraftSchema.safeParse({ ...draft, hook_claim_id: null }).success).toBe(false);
    expect(OutreachDraftSchema.safeParse({ ...draft, anchor_phrase: null }).success).toBe(false);
    expect(OutreachDraftSchema.safeParse({ ...draft, generic: true, hook_claim_id: null, anchor_phrase: null }).success).toBe(true);
  });
});

describe('OutreachConfigSchema', () => {
  it('fills the documented defaults', () => {
    const parsed = OutreachConfigSchema.parse(config);

    expect(parsed.gap_min_minutes).toBe(4);
    expect(parsed.gap_max_minutes).toBe(11);
    expect(parsed.send_window).toEqual({ start: '08:30', end: '10:30' });
    expect(parsed.follow_up_business_days).toBe(5);
  });

  it('rejects a daily cap above 30', () => {
    expect(OutreachConfigSchema.safeParse({ ...config, daily_cap: 31 }).success).toBe(false);
    expect(OutreachConfigSchema.safeParse({ ...config, daily_cap: 30 }).success).toBe(true);
  });

  it('accepts only the gmail provider', () => {
    expect(OutreachConfigSchema.safeParse({ ...config, provider: 'graph' }).success).toBe(false);
    expect(OutreachConfigSchema.safeParse({ ...config, provider: 'smtp' }).success).toBe(false);
  });

  it('rejects a gap range where max is below min and a window that ends before it starts', () => {
    expect(OutreachConfigSchema.safeParse({ ...config, gap_min_minutes: 12, gap_max_minutes: 5 }).success).toBe(false);
    expect(OutreachConfigSchema.safeParse({ ...config, send_window: { start: '10:30', end: '08:30' } }).success).toBe(false);
  });

  it('requires the summer internship block and a YYYY-MM-DD start date', () => {
    const { summer_internship: _removed, ...withoutInternship } = config;

    expect(OutreachConfigSchema.safeParse(withoutInternship).success).toBe(false);
    expect(OutreachConfigSchema.safeParse({ ...config, start_date: 'October 12' }).success).toBe(false);
    expect(
      OutreachConfigSchema.safeParse({ ...config, summer_internship: { available: true, start: '2027-06-01', min_weeks: 8 } }).success,
    ).toBe(true);
  });
});
