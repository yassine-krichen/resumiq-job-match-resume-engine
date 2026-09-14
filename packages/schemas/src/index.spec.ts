import {
  AwardSchema,
  CertificationSchema,
  CompatibilityResultSchema,
  CreateJobSchema,
  EducationEntrySchema,
  ExperienceEntrySchema,
  ExtractJobIntakeSchema,
  IngestBodySchema,
  IngestResultSchema,
  JobDNASchema,
  JobIntakeResultSchema,
  ProjectEntrySchema,
  UpdateEmailDraftSchema,
  UpdateGapReportSchema,
  UpdateResumeSelectionSchema,
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
});
