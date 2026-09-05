import { generateJSON } from '@resumiq/ai-bridge';
import { OnboardingService } from './onboarding.service';

jest.mock('@resumiq/ai-bridge', () => ({
  generateJSON: jest.fn(),
}));

const generateJSONMock = generateJSON as jest.Mock;

describe('OnboardingService', () => {
  let service: OnboardingService;

  beforeEach(() => {
    generateJSONMock.mockReset();
    service = new OnboardingService();
  });

  describe('parseCareerText', () => {
    it('extracts every distinct career fact (experience + certification + project) as separate entries', async () => {
      const experienceEntry = {
        company: 'Acme Corp',
        company_industry: 'Software',
        role: 'Backend Engineer',
        location: 'Remote',
        location_type: 'Remote',
        startDate: 'Jan 2023',
        endDate: 'Present',
        isCurrent: true,
        core_competencies: ['Backend'],
        technologies_used: ['Node.js', 'PostgreSQL'],
        raw_achievements: ['Built the payments service handling 10k requests/day.'],
        quantifiable_metrics: [],
      };
      const certificationEntry = {
        name: 'AWS Certified Developer',
        issuer: 'AWS',
        date: '2023',
        expiration_date: '',
        credential_id: '',
        link: '',
        description: 'Completed the AWS Developer Associate course.',
      };
      const projectEntry = {
        name: 'Side Project X',
        context: 'Personal',
        links: [],
        startDate: '2022',
        endDate: '2022',
        technologies_used: ['React'],
        raw_achievements: ['Shipped a side project used by 200 users.'],
        quantifiable_metrics: [],
      };

      generateJSONMock.mockResolvedValue({
        entries: [
          { type: 'experience', entry: experienceEntry },
          { type: 'certification', entry: certificationEntry },
          { type: 'project', entry: projectEntry },
        ],
      });

      const result = await service.parseCareerText('some raw career text', null);

      expect(result.entries).toHaveLength(3);
      expect(result.entries.map((e) => e.type)).toEqual([
        'experience',
        'certification',
        'project',
      ]);
    });

    it('rejects a response where every entry fails schema validation, with a generic client-facing message', async () => {
      generateJSONMock.mockResolvedValue({
        entries: [{ type: 'not_a_real_type', entry: {} }],
      });

      await expect(service.parseCareerText('some raw text', null)).rejects.toThrow(
        "Couldn't parse that text into your profile — try rephrasing or breaking it into shorter pieces.",
      );
    });

    it('rejects a response missing the entries array entirely, with a generic client-facing message', async () => {
      generateJSONMock.mockResolvedValue({ type: 'experience', entry: {} });

      await expect(service.parseCareerText('some raw text', null)).rejects.toThrow(
        "Couldn't parse that text into your profile — try rephrasing or breaking it into shorter pieces.",
      );
    });

    it('keeps valid entries and drops an individual malformed entry, rather than discarding the whole batch', async () => {
      const experienceEntry = {
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
        raw_achievements: ['Built a service.'],
        quantifiable_metrics: [],
      };

      generateJSONMock.mockResolvedValue({
        entries: [
          { type: 'experience', entry: experienceEntry },
          { type: 'not_a_real_type', entry: {} },
        ],
      });

      const result = await service.parseCareerText('some raw text', null);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({ type: 'experience', entry: experienceEntry });
    });
  });
});
