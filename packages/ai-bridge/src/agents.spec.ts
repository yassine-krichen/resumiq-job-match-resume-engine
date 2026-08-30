import { checkCompatibility, generateEmail } from './agents';
import { generateJSON } from './llm';
import type { AISelection, CompatibilityResult, EmailDraft, JobDNA, MasterDB } from './types';

jest.mock('./llm', () => ({
  generateJSON: jest.fn(),
}));

const generateJSONMock = generateJSON as jest.Mock;

function emptyMasterDB(): MasterDB {
  return {
    personal_info: {
      name: '',
      location: '',
      phone: '',
      email: '',
      work_authorization: [],
      clearances: [],
      links: [],
    },
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: {
      programming_languages: [],
      frameworks_and_libraries: [],
      infrastructure_and_tools: [],
      databases: [],
      spoken_languages: [],
      soft_skills: [],
    },
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
  };
}

function emptyJobDNA(): JobDNA {
  return {
    job_title: 'Software Engineer',
    seniority: 'Mid',
    mandatory_technical_skills: ['TypeScript'],
    mandatory_soft_skills: [],
    nice_to_have_skills: [],
    ats_keywords: [],
    company_culture_and_values: [],
    primary_responsibilities_summary: '',
    tone_recommendation: '',
  };
}

function emptySelection(): AISelection {
  return {
    reasoning: '',
    section_order: ['experience'],
    experience: [],
    projects: [],
    skills: { languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] },
    certifications: [],
    awards: [],
  };
}

describe('checkCompatibility', () => {
  beforeEach(() => {
    generateJSONMock.mockReset();
  });

  it('returns the full extended shape — reasons plus gap-report fields — in one call', async () => {
    const compatResult: CompatibilityResult = {
      compatible: true,
      score: 82,
      blockers: [],
      warnings: ['No AWS certification on file'],
      suggestions: ['Add a project demonstrating cloud infra'],
      reasons: ['Strong TypeScript and React coverage matches all mandatory skills'],
      missing_skills: [
        { skill: 'AWS', priority: 'nice-to-have', suggested_resources: ['AWS Cloud Practitioner course'] },
      ],
      strengths: ['5 years of production TypeScript experience'],
      recommendations: ['Build a small project using AWS Lambda within the next month'],
    };
    generateJSONMock.mockResolvedValue(compatResult);

    const result = await checkCompatibility(emptyJobDNA(), emptyMasterDB());

    expect(result).toEqual(compatResult);
    expect(result.reasons).toEqual(compatResult.reasons);
    expect(result.missing_skills).toEqual(compatResult.missing_skills);
    expect(result.strengths).toEqual(compatResult.strengths);
    expect(result.recommendations).toEqual(compatResult.recommendations);
  });

  it('calls generateJSON exactly once with string system and user prompts', async () => {
    generateJSONMock.mockResolvedValue({
      compatible: false,
      score: 10,
      blockers: ['Missing TypeScript'],
      warnings: [],
      suggestions: [],
      reasons: [],
      missing_skills: [],
      strengths: [],
      recommendations: [],
    });

    await checkCompatibility(emptyJobDNA(), emptyMasterDB());

    expect(generateJSONMock).toHaveBeenCalledTimes(1);
    const [system, user] = generateJSONMock.mock.calls[0];
    expect(typeof system).toBe('string');
    expect(typeof user).toBe('string');
  });

  it('propagates rejection from generateJSON without swallowing it', async () => {
    generateJSONMock.mockRejectedValue(new Error('LLM unreachable'));

    await expect(checkCompatibility(emptyJobDNA(), emptyMasterDB())).rejects.toThrow(
      'LLM unreachable',
    );
  });
});

describe('generateEmail', () => {
  beforeEach(() => {
    generateJSONMock.mockReset();
  });

  it('returns an EmailDraft with subject and body from the LLM response', async () => {
    const draft: EmailDraft = {
      subject: 'Excited about your platform team roadmap',
      body: 'Hi there, ...',
    };
    generateJSONMock.mockResolvedValue(draft);

    const result = await generateEmail(emptyJobDNA(), 'We build fintech infra', emptySelection());

    expect(result).toEqual(draft);
  });

  it('calls generateJSON exactly once with string system and user prompts', async () => {
    generateJSONMock.mockResolvedValue({ subject: 'x', body: 'y' });

    await generateEmail(emptyJobDNA(), '', emptySelection());

    expect(generateJSONMock).toHaveBeenCalledTimes(1);
    const [system, user] = generateJSONMock.mock.calls[0];
    expect(typeof system).toBe('string');
    expect(typeof user).toBe('string');
  });
});
