import { analyzeJob } from '@resumiq/ai-bridge';
import type { JobDNA } from '@resumiq/ai-bridge';
import type { ScrapedJobInput } from '@resumiq/job-scanner';
import { ingestScrapedJobs } from './ingest-scraped-jobs';
import { buildJobDedupeKey } from '../../common/jobs/dedupe-key';

jest.mock('@resumiq/ai-bridge', () => ({
  analyzeJob: jest.fn(),
}));

const analyzeJobMock = analyzeJob as jest.Mock;

function jobDNAFixture(overrides: Partial<JobDNA> = {}): JobDNA {
  return {
    job_title: 'Backend Engineer',
    seniority: 'Mid',
    mandatory_technical_skills: ['TypeScript'],
    mandatory_soft_skills: [],
    nice_to_have_skills: [],
    ats_keywords: [],
    company_culture_and_values: [],
    primary_responsibilities_summary: '',
    tone_recommendation: '',
    ...overrides,
  };
}

function scrapedJobFixture(overrides: Partial<ScrapedJobInput> = {}): ScrapedJobInput {
  return {
    title: 'Backend Engineer',
    url: 'https://example.com/jobs/1',
    company: 'Acme Corp',
    location: 'Remote - US',
    description: 'We build things.',
    ...overrides,
  };
}

/** Creates a promise + external resolve/reject, for asserting concurrency behavior. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ingestScrapedJobs', () => {
  let prisma: {
    job: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let hunterClient: { findContact: jest.Mock };
  let pdlClient: { findCompanyProfile: jest.Mock };
  let logger: { warn: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      job: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    hunterClient = { findContact: jest.fn() };
    pdlClient = { findCompanyProfile: jest.fn() };
    logger = { warn: jest.fn() };
  });

  function deps() {
    return {
      prisma: prisma as never,
      hunterClient: hunterClient as never,
      pdlClient: pdlClient as never,
      logger,
    };
  }

  it('skips a scraped job whose dedupeKey already exists in the DB, never creating a duplicate', async () => {
    const scraped = scrapedJobFixture();
    prisma.job.findUnique.mockResolvedValue({ id: 'existing-job' });

    const result = await ingestScrapedJobs([scraped], deps());

    const expectedKey = buildJobDedupeKey(scraped.company, scraped.title, scraped.location);
    expect(prisma.job.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: expectedKey },
      select: { id: true },
    });
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(analyzeJobMock).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, created: 0 });
  });

  it('creates a new Job row for genuinely new scraped input and flags remote from the location text', async () => {
    const scraped = scrapedJobFixture({ location: 'Remote - Worldwide' });
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    analyzeJobMock.mockResolvedValue(jobDNAFixture());
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    const result = await ingestScrapedJobs([scraped], deps());

    expect(prisma.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dedupeKey: buildJobDedupeKey(scraped.company, scraped.title, scraped.location),
        source: 'scraper',
        sourceUrl: scraped.url,
        title: scraped.title,
        companyName: scraped.company,
        rawJd: scraped.description,
        location: scraped.location,
        remote: true,
      }),
    });
    expect(result).toEqual({ scanned: 1, created: 1 });
  });

  it('does not flag a non-remote location as remote', async () => {
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    analyzeJobMock.mockResolvedValue(jobDNAFixture());
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    await ingestScrapedJobs([scrapedJobFixture({ location: 'Berlin, Germany' })], deps());

    expect(prisma.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ remote: false }),
    });
  });

  it('analyzes each new job JD and persists the resulting parsedJd', async () => {
    const scraped = scrapedJobFixture();
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    const dna = jobDNAFixture();
    analyzeJobMock.mockResolvedValue(dna);
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    await ingestScrapedJobs([scraped], deps());

    expect(analyzeJobMock).toHaveBeenCalledWith(scraped.description, '');
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { parsedJd: dna },
    });
  });

  it('skips analysis (parsedJd stays null) for a scraped job with no description', async () => {
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    await ingestScrapedJobs([scrapedJobFixture({ description: undefined })], deps());

    expect(analyzeJobMock).not.toHaveBeenCalled();
    expect(prisma.job.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parsedJd: expect.anything() }) }),
    );
  });

  it('continues ingesting remaining jobs and logs a warning when analyzeJob throws for one of them', async () => {
    const failing = scrapedJobFixture({ company: 'Failing Co', url: 'https://example.com/1' });
    const succeeding = scrapedJobFixture({ company: 'Succeeding Co', url: 'https://example.com/2' });
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValueOnce({ id: 'job-fail' }).mockResolvedValueOnce({ id: 'job-ok' });
    analyzeJobMock.mockRejectedValueOnce(new Error('LLM timeout')).mockResolvedValueOnce(jobDNAFixture());
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    const result = await ingestScrapedJobs([failing, succeeding], deps());

    // Both jobs were still created — the analyze failure is swallowed, not propagated.
    expect(result).toEqual({ scanned: 2, created: 2 });
    expect(prisma.job.update).toHaveBeenCalledTimes(1);
    expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: 'job-ok' }, data: { parsedJd: jobDNAFixture() } });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('analyzeJob failed for job job-fail (Failing Co): LLM timeout'),
    );
  });

  it('treats a malformed analyzeJob result the same as a rejection — job skipped, parsedJd stays null, batch continues', async () => {
    const failing = scrapedJobFixture({ company: 'Malformed Co', url: 'https://example.com/1' });
    const succeeding = scrapedJobFixture({ company: 'Succeeding Co', url: 'https://example.com/2' });
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValueOnce({ id: 'job-fail' }).mockResolvedValueOnce({ id: 'job-ok' });
    // Missing required fields (job_title, seniority, etc.) fails JobDNASchema.safeParse.
    analyzeJobMock
      .mockResolvedValueOnce({ job_title: 'Backend Engineer' })
      .mockResolvedValueOnce(jobDNAFixture());
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    const result = await ingestScrapedJobs([failing, succeeding], deps());

    // Both jobs were still created — the shape-validation failure is swallowed, not propagated.
    expect(result).toEqual({ scanned: 2, created: 2 });
    expect(prisma.job.update).toHaveBeenCalledTimes(1);
    expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: 'job-ok' }, data: { parsedJd: jobDNAFixture() } });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('analyzeJob failed for job job-fail (Malformed Co): analyzeJob returned an invalid shape'),
    );
  });

  it('does not throw when analyzeJob rejects and no logger was supplied', async () => {
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    analyzeJobMock.mockRejectedValue(new Error('LLM timeout'));
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    await expect(
      ingestScrapedJobs([scrapedJobFixture()], {
        prisma: prisma as never,
        hunterClient: hunterClient as never,
        pdlClient: pdlClient as never,
      }),
    ).resolves.toEqual({ scanned: 1, created: 1 });
  });

  it('runs analyzeJob calls with bounded concurrency (never more than 3 in flight)', async () => {
    const scrapedJobs = Array.from({ length: 6 }, (_, i) =>
      scrapedJobFixture({ company: `Co ${i}`, url: `https://example.com/${i}` }),
    );
    prisma.job.findUnique.mockResolvedValue(null);
    let createCount = 0;
    prisma.job.create.mockImplementation(async () => ({ id: `job-${createCount++}` }));
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    let inFlight = 0;
    let maxInFlight = 0;
    const gates = scrapedJobs.map(() => deferred<void>());
    let callIndex = 0;
    analyzeJobMock.mockImplementation(async () => {
      const gate = gates[callIndex++];
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate.promise;
      inFlight--;
      return jobDNAFixture();
    });

    const ingestPromise = ingestScrapedJobs(scrapedJobs, deps());

    // Poll (rather than counting fixed ticks) until the 3 concurrent workers
    // have each picked up a job and are blocked on their gate — avoids
    // coupling the test to how many microtask ticks the dedup/create loop takes.
    for (let i = 0; i < 200 && callIndex < 3; i++) {
      await Promise.resolve();
    }

    expect(callIndex).toBe(3); // exactly 3 in flight — the 4th worker slot never opened
    expect(inFlight).toBe(3);
    expect(maxInFlight).toBe(3);

    gates.forEach((g) => g.resolve());
    await ingestPromise;

    expect(maxInFlight).toBe(3);
  });

  it('does not block ingestion when both enrichment providers throw — job is still created with companyInfo left untouched', async () => {
    const scraped = scrapedJobFixture();
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    analyzeJobMock.mockResolvedValue(jobDNAFixture());
    hunterClient.findContact.mockRejectedValue(new Error('Hunter.io down'));
    pdlClient.findCompanyProfile.mockRejectedValue(new Error('PDL down'));

    await expect(ingestScrapedJobs([scraped], deps())).resolves.toEqual({ scanned: 1, created: 1 });

    // Only the analyzeJob update happened — no companyInfo update was attempted or persisted.
    expect(prisma.job.update).toHaveBeenCalledTimes(1);
    expect(prisma.job.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyInfo: expect.anything() }) }),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('enrichment failed for job job-1'));
  });

  it('persists companyInfo when enrichment succeeds for either provider', async () => {
    const scraped = scrapedJobFixture();
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    analyzeJobMock.mockResolvedValue(jobDNAFixture());
    const contact = { email: 'hire@acme.com', confidence: 90 };
    hunterClient.findContact.mockResolvedValue(contact);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    await ingestScrapedJobs([scraped], deps());

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { companyInfo: { profile: null, contact } },
    });
  });

  it('never persists companyInfo when both enrichment providers return null', async () => {
    const scraped = scrapedJobFixture();
    prisma.job.findUnique.mockResolvedValue(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    analyzeJobMock.mockResolvedValue(jobDNAFixture());
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    await ingestScrapedJobs([scraped], deps());

    expect(prisma.job.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyInfo: expect.anything() }) }),
    );
  });

  it('returns scanned/created counts that account for a mix of deduped and newly created jobs', async () => {
    const existing = scrapedJobFixture({ company: 'Existing Co', url: 'https://example.com/existing' });
    const fresh = scrapedJobFixture({ company: 'Fresh Co', url: 'https://example.com/fresh' });
    prisma.job.findUnique
      .mockResolvedValueOnce({ id: 'existing-job' })
      .mockResolvedValueOnce(null);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    analyzeJobMock.mockResolvedValue(jobDNAFixture());
    hunterClient.findContact.mockResolvedValue(null);
    pdlClient.findCompanyProfile.mockResolvedValue(null);

    const result = await ingestScrapedJobs([existing, fresh], deps());

    expect(prisma.job.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ scanned: 2, created: 1 });
  });
});
