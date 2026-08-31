import { readFileSync } from 'fs';

jest.mock('fs', () => ({ readFileSync: jest.fn() }));

const readFileSyncMock = readFileSync as jest.Mock;

// Imported after the mock is registered so tracked-companies.ts's module-level
// readFileSync call is the mocked one.
import { getTrackedCompanies } from './tracked-companies';

describe('getTrackedCompanies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses a valid config array into TrackedCompany entries', () => {
    readFileSyncMock.mockReturnValue(
      JSON.stringify([
        { name: 'Stripe', provider: 'greenhouse', careers_url: 'https://job-boards.greenhouse.io/stripe' },
        { name: 'RemoteOK', provider: 'remoteok', enabled: true },
      ]),
    );

    const result = getTrackedCompanies();

    expect(result).toEqual([
      { name: 'Stripe', provider: 'greenhouse', careers_url: 'https://job-boards.greenhouse.io/stripe' },
      { name: 'RemoteOK', provider: 'remoteok', enabled: true },
    ]);
  });

  it('throws when the config file does not contain a JSON array', () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ name: 'not-an-array' }));

    expect(() => getTrackedCompanies()).toThrow('must contain a JSON array');
  });

  it('throws when an entry is missing a required "name" field', () => {
    readFileSyncMock.mockReturnValue(JSON.stringify([{ provider: 'greenhouse' }]));

    expect(() => getTrackedCompanies()).toThrow('"name" must be a non-empty string');
  });

  it('throws when an entry is missing a required "provider" field', () => {
    readFileSyncMock.mockReturnValue(JSON.stringify([{ name: 'Stripe' }]));

    expect(() => getTrackedCompanies()).toThrow('"provider" must be a non-empty string');
  });

  it('throws when "careers_url" is present but not a string', () => {
    readFileSyncMock.mockReturnValue(
      JSON.stringify([{ name: 'Stripe', provider: 'greenhouse', careers_url: 123 }]),
    );

    expect(() => getTrackedCompanies()).toThrow('"careers_url" must be a string');
  });

  it('throws when "enabled" is present but not a boolean', () => {
    readFileSyncMock.mockReturnValue(
      JSON.stringify([{ name: 'Stripe', provider: 'greenhouse', enabled: 'yes' }]),
    );

    expect(() => getTrackedCompanies()).toThrow('"enabled" must be a boolean');
  });
});
