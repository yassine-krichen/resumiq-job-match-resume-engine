import { scanTrackedCompanies } from './orchestrator';
import { getTrackedCompanies } from './tracked-companies';
import { loadProvider, makeProviderHttpContext, loadHtmlToText } from './provider-loader';
import { backfillDescription } from './detail-fetch';
import type { ScrapedJobInput, TrackedCompany } from './types';

jest.mock('./tracked-companies', () => ({ getTrackedCompanies: jest.fn() }));
jest.mock('./provider-loader', () => ({
  loadProvider: jest.fn(),
  makeProviderHttpContext: jest.fn(),
  loadHtmlToText: jest.fn(),
  SUPPORTED_PROVIDER_IDS: [
    'greenhouse',
    'lever',
    'ashby',
    'workday',
    'smartrecruiters',
    'remoteok',
    'himalayas',
    'remotive',
    'weworkremotely',
  ],
}));
// Mocked by default like every other test here — backfillDescription's own
// unit behavior is covered in detail-fetch.spec.ts. It defaults to an
// identity passthrough below so pre-existing tests (whose fixture jobs have
// no `description`) keep flowing through backfillMissingDescriptions
// unchanged. Individual tests override this to assert the actual wiring.
jest.mock('./detail-fetch', () => ({ backfillDescription: jest.fn() }));

const getTrackedCompaniesMock = getTrackedCompanies as jest.Mock;
const loadProviderMock = loadProvider as jest.Mock;
const makeProviderHttpContextMock = makeProviderHttpContext as jest.Mock;
const loadHtmlToTextMock = loadHtmlToText as jest.Mock;
const backfillDescriptionMock = backfillDescription as jest.Mock;

function company(overrides: Partial<TrackedCompany> = {}): TrackedCompany {
  return { name: 'Acme', provider: 'greenhouse', enabled: true, ...overrides };
}

/** Creates a promise + external resolve/reject, for asserting concurrency behavior.
 * Mirrors apps/api/src/modules/jobs/ingest-scraped-jobs.spec.ts's helper of the same name. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('scanTrackedCompanies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    makeProviderHttpContextMock.mockResolvedValue({ transport: 'http' });
    backfillDescriptionMock.mockImplementation(async (job: ScrapedJobInput) => job);
  });

  it('flattens jobs returned by every enabled entry', async () => {
    getTrackedCompaniesMock.mockReturnValue([
      company({ name: 'Acme', provider: 'greenhouse' }),
      company({ name: 'Globex', provider: 'lever' }),
    ]);
    const provider = {
      id: 'greenhouse',
      fetch: jest.fn().mockResolvedValue([{ title: 'Engineer', url: 'u1', company: 'Acme', location: '' }]),
    };
    const provider2 = {
      id: 'lever',
      fetch: jest.fn().mockResolvedValue([{ title: 'Designer', url: 'u2', company: 'Globex', location: '' }]),
    };
    loadProviderMock.mockResolvedValueOnce(provider).mockResolvedValueOnce(provider2);

    const jobs = await scanTrackedCompanies();

    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.title)).toEqual(['Engineer', 'Designer']);
  });

  it('skips entries with enabled: false without loading a provider for them', async () => {
    getTrackedCompaniesMock.mockReturnValue([company({ enabled: false })]);

    const jobs = await scanTrackedCompanies();

    expect(jobs).toEqual([]);
    expect(loadProviderMock).not.toHaveBeenCalled();
  });

  it('isolates a failing provider — one entry throwing does not stop the scan', async () => {
    getTrackedCompaniesMock.mockReturnValue([
      company({ name: 'Broken', provider: 'greenhouse' }),
      company({ name: 'Healthy', provider: 'lever' }),
    ]);
    const brokenProvider = { id: 'greenhouse', fetch: jest.fn().mockRejectedValue(new Error('network down')) };
    const healthyProvider = {
      id: 'lever',
      fetch: jest.fn().mockResolvedValue([{ title: 'Ok', url: 'u', company: 'Healthy', location: '' }]),
    };
    loadProviderMock.mockResolvedValueOnce(brokenProvider).mockResolvedValueOnce(healthyProvider);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const jobs = await scanTrackedCompanies();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Ok');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Broken'));
    errorSpy.mockRestore();
  });

  it('isolates an entry whose detect() rejects the config, without stopping the scan', async () => {
    getTrackedCompaniesMock.mockReturnValue([
      company({ name: 'Misconfigured', provider: 'greenhouse' }),
      company({ name: 'Healthy', provider: 'lever' }),
    ]);
    const misconfiguredProvider = { id: 'greenhouse', detect: jest.fn().mockReturnValue(null), fetch: jest.fn() };
    const healthyProvider = {
      id: 'lever',
      fetch: jest.fn().mockResolvedValue([{ title: 'Ok', url: 'u', company: 'Healthy', location: '' }]),
    };
    loadProviderMock.mockResolvedValueOnce(misconfiguredProvider).mockResolvedValueOnce(healthyProvider);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const jobs = await scanTrackedCompanies();

    expect(jobs).toHaveLength(1);
    expect(misconfiguredProvider.fetch).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('isolates an entry with an unsupported provider id', async () => {
    getTrackedCompaniesMock.mockReturnValue([company({ provider: 'unknown-provider' })]);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const jobs = await scanTrackedCompanies();

    expect(jobs).toEqual([]);
    expect(loadProviderMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported provider id'));
    errorSpy.mockRestore();
  });

  it('does not pass a job through backfillDescription when it already has a description', async () => {
    getTrackedCompaniesMock.mockReturnValue([company()]);
    const jobWithDescription = {
      title: 'Engineer',
      url: 'u1',
      company: 'Acme',
      location: '',
      description: 'Already have one.',
    };
    const provider = { id: 'greenhouse', fetch: jest.fn().mockResolvedValue([jobWithDescription]) };
    loadProviderMock.mockResolvedValueOnce(provider);

    const jobs = await scanTrackedCompanies();

    expect(backfillDescriptionMock).not.toHaveBeenCalled();
    expect(jobs).toEqual([jobWithDescription]);
  });

  it("replaces a description-less job with backfillDescription's resolved result in the final output", async () => {
    getTrackedCompaniesMock.mockReturnValue([company()]);
    const bareJob = { title: 'Engineer', url: 'u1', company: 'Acme', location: '' };
    const backfilledJob = { ...bareJob, description: 'We build things.' };
    const provider = { id: 'greenhouse', fetch: jest.fn().mockResolvedValue([bareJob]) };
    loadProviderMock.mockResolvedValueOnce(provider);
    backfillDescriptionMock.mockResolvedValueOnce(backfilledJob);

    const jobs = await scanTrackedCompanies();

    expect(backfillDescriptionMock).toHaveBeenCalledWith(bareJob, { transport: 'http' });
    expect(jobs).toEqual([backfilledJob]);
    expect(jobs[0]).not.toBe(bareJob);
  });

  it('runs backfillDescription calls with bounded concurrency (never more than 3 in flight)', async () => {
    getTrackedCompaniesMock.mockReturnValue([company()]);
    const bareJobs = Array.from({ length: 6 }, (_, i) => ({
      title: `Job ${i}`,
      url: `u${i}`,
      company: 'Acme',
      location: '',
    }));
    const provider = { id: 'greenhouse', fetch: jest.fn().mockResolvedValue(bareJobs) };
    loadProviderMock.mockResolvedValueOnce(provider);

    let inFlight = 0;
    let maxInFlight = 0;
    const gates = bareJobs.map(() => deferred<ScrapedJobInput>());
    let callIndex = 0;
    backfillDescriptionMock.mockImplementation(async () => {
      const gate = gates[callIndex++];
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const result = await gate.promise;
      inFlight--;
      return result;
    });

    const scanPromise = scanTrackedCompanies();

    // Poll until the 3 concurrent workers have each picked up a job and are
    // blocked on their gate — avoids coupling the test to exact tick counts.
    for (let i = 0; i < 200 && callIndex < 3; i++) {
      await Promise.resolve();
    }

    expect(callIndex).toBe(3); // exactly 3 in flight — the 4th worker slot never opened
    expect(inFlight).toBe(3);
    expect(maxInFlight).toBe(3);

    gates.forEach((g, i) => g.resolve(bareJobs[i]));
    const jobs = await scanPromise;

    expect(jobs).toHaveLength(6);
    expect(maxInFlight).toBe(3);
  });

  it("keeps the rest of a company's job batch when one job's HTML-to-text step throws (detail-fetch fix)", async () => {
    // Uses the real backfillDescription (via requireActual) instead of the
    // module-level mock — this is what proves the try/catch fix around
    // loadHtmlToText()/htmlToText() in detail-fetch.ts actually stops a
    // single bad HTML page from taking down the whole company's job batch
    // at the orchestrator level, not just in detail-fetch's own unit tests.
    getTrackedCompaniesMock.mockReturnValue([company()]);
    const boomJob = { title: 'Boom Job', url: 'https://example.com/boom', company: 'Acme', location: '' };
    const okJob = { title: 'Ok Job', url: 'https://example.com/ok', company: 'Acme', location: '' };
    const provider = { id: 'greenhouse', fetch: jest.fn().mockResolvedValue([boomJob, okJob]) };
    loadProviderMock.mockResolvedValueOnce(provider);

    const jsonLdScript = (description: string): string =>
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', description })}</script>`;
    const pageHtml = (script: string): string => `<html><head>${script}</head><body></body></html>`;

    const fetchTextMock = jest.fn(async (url: string) =>
      url === boomJob.url
        ? pageHtml(jsonLdScript('<p>BOOM description</p>'))
        : pageHtml(jsonLdScript('<p>Ship things.</p>')),
    );
    makeProviderHttpContextMock.mockResolvedValue({ transport: 'http', fetchText: fetchTextMock });

    loadHtmlToTextMock.mockResolvedValue((raw: string) => {
      if (raw.includes('BOOM')) throw new Error('stripper exploded');
      return raw.replace(/<[^>]+>/g, ' ').trim();
    });

    const actualDetailFetch = jest.requireActual('./detail-fetch') as typeof import('./detail-fetch');
    backfillDescriptionMock.mockImplementation(actualDetailFetch.backfillDescription);

    const jobs = await scanTrackedCompanies();

    expect(jobs).toHaveLength(2);
    const boomResult = jobs.find((j) => j.url === boomJob.url);
    const okResult = jobs.find((j) => j.url === okJob.url);
    expect(boomResult?.description).toBeFalsy(); // stripper threw — left unchanged, not dropped
    expect(okResult?.description).toBe('Ship things.');
  });
});
