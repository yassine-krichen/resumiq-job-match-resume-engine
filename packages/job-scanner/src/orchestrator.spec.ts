import { scanTrackedCompanies } from './orchestrator';
import { getTrackedCompanies } from './tracked-companies';
import { loadProvider, makeProviderHttpContext } from './provider-loader';
import type { TrackedCompany } from './types';

jest.mock('./tracked-companies', () => ({ getTrackedCompanies: jest.fn() }));
jest.mock('./provider-loader', () => ({
  loadProvider: jest.fn(),
  makeProviderHttpContext: jest.fn(),
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

const getTrackedCompaniesMock = getTrackedCompanies as jest.Mock;
const loadProviderMock = loadProvider as jest.Mock;
const makeProviderHttpContextMock = makeProviderHttpContext as jest.Mock;

function company(overrides: Partial<TrackedCompany> = {}): TrackedCompany {
  return { name: 'Acme', provider: 'greenhouse', enabled: true, ...overrides };
}

describe('scanTrackedCompanies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    makeProviderHttpContextMock.mockResolvedValue({ transport: 'http' });
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
});
