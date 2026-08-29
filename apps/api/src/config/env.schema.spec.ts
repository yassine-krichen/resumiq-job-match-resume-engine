import { validateEnv } from './env.schema';

const baseEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/db',
  API_URL: 'http://localhost:3001',
  TRUSTED_ORIGINS: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'test-secret',
  GITHUB_CLIENT_ID: 'github-id',
  GITHUB_CLIENT_SECRET: 'github-secret',
  LINKEDIN_CLIENT_ID: 'linkedin-id',
  LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
};

describe('validateEnv', () => {
  const originalEnv = process.env;
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit called');
    }) as unknown as jest.SpyInstance;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('passes silently with a complete env using the freellmapi-default path (USE_LLM_BRIDGE unset)', () => {
    process.env = {
      ...process.env,
      ...baseEnv,
      FREELLMAPI_API_KEY: 'key',
      FREELLMAPI_MODEL: 'auto',
    };

    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('passes silently with a complete env using the USE_LLM_BRIDGE=true path', () => {
    process.env = {
      ...process.env,
      ...baseEnv,
      USE_LLM_BRIDGE: 'true',
      BRIDGE_URL: 'http://localhost:4000',
    };

    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('exits when a required base var is missing', () => {
    process.env = {
      ...process.env,
      ...baseEnv,
      DATABASE_URL: undefined,
      FREELLMAPI_API_KEY: 'key',
      FREELLMAPI_MODEL: 'auto',
    };
    delete process.env.DATABASE_URL;

    expect(() => validateEnv()).toThrow('exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when FREELLMAPI_API_KEY/FREELLMAPI_MODEL are missing and USE_LLM_BRIDGE is not "true"', () => {
    process.env = {
      ...process.env,
      ...baseEnv,
    };

    expect(() => validateEnv()).toThrow('exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when BRIDGE_URL is missing and USE_LLM_BRIDGE is "true"', () => {
    process.env = {
      ...process.env,
      ...baseEnv,
      USE_LLM_BRIDGE: 'true',
    };

    expect(() => validateEnv()).toThrow('exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
