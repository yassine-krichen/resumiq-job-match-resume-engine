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
      expect(result.droppedCount).toBe(0);
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

    it('keeps valid entries and drops an individual malformed entry, rather than discarding the whole batch, and reports the drop in droppedCount', async () => {
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
      expect(result.droppedCount).toBe(1);
    });

    it('accumulates droppedCount across multiple malformed entries dropped from the same batch', async () => {
      const experienceEntry = {
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
        raw_achievements: ['Built a service.'],
        quantifiable_metrics: [],
      };

      generateJSONMock.mockResolvedValue({
        entries: [
          { type: 'experience', entry: experienceEntry },
          { type: 'not_a_real_type', entry: {} },
          { type: 'certification', entry: { name: '' } }, // fails CertificationSchema (empty required name)
        ],
      });

      const result = await service.parseCareerText('some raw text', null);

      expect(result.entries).toHaveLength(1);
      expect(result.droppedCount).toBe(2);
    });

    it('classifies a professional summary into a "summary" entry', async () => {
      const summaryEntry = {
        target_role: 'Backend Engineer',
        content: 'Backend engineer with 5 years building distributed systems.',
      };

      generateJSONMock.mockResolvedValue({
        entries: [{ type: 'summary', entry: summaryEntry }],
      });

      const result = await service.parseCareerText('some raw text', null);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({ type: 'summary', entry: summaryEntry });
      expect(result.droppedCount).toBe(0);
    });

    it('classifies a conference talk into a "publication" entry', async () => {
      const publicationEntry = {
        title: 'Scaling Postgres at 10x',
        venue: 'ReactConf 2024',
        date: '2024',
        url: 'https://reactconf.example.com/talks/scaling-postgres',
        description: 'Talk on read-replica sharding strategies.',
      };

      generateJSONMock.mockResolvedValue({
        entries: [{ type: 'publication', entry: publicationEntry }],
      });

      const result = await service.parseCareerText('some raw text', null);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({ type: 'publication', entry: publicationEntry });
      expect(result.droppedCount).toBe(0);
    });

    it('classifies community mentoring into a "volunteering" entry', async () => {
      const volunteeringEntry = {
        organization: 'Code.org',
        role: 'Mentor',
        location: 'Remote',
        startDate: '2022',
        endDate: '',
        isCurrent: true,
        description: 'Mentors underrepresented students in web development.',
      };

      generateJSONMock.mockResolvedValue({
        entries: [{ type: 'volunteering', entry: volunteeringEntry }],
      });

      const result = await service.parseCareerText('some raw text', null);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({ type: 'volunteering', entry: volunteeringEntry });
      expect(result.droppedCount).toBe(0);
    });

    it('classifies a personal hobby mention into an "interest" entry (a plain string, not an object)', async () => {
      generateJSONMock.mockResolvedValue({
        entries: [{ type: 'interest', entry: 'Competitive Programming' }],
      });

      const result = await service.parseCareerText('some raw text', null);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({ type: 'interest', entry: 'Competitive Programming' });
      expect(result.droppedCount).toBe(0);
    });

    it('extracts a mix of a new-type entry (summary) alongside an original-type entry (experience) from the same batch', async () => {
      const experienceEntry = {
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
        raw_achievements: ['Built a service.'],
        quantifiable_metrics: [],
      };
      const summaryEntry = {
        target_role: 'Backend Engineer',
        content: 'Backend engineer with 5 years of experience.',
      };

      generateJSONMock.mockResolvedValue({
        entries: [
          { type: 'summary', entry: summaryEntry },
          { type: 'experience', entry: experienceEntry },
        ],
      });

      const result = await service.parseCareerText('some raw text', null);

      expect(result.entries.map((e) => e.type)).toEqual(['summary', 'experience']);
      expect(result.droppedCount).toBe(0);
    });
  });

  describe('parseCareerText heartbeat + timeout', () => {
    const PARSE_TIMEOUT_MESSAGE =
      'Taking longer than expected — try shortening the input or try again.';

    const summaryEntry = {
      target_role: 'Backend Engineer',
      content: 'Backend engineer with 5 years of experience.',
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('emits a "Still analyzing..." progress heartbeat every 12s while generateJSON is still in flight', async () => {
      let resolveGenerateJSON!: (value: unknown) => void;
      generateJSONMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGenerateJSON = resolve;
          }),
      );
      const onProgress = jest.fn();

      const resultPromise = service.parseCareerText('some raw text', null, onProgress);

      // Two heartbeat ticks (24s) elapse before the LLM call ever resolves.
      await jest.advanceTimersByTimeAsync(12_000);
      await jest.advanceTimersByTimeAsync(12_000);

      const heartbeatCalls = onProgress.mock.calls.filter(([step]) => step === 'Still analyzing...');
      expect(heartbeatCalls).toHaveLength(2);

      resolveGenerateJSON({ entries: [{ type: 'summary', entry: summaryEntry }] });
      const result = await resultPromise;

      expect(result.entries).toEqual([{ type: 'summary', entry: summaryEntry }]);
    });

    it('rejects with the clean PARSE_TIMEOUT_MESSAGE (not a raw/generic error) when generateJSON never resolves within 45s', async () => {
      generateJSONMock.mockImplementation(() => new Promise(() => {})); // never settles

      const resultPromise = service.parseCareerText('some raw text', null);
      const assertion = expect(resultPromise).rejects.toThrow(PARSE_TIMEOUT_MESSAGE);

      await jest.advanceTimersByTimeAsync(45_000);
      await assertion;
    });

    it('clears both the heartbeat interval and the timeout timer once generateJSON resolves before the 45s deadline', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      generateJSONMock.mockResolvedValue({
        entries: [{ type: 'summary', entry: summaryEntry }],
      });

      await service.parseCareerText('some raw text', null);

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      // No heartbeat or timeout callback should fire after the call already
      // settled — proves the timers were actually cleared, not just spied on.
      expect(jest.getTimerCount()).toBe(0);

      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });
  });
});
