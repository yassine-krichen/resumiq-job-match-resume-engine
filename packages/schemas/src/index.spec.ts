import {
  AwardSchema,
  CertificationSchema,
  CompatibilityResultSchema,
  ConfirmIngestSchema,
  CreateJobSchema,
  EducationEntrySchema,
  ExperienceEntrySchema,
  ExtractJobIntakeSchema,
  IngestBodySchema,
  IngestResultSchema,
  InterestEntrySchema,
  JobDNASchema,
  JobIntakeResultSchema,
  MasterDBSchema,
  PersonalInfoSchema,
  ProjectEntrySchema,
  PublicationEntrySchema,
  SkillsSchema,
  SummaryEntrySchema,
  UpdateEmailDraftSchema,
  UpdateGapReportSchema,
  UpdateResumeSelectionSchema,
  VolunteeringEntrySchema,
} from './index';

describe('CreateJobSchema', () => {
  const validRawJd = 'A backend engineering role. '.repeat(3); // > 50 chars

  it('accepts a minimal valid payload and defaults pages to 2', () => {
    const result = CreateJobSchema.parse({ raw_jd: validRawJd });

    expect(result.pages).toBe(2);
  });

  it('rejects a raw_jd shorter than 50 characters', () => {
    expect(() => CreateJobSchema.parse({ raw_jd: 'too short' })).toThrow();
  });

  it('rejects a raw_jd longer than 20,000 characters', () => {
    const tooLong = 'a'.repeat(20001);

    expect(() => CreateJobSchema.parse({ raw_jd: tooLong })).toThrow();
  });

  it('accepts pages: 1 for a one-page resume constraint', () => {
    const result = CreateJobSchema.parse({ raw_jd: validRawJd, pages: 1 });

    expect(result.pages).toBe(1);
  });

  it('rejects a pages value outside the 1 | 2 union', () => {
    expect(() => CreateJobSchema.parse({ raw_jd: validRawJd, pages: 3 })).toThrow();
  });

  it('rejects a source_url that is not a well-formed URL', () => {
    expect(() =>
      CreateJobSchema.parse({ raw_jd: validRawJd, source_url: 'not-a-url' }),
    ).toThrow();
  });

  it('accepts the full optional metadata set (title, company, location, remote, salary)', () => {
    const result = CreateJobSchema.parse({
      raw_jd: validRawJd,
      company_info: 'Series B fintech',
      source_url: 'https://boards.example.com/jobs/123',
      title: 'Backend Engineer',
      company_name: 'Acme Corp',
      location: 'Remote (US)',
      remote: true,
      salary_range: '$140k - $170k',
    });

    expect(result.title).toBe('Backend Engineer');
    expect(result.remote).toBe(true);
  });
});

describe('ExtractJobIntakeSchema', () => {
  it('rejects a raw_text shorter than 50 characters', () => {
    expect(() => ExtractJobIntakeSchema.parse({ raw_text: 'too short' })).toThrow();
  });

  it('accepts a raw_text of at least 50 characters', () => {
    const raw_text = 'A backend engineering role. '.repeat(3);

    const result = ExtractJobIntakeSchema.parse({ raw_text });

    expect(result.raw_text).toBe(raw_text);
  });

  it('rejects a raw_text longer than 20,000 characters', () => {
    const tooLong = 'a'.repeat(20001);

    expect(() => ExtractJobIntakeSchema.parse({ raw_text: tooLong })).toThrow();
  });
});

describe('JobIntakeResultSchema', () => {
  it('accepts an all-null object', () => {
    const result = JobIntakeResultSchema.parse({
      title: null,
      company_name: null,
      location: null,
      remote: null,
      salary_range: null,
      company_info_summary: null,
    });

    expect(result.title).toBeNull();
  });

  it('accepts a fully populated object', () => {
    const result = JobIntakeResultSchema.parse({
      title: 'Backend Engineer',
      company_name: 'Acme Corp',
      location: 'Remote (US)',
      remote: true,
      salary_range: '$140k - $170k',
      company_info_summary: 'A fintech infra company that values ownership.',
    });

    expect(result.company_name).toBe('Acme Corp');
    expect(result.remote).toBe(true);
  });

  it('rejects a remote value that is a string instead of boolean or null', () => {
    expect(() =>
      JobIntakeResultSchema.parse({
        title: null,
        company_name: null,
        location: null,
        remote: 'yes',
        salary_range: null,
        company_info_summary: null,
      }),
    ).toThrow();
  });
});

describe('UpdateResumeSelectionSchema', () => {
  const validSelection = {
    reasoning: 'Prioritized backend experience matching the JD',
    section_order: ['experience', 'education', 'skills'],
    experience: [{ company: 'Acme', role: 'Engineer', bullets: ['Shipped X'] }],
    projects: [],
    skills: { languages: ['TypeScript'], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] },
    certifications: [],
    awards: [],
  };

  it('accepts a valid resume selection without optional fields', () => {
    expect(() => UpdateResumeSelectionSchema.parse(validSelection)).not.toThrow();
  });

  it('accepts optional match_score, match_reasoning, summary, volunteering, and publications', () => {
    const result = UpdateResumeSelectionSchema.parse({
      ...validSelection,
      match_score: 88,
      match_reasoning: 'Strong ATS keyword coverage',
      summary: 'Backend engineer with 5 years of experience',
      volunteering: ['Code for Good'],
      publications: ['Scaling Postgres at 10x'],
    });

    expect(result.match_score).toBe(88);
    expect(result.volunteering).toEqual(['Code for Good']);
  });

  it('rejects an unrecognized section_order value', () => {
    expect(() =>
      UpdateResumeSelectionSchema.parse({ ...validSelection, section_order: ['not_a_real_section'] }),
    ).toThrow();
  });

  it('rejects a match_score outside the 0-100 range', () => {
    expect(() =>
      UpdateResumeSelectionSchema.parse({ ...validSelection, match_score: 150 }),
    ).toThrow();
  });

  it('rejects a payload missing a required field (skills)', () => {
    const { skills: _skills, ...withoutSkills } = validSelection;
    expect(() => UpdateResumeSelectionSchema.parse(withoutSkills)).toThrow();
  });
});

describe('UpdateEmailDraftSchema', () => {
  it('accepts a non-empty subject and body', () => {
    expect(() =>
      UpdateEmailDraftSchema.parse({ subject: 'Excited about the role', body: 'Hi there,' }),
    ).not.toThrow();
  });

  it('rejects an empty subject', () => {
    expect(() => UpdateEmailDraftSchema.parse({ subject: '', body: 'Hi there,' })).toThrow();
  });

  it('rejects an empty body', () => {
    expect(() => UpdateEmailDraftSchema.parse({ subject: 'Hello', body: '' })).toThrow();
  });
});

describe('UpdateGapReportSchema', () => {
  const validGapReport = {
    match_score: 42,
    missing_skills: [
      { skill: 'Kubernetes', priority: 'mandatory', suggested_resources: ['CKA course'] },
    ],
    strengths: ['Strong TypeScript background'],
    recommendations: ['Build a small k8s deployment for a side project'],
  };

  it('accepts a valid gap report', () => {
    expect(() => UpdateGapReportSchema.parse(validGapReport)).not.toThrow();
  });

  it('accepts the optional per-skill "completed" checkbox flag', () => {
    const result = UpdateGapReportSchema.parse({
      ...validGapReport,
      missing_skills: [{ ...validGapReport.missing_skills[0], completed: true }],
    });

    expect(result.missing_skills[0].completed).toBe(true);
  });

  it('rejects a missing_skills priority outside the mandatory | nice-to-have enum', () => {
    expect(() =>
      UpdateGapReportSchema.parse({
        ...validGapReport,
        missing_skills: [{ skill: 'Kubernetes', priority: 'urgent', suggested_resources: [] }],
      }),
    ).toThrow();
  });

  it('rejects a match_score outside the 0-100 range', () => {
    expect(() => UpdateGapReportSchema.parse({ ...validGapReport, match_score: -5 })).toThrow();
  });
});

describe('CompatibilityResultSchema', () => {
  const validCompatibilityResult = {
    compatible: true,
    score: 82,
    blockers: [],
    warnings: ['No direct Kubernetes experience listed'],
    suggestions: ['Highlight cloud infra work more prominently'],
    reasons: ['Strong backend match', '4/5 mandatory skills present'],
    missing_skills: [
      { skill: 'Kubernetes', priority: 'nice-to-have', suggested_resources: ['CKA course'] },
    ],
    strengths: ['Strong TypeScript background'],
    recommendations: ['Add a project demonstrating container orchestration'],
  };

  it('accepts a well-formed full payload', () => {
    expect(() => CompatibilityResultSchema.parse(validCompatibilityResult)).not.toThrow();
  });

  it('coerces a bare prose string in "reasons" into a 1-element array', () => {
    const result = CompatibilityResultSchema.parse({
      ...validCompatibilityResult,
      reasons: 'a single prose string',
    });

    expect(result.reasons).toEqual(['a single prose string']);
  });

  it('rejects a score that is a string instead of a number', () => {
    expect(() =>
      CompatibilityResultSchema.parse({ ...validCompatibilityResult, score: '82' }),
    ).toThrow();
  });

  it('rejects a score outside the 0-100 range', () => {
    expect(() =>
      CompatibilityResultSchema.parse({ ...validCompatibilityResult, score: 150 }),
    ).toThrow();
  });
});

describe('JobDNASchema', () => {
  const validJobDNA = {
    job_title: 'Backend Engineer',
    seniority: 'Senior',
    mandatory_technical_skills: ['Node.js', 'PostgreSQL'],
    mandatory_soft_skills: ['Communication'],
    nice_to_have_skills: ['Kubernetes'],
    ats_keywords: ['backend', 'node'],
    company_culture_and_values: ['Ownership', 'Move fast'],
    primary_responsibilities_summary: 'Own the payments service end to end.',
    tone_recommendation: 'Confident and direct',
  };

  it('accepts a well-formed payload', () => {
    expect(() => JobDNASchema.parse(validJobDNA)).not.toThrow();
  });

  it('coerces a bare prose string in "ats_keywords" into a 1-element array', () => {
    const result = JobDNASchema.parse({
      ...validJobDNA,
      ats_keywords: 'backend, node, postgres',
    });

    expect(result.ats_keywords).toEqual(['backend, node, postgres']);
  });
});

describe('IngestResultSchema', () => {
  const validMultiEntryPayload = {
    entries: [
      {
        type: 'experience',
        entry: {
          company: 'Acme Corp',
          company_industry: 'Software',
          role: 'Backend Engineer',
          location: 'Remote',
          location_type: 'Remote',
          startDate: 'Jan 2023',
          endDate: 'Present',
          isCurrent: true,
          core_competencies: ['Backend'],
          technologies_used: ['Node.js'],
          raw_achievements: ['Built the payments service.'],
          quantifiable_metrics: [],
        },
      },
      {
        type: 'certification',
        entry: {
          name: 'AWS Certified Developer',
          issuer: 'AWS',
          date: '2023',
          expiration_date: '',
          credential_id: '',
          link: '',
          description: 'AWS Developer Associate.',
        },
      },
    ],
  };

  it('accepts a valid multi-entry payload (experience + certification)', () => {
    expect(() => IngestResultSchema.parse(validMultiEntryPayload)).not.toThrow();
  });

  it('rejects an entry with a discriminant not in the allowed type union', () => {
    expect(() =>
      IngestResultSchema.parse({
        entries: [{ type: 'not_a_real_type', entry: {} }],
      }),
    ).toThrow();
  });

  it('rejects an entry whose sub-entry is missing required fields for its type', () => {
    expect(() =>
      IngestResultSchema.parse({
        entries: [{ type: 'experience', entry: { company: 'Acme Corp' } }],
      }),
    ).toThrow();
  });

  it('rejects an empty entries array', () => {
    expect(() => IngestResultSchema.parse({ entries: [] })).toThrow();
  });

  it('accepts entries with exactly 100 items (the max)', () => {
    const entries = Array.from({ length: 100 }, () => ({ type: 'interest', entry: 'Chess' }));

    expect(() => IngestResultSchema.parse({ entries })).not.toThrow();
  });

  it('rejects entries with more than 100 items', () => {
    const entries = Array.from({ length: 101 }, () => ({ type: 'interest', entry: 'Chess' }));

    expect(() => IngestResultSchema.parse({ entries })).toThrow();
  });
});

describe('IngestBodySchema', () => {
  it('accepts a valid non-empty raw_text', () => {
    expect(() => IngestBodySchema.parse({ raw_text: 'Worked at Acme as a backend engineer.' })).not.toThrow();
  });

  it('rejects an empty raw_text', () => {
    expect(() => IngestBodySchema.parse({ raw_text: '' })).toThrow();
  });

  it('accepts a raw_text of exactly 20,000 characters', () => {
    const boundary = 'a'.repeat(20000);

    expect(() => IngestBodySchema.parse({ raw_text: boundary })).not.toThrow();
  });

  it('rejects a raw_text longer than 20,000 characters', () => {
    const tooLong = 'a'.repeat(20001);

    expect(() => IngestBodySchema.parse({ raw_text: tooLong })).toThrow();
  });
});

describe('PersonalInfoSchema', () => {
  const validEntry = {
    name: 'Jane Doe',
    location: 'Remote',
    phone: '555-1234',
    email: 'jane@example.com',
    work_authorization: [],
    clearances: [],
    links: [],
  };

  it('accepts a fully valid entry', () => {
    expect(() => PersonalInfoSchema.parse(validEntry)).not.toThrow();
  });

  it.each([
    { field: 'work_authorization', max: 10 },
    { field: 'clearances', max: 10 },
  ])('rejects $field with more than $max entries', ({ field, max }) => {
    const oversized = Array.from({ length: max + 1 }, (_, i) => `item-${i}`);

    expect(() => PersonalInfoSchema.parse({ ...validEntry, [field]: oversized })).toThrow();
  });

  it('rejects links with more than 20 entries', () => {
    const oversized = Array.from({ length: 21 }, (_, i) => ({
      platform: 'GitHub',
      url: `https://github.com/user-${i}`,
    }));

    expect(() => PersonalInfoSchema.parse({ ...validEntry, links: oversized })).toThrow();
  });

  it('accepts links with exactly 20 entries (the max)', () => {
    const boundary = Array.from({ length: 20 }, (_, i) => ({
      platform: 'GitHub',
      url: `https://github.com/user-${i}`,
    }));

    expect(() => PersonalInfoSchema.parse({ ...validEntry, links: boundary })).not.toThrow();
  });

  it('accepts work_authorization with exactly 10 entries (the max)', () => {
    const boundary = Array.from({ length: 10 }, (_, i) => `auth-${i}`);

    expect(() =>
      PersonalInfoSchema.parse({ ...validEntry, work_authorization: boundary }),
    ).not.toThrow();
  });
});

describe('ExperienceEntrySchema', () => {
  const validEntry = {
    company: 'Acme Corp',
    company_industry: 'Software',
    role: 'Backend Engineer',
    location: 'Remote',
    location_type: 'Remote',
    startDate: 'Jan 2023',
    endDate: 'Present',
    isCurrent: true,
    core_competencies: [],
    technologies_used: [],
    raw_achievements: [],
    quantifiable_metrics: [],
  };

  it('accepts a fully valid entry', () => {
    expect(() => ExperienceEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('rejects an empty company name', () => {
    expect(() => ExperienceEntrySchema.parse({ ...validEntry, company: '' })).toThrow();
  });

  it('rejects an empty role', () => {
    expect(() => ExperienceEntrySchema.parse({ ...validEntry, role: '' })).toThrow();
  });

  it('accepts a company name at exactly the 200-character boundary', () => {
    const boundary = 'a'.repeat(200);

    expect(() => ExperienceEntrySchema.parse({ ...validEntry, company: boundary })).not.toThrow();
  });

  it('rejects a company name longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => ExperienceEntrySchema.parse({ ...validEntry, company: tooLong })).toThrow();
  });

  it.each([
    { field: 'core_competencies', max: 30 },
    { field: 'technologies_used', max: 50 },
    { field: 'raw_achievements', max: 30 },
    { field: 'quantifiable_metrics', max: 30 },
  ])('rejects $field with more than $max entries', ({ field, max }) => {
    const oversized = Array.from({ length: max + 1 }, (_, i) => `item-${i}`);

    expect(() => ExperienceEntrySchema.parse({ ...validEntry, [field]: oversized })).toThrow();
  });

  it('accepts technologies_used with exactly 50 entries (the max)', () => {
    const boundary = Array.from({ length: 50 }, (_, i) => `tech-${i}`);

    expect(() =>
      ExperienceEntrySchema.parse({ ...validEntry, technologies_used: boundary }),
    ).not.toThrow();
  });
});

describe('ProjectEntrySchema', () => {
  const validEntry = {
    name: 'Side Project X',
    context: 'Personal',
    links: [],
    startDate: '2022',
    endDate: '2022',
    technologies_used: [],
    raw_achievements: [],
    quantifiable_metrics: [],
  };

  it('accepts a fully valid entry', () => {
    expect(() => ProjectEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => ProjectEntrySchema.parse({ ...validEntry, name: '' })).toThrow();
  });

  it('accepts a name at exactly the 200-character boundary', () => {
    const boundary = 'a'.repeat(200);

    expect(() => ProjectEntrySchema.parse({ ...validEntry, name: boundary })).not.toThrow();
  });

  it('rejects a name longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => ProjectEntrySchema.parse({ ...validEntry, name: tooLong })).toThrow();
  });

  it('rejects a context longer than 2,000 characters', () => {
    const tooLong = 'a'.repeat(2001);

    expect(() => ProjectEntrySchema.parse({ ...validEntry, context: tooLong })).toThrow();
  });

  it.each([
    { field: 'links', max: 10 },
    { field: 'technologies_used', max: 50 },
    { field: 'raw_achievements', max: 30 },
    { field: 'quantifiable_metrics', max: 30 },
  ])('rejects $field with more than $max entries', ({ field, max }) => {
    const value =
      field === 'links'
        ? Array.from({ length: max + 1 }, (_, i) => ({ type: 'repo', url: `https://example.com/${i}` }))
        : Array.from({ length: max + 1 }, (_, i) => `item-${i}`);

    expect(() => ProjectEntrySchema.parse({ ...validEntry, [field]: value })).toThrow();
  });

  it('accepts links with exactly 10 entries (the max)', () => {
    const boundary = Array.from({ length: 10 }, (_, i) => ({
      type: 'repo',
      url: `https://example.com/${i}`,
    }));

    expect(() => ProjectEntrySchema.parse({ ...validEntry, links: boundary })).not.toThrow();
  });
});

describe('EducationEntrySchema', () => {
  const validEntry = {
    institution: 'State University',
    degree_type: 'BSc',
    major: 'Computer Science',
    minor: '',
    location: '',
    startDate: '2018',
    endDate: '2022',
    gpa: '',
    honors: [],
    relevant_coursework: [],
    thesis_or_capstone: '',
    extracurriculars: [],
    description: '',
  };

  it('accepts a fully valid entry', () => {
    expect(() => EducationEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('rejects an empty institution', () => {
    expect(() => EducationEntrySchema.parse({ ...validEntry, institution: '' })).toThrow();
  });

  it('rejects an empty degree_type', () => {
    expect(() => EducationEntrySchema.parse({ ...validEntry, degree_type: '' })).toThrow();
  });

  it('rejects an empty major', () => {
    expect(() => EducationEntrySchema.parse({ ...validEntry, major: '' })).toThrow();
  });

  it('accepts an institution name at exactly the 200-character boundary', () => {
    const boundary = 'a'.repeat(200);

    expect(() => EducationEntrySchema.parse({ ...validEntry, institution: boundary })).not.toThrow();
  });

  it('rejects an institution name longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => EducationEntrySchema.parse({ ...validEntry, institution: tooLong })).toThrow();
  });

  it('rejects a description longer than 5,000 characters', () => {
    const tooLong = 'a'.repeat(5001);

    expect(() => EducationEntrySchema.parse({ ...validEntry, description: tooLong })).toThrow();
  });

  it.each([
    { field: 'honors', max: 20 },
    { field: 'relevant_coursework', max: 30 },
    { field: 'extracurriculars', max: 20 },
  ])('rejects $field with more than $max entries', ({ field, max }) => {
    const oversized = Array.from({ length: max + 1 }, (_, i) => `item-${i}`);

    expect(() => EducationEntrySchema.parse({ ...validEntry, [field]: oversized })).toThrow();
  });

  it('accepts relevant_coursework with exactly 30 entries (the max)', () => {
    const boundary = Array.from({ length: 30 }, (_, i) => `course-${i}`);

    expect(() =>
      EducationEntrySchema.parse({ ...validEntry, relevant_coursework: boundary }),
    ).not.toThrow();
  });
});

describe('SkillsSchema', () => {
  const validEntry = {
    programming_languages: [],
    frameworks_and_libraries: [],
    infrastructure_and_tools: [],
    databases: [],
    spoken_languages: [],
    soft_skills: [],
  };

  it('accepts a fully valid entry', () => {
    expect(() => SkillsSchema.parse(validEntry)).not.toThrow();
  });

  it.each([
    { field: 'programming_languages', max: 150 },
    { field: 'frameworks_and_libraries', max: 200 },
    { field: 'infrastructure_and_tools', max: 200 },
    { field: 'databases', max: 100 },
    { field: 'soft_skills', max: 100 },
  ])('rejects $field with more than $max entries', ({ field, max }) => {
    const oversized = Array.from({ length: max + 1 }, (_, i) => `item-${i}`);

    expect(() => SkillsSchema.parse({ ...validEntry, [field]: oversized })).toThrow();
  });

  it('rejects spoken_languages with more than 20 entries', () => {
    const oversized = Array.from({ length: 21 }, (_, i) => ({
      language: `Lang-${i}`,
      fluency: 'fluent',
    }));

    expect(() => SkillsSchema.parse({ ...validEntry, spoken_languages: oversized })).toThrow();
  });

  it('accepts spoken_languages with exactly 20 entries (the max)', () => {
    const boundary = Array.from({ length: 20 }, (_, i) => ({
      language: `Lang-${i}`,
      fluency: 'fluent',
    }));

    expect(() =>
      SkillsSchema.parse({ ...validEntry, spoken_languages: boundary }),
    ).not.toThrow();
  });

  it('accepts databases with exactly 100 entries (the max)', () => {
    const boundary = Array.from({ length: 100 }, (_, i) => `db-${i}`);

    expect(() => SkillsSchema.parse({ ...validEntry, databases: boundary })).not.toThrow();
  });
});

describe('CertificationSchema', () => {
  const validEntry = {
    name: 'AWS Certified Developer',
    issuer: 'AWS',
    date: '2023',
  };

  it('accepts a minimal valid entry, defaulting the optional fields to empty strings', () => {
    const result = CertificationSchema.parse(validEntry);

    expect(result.expiration_date).toBe('');
    expect(result.credential_id).toBe('');
    expect(result.link).toBe('');
    expect(result.description).toBe('');
  });

  it('rejects an empty name', () => {
    expect(() => CertificationSchema.parse({ ...validEntry, name: '' })).toThrow();
  });

  it('rejects an empty issuer', () => {
    expect(() => CertificationSchema.parse({ ...validEntry, issuer: '' })).toThrow();
  });

  it('accepts a name at exactly the 200-character boundary', () => {
    const boundary = 'a'.repeat(200);

    expect(() => CertificationSchema.parse({ ...validEntry, name: boundary })).not.toThrow();
  });

  it('rejects a name longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => CertificationSchema.parse({ ...validEntry, name: tooLong })).toThrow();
  });

  it('rejects a link longer than 2,000 characters', () => {
    const tooLong = 'https://example.com/' + 'a'.repeat(2000);

    expect(() => CertificationSchema.parse({ ...validEntry, link: tooLong })).toThrow();
  });
});

describe('AwardSchema', () => {
  const validEntry = {
    title: 'Employee of the Year',
    issuer: 'Acme Corp',
    date: '2023',
  };

  it('accepts a minimal valid entry, defaulting description to an empty string', () => {
    const result = AwardSchema.parse(validEntry);

    expect(result.description).toBe('');
  });

  it('rejects an empty title', () => {
    expect(() => AwardSchema.parse({ ...validEntry, title: '' })).toThrow();
  });

  it('accepts a title at exactly the 200-character boundary', () => {
    const boundary = 'a'.repeat(200);

    expect(() => AwardSchema.parse({ ...validEntry, title: boundary })).not.toThrow();
  });

  it('rejects a title longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => AwardSchema.parse({ ...validEntry, title: tooLong })).toThrow();
  });

  it('rejects a description longer than 5,000 characters', () => {
    const tooLong = 'a'.repeat(5001);

    expect(() => AwardSchema.parse({ ...validEntry, description: tooLong })).toThrow();
  });

  it('rejects related_skills with more than 20 entries', () => {
    const oversized = Array.from({ length: 21 }, (_, i) => `skill-${i}`);

    expect(() => AwardSchema.parse({ ...validEntry, related_skills: oversized })).toThrow();
  });

  it('accepts related_skills with exactly 20 entries (the max)', () => {
    const boundary = Array.from({ length: 20 }, (_, i) => `skill-${i}`);

    expect(() => AwardSchema.parse({ ...validEntry, related_skills: boundary })).not.toThrow();
  });
});

describe('SummaryEntrySchema', () => {
  const validEntry = {
    target_role: 'Backend Engineer',
    content: 'Backend engineer with 5 years of experience building distributed systems.',
  };

  it('accepts a fully valid entry', () => {
    expect(() => SummaryEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('rejects an empty target_role', () => {
    expect(() => SummaryEntrySchema.parse({ ...validEntry, target_role: '' })).toThrow();
  });

  it('rejects an empty content', () => {
    expect(() => SummaryEntrySchema.parse({ ...validEntry, content: '' })).toThrow();
  });

  it('rejects a target_role longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => SummaryEntrySchema.parse({ ...validEntry, target_role: tooLong })).toThrow();
  });

  it('rejects content longer than 5,000 characters', () => {
    const tooLong = 'a'.repeat(5001);

    expect(() => SummaryEntrySchema.parse({ ...validEntry, content: tooLong })).toThrow();
  });

  it('rejects a payload missing the required content field', () => {
    const { content: _content, ...withoutContent } = validEntry;

    expect(() => SummaryEntrySchema.parse(withoutContent)).toThrow();
  });
});

describe('PublicationEntrySchema', () => {
  const validEntry = {
    title: 'Scaling Postgres at 10x',
    venue: 'ReactConf 2024',
    date: '2024',
    url: 'https://reactconf.example.com/talks/scaling-postgres',
    description: 'Talk on read-replica sharding strategies.',
  };

  it('accepts a fully valid entry', () => {
    expect(() => PublicationEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('accepts a minimal entry with only the required title and date', () => {
    expect(() =>
      PublicationEntrySchema.parse({ title: 'Scaling Postgres at 10x', date: '2024' }),
    ).not.toThrow();
  });

  it('rejects an empty title', () => {
    expect(() => PublicationEntrySchema.parse({ ...validEntry, title: '' })).toThrow();
  });

  it('rejects a title longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => PublicationEntrySchema.parse({ ...validEntry, title: tooLong })).toThrow();
  });

  it('rejects a payload missing the required title field', () => {
    const { title: _title, ...withoutTitle } = validEntry;

    expect(() => PublicationEntrySchema.parse(withoutTitle)).toThrow();
  });

  it('rejects a description longer than 5,000 characters', () => {
    const tooLong = 'a'.repeat(5001);

    expect(() => PublicationEntrySchema.parse({ ...validEntry, description: tooLong })).toThrow();
  });
});

describe('VolunteeringEntrySchema', () => {
  const validEntry = {
    organization: 'Code.org',
    role: 'Mentor',
    location: 'Remote',
    startDate: '2022',
    endDate: '',
    isCurrent: true,
    description: 'Mentors underrepresented students in web development.',
  };

  it('accepts a fully valid entry', () => {
    expect(() => VolunteeringEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('accepts a minimal entry with only the required organization, role, and startDate', () => {
    expect(() =>
      VolunteeringEntrySchema.parse({ organization: 'Code.org', role: 'Mentor', startDate: '2022' }),
    ).not.toThrow();
  });

  it('rejects an empty organization', () => {
    expect(() => VolunteeringEntrySchema.parse({ ...validEntry, organization: '' })).toThrow();
  });

  it('rejects an empty role', () => {
    expect(() => VolunteeringEntrySchema.parse({ ...validEntry, role: '' })).toThrow();
  });

  it('rejects a payload missing the required startDate field', () => {
    const { startDate: _startDate, ...withoutStartDate } = validEntry;

    expect(() => VolunteeringEntrySchema.parse(withoutStartDate)).toThrow();
  });

  it('rejects an organization name longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => VolunteeringEntrySchema.parse({ ...validEntry, organization: tooLong })).toThrow();
  });
});

describe('InterestEntrySchema', () => {
  it('accepts a non-empty interest string', () => {
    expect(() => InterestEntrySchema.parse('Competitive Programming')).not.toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => InterestEntrySchema.parse('')).toThrow();
  });

  it('rejects a string longer than 200 characters', () => {
    const tooLong = 'a'.repeat(201);

    expect(() => InterestEntrySchema.parse(tooLong)).toThrow();
  });

  it('rejects a non-string value (an object instead of a plain interest string)', () => {
    expect(() => InterestEntrySchema.parse({ name: 'Chess' })).toThrow();
  });
});

describe('MasterDBSchema', () => {
  const validPersonalInfo = {
    name: 'Jane Doe',
    location: 'Remote',
    phone: '555-1234',
    email: 'jane@example.com',
    work_authorization: [],
    clearances: [],
    links: [],
  };

  const validSkills = {
    programming_languages: [],
    frameworks_and_libraries: [],
    infrastructure_and_tools: [],
    databases: [],
    spoken_languages: [],
    soft_skills: [],
  };

  const validMasterDB = {
    personal_info: validPersonalInfo,
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: validSkills,
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
  };

  // Minimal valid element for each capped array, keyed by MasterDBSchema field name.
  const minimalEntryFactories: Record<string, (i: number) => unknown> = {
    summaries: (i) => ({ target_role: `Role-${i}`, content: 'Backend engineer.' }),
    experience: (i) => ({
      company: `Company-${i}`,
      company_industry: 'Software',
      role: 'Engineer',
      location: 'Remote',
      location_type: 'Remote',
      startDate: '2023',
      endDate: '2023',
      isCurrent: false,
      core_competencies: [],
      technologies_used: [],
      raw_achievements: [],
      quantifiable_metrics: [],
    }),
    education: (i) => ({
      institution: `University-${i}`,
      degree_type: 'BSc',
      major: 'Computer Science',
      minor: '',
      location: '',
      startDate: '2018',
      endDate: '2022',
      gpa: '',
      honors: [],
      relevant_coursework: [],
      thesis_or_capstone: '',
      extracurriculars: [],
      description: '',
    }),
    projects: (i) => ({
      name: `Project-${i}`,
      context: '',
      links: [],
      startDate: '2022',
      endDate: '2022',
      technologies_used: [],
      raw_achievements: [],
      quantifiable_metrics: [],
    }),
    certifications: (i) => ({ name: `Cert-${i}`, issuer: 'AWS', date: '2023' }),
    awards_and_honors: (i) => ({ title: `Award-${i}`, issuer: '', date: '2023' }),
    publications_and_speaking: (i) => ({ title: `Publication-${i}`, date: '2023' }),
    volunteering_and_leadership: (i) => ({ organization: `Org-${i}`, role: 'Mentor', startDate: '2022' }),
    interests: (i) => `Interest-${i}`,
  };

  it('accepts a fully valid, entirely empty profile', () => {
    expect(() => MasterDBSchema.parse(validMasterDB)).not.toThrow();
  });

  it.each([
    { field: 'summaries', max: 10 },
    { field: 'experience', max: 50 },
    { field: 'education', max: 20 },
    { field: 'projects', max: 50 },
    { field: 'certifications', max: 50 },
    { field: 'awards_and_honors', max: 50 },
    { field: 'publications_and_speaking', max: 50 },
    { field: 'volunteering_and_leadership', max: 30 },
    { field: 'interests', max: 50 },
  ])('rejects $field with more than $max entries', ({ field, max }) => {
    const factory = minimalEntryFactories[field];
    const oversized = Array.from({ length: max + 1 }, (_, i) => factory(i));

    expect(() => MasterDBSchema.parse({ ...validMasterDB, [field]: oversized })).toThrow();
  });

  it('accepts experience with exactly 50 entries (the max)', () => {
    const boundary = Array.from({ length: 50 }, (_, i) => minimalEntryFactories.experience(i));

    expect(() => MasterDBSchema.parse({ ...validMasterDB, experience: boundary })).not.toThrow();
  });

  it('accepts certifications with exactly 50 entries (the max)', () => {
    const boundary = Array.from({ length: 50 }, (_, i) => minimalEntryFactories.certifications(i));

    expect(() =>
      MasterDBSchema.parse({ ...validMasterDB, certifications: boundary }),
    ).not.toThrow();
  });
});

describe('ConfirmIngestSchema', () => {
  const validExperienceEntry = {
    type: 'experience',
    entry: {
      company: 'Acme Corp',
      company_industry: 'Software',
      role: 'Backend Engineer',
      location: 'Remote',
      location_type: 'Remote',
      startDate: 'Jan 2023',
      endDate: 'Present',
      isCurrent: true,
      core_competencies: [],
      technologies_used: [],
      raw_achievements: [],
      quantifiable_metrics: [],
    },
  };

  it('accepts a valid multi-type entries payload (experience + interest)', () => {
    expect(() =>
      ConfirmIngestSchema.parse({
        entries: [validExperienceEntry, { type: 'interest', entry: 'Chess' }],
      }),
    ).not.toThrow();
  });

  it('rejects an empty entries array — confirm requires at least one entry to persist', () => {
    expect(() => ConfirmIngestSchema.parse({ entries: [] })).toThrow();
  });

  it('rejects an entry with a discriminant not in the allowed type union (a client could tamper with this before confirming)', () => {
    expect(() =>
      ConfirmIngestSchema.parse({ entries: [{ type: 'not_a_real_type', entry: {} }] }),
    ).toThrow();
  });

  it('rejects an entry whose sub-entry is missing required fields for its type (a user-edited field cleared to empty)', () => {
    expect(() =>
      ConfirmIngestSchema.parse({
        entries: [{ type: 'experience', entry: { ...validExperienceEntry.entry, company: '' } }],
      }),
    ).toThrow();
  });

  it('rejects a field a user edited past its max length before confirming', () => {
    expect(() =>
      ConfirmIngestSchema.parse({
        entries: [
          { type: 'experience', entry: { ...validExperienceEntry.entry, company: 'a'.repeat(201) } },
        ],
      }),
    ).toThrow();
  });

  it('rejects an interest entry edited into a non-string value', () => {
    expect(() =>
      ConfirmIngestSchema.parse({ entries: [{ type: 'interest', entry: { name: 'Chess' } }] }),
    ).toThrow();
  });

  it('accepts entries with exactly 100 items (the max)', () => {
    const entries = Array.from({ length: 100 }, () => ({ type: 'interest', entry: 'Chess' }));

    expect(() => ConfirmIngestSchema.parse({ entries })).not.toThrow();
  });

  it('rejects entries.length = 101 on the confirm-persist payload', () => {
    const entries = Array.from({ length: 101 }, () => ({ type: 'interest', entry: 'Chess' }));

    expect(() => ConfirmIngestSchema.parse({ entries })).toThrow();
  });
});
