import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConfigError, parseAppConfig } from './app-config';
import { EnvError, databaseSchemaOf, loadDatabaseUrl, loadHunterApiKey, loadRuntimeEnv } from './env';

const ROOT = resolve(__dirname, '..', '..');
const exampleText = readFileSync(join(ROOT, 'outreach.config.example.json'), 'utf-8');

function exampleWith(change: (config: Record<string, unknown>) => void): string {
  const config = JSON.parse(exampleText) as Record<string, unknown>;
  change(config);
  return JSON.stringify(config);
}

describe('parseAppConfig', () => {
  it('accepts the committed example and resolves the inventory path against the config folder', () => {
    const config = parseAppConfig(exampleText, ROOT);
    expect(config.dataInventoryPath).toBe(join(ROOT, 'examples', 'data-inventory.example.json'));
    expect(config.outreach.summer_internship).toEqual({ available: true });
    expect(config.draftRetryLimit).toBe(2);
  });

  it('fails fast with every invalid field listed', () => {
    const text = exampleWith((config) => {
      config.hours_per_week = 0;
      delete config.data_inventory_path;
    });
    expect(() => parseAppConfig(text, ROOT)).toThrow(ConfigError);
    expect(() => parseAppConfig(text, ROOT)).toThrow(/hours_per_week[\s\S]*data_inventory_path/);
  });

  it('rejects a track whose entry limits cannot form a valid tailoring', () => {
    const text = exampleWith((config) => {
      (config.tracks as Record<string, Record<string, unknown>>).ai.max_projects = 4;
      (config.tracks as Record<string, Record<string, unknown>>).ai.max_experiences = 3;
    });
    expect(() => parseAppConfig(text, ROOT)).toThrow(/max_experiences \+ max_projects/);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseAppConfig('{ nope', ROOT)).toThrow(/not valid JSON/);
  });
});

describe('environment', () => {
  it('defaults tectonic to the PATH binary and the config to outreach.config.json', () => {
    expect(loadRuntimeEnv({})).toEqual({ tectonicPath: 'tectonic', configPath: 'outreach.config.json' });
    expect(loadRuntimeEnv({ TECTONIC_PATH: 'C:\\Tools\\Tectonic\\tectonic.exe' }).tectonicPath).toBe(
      'C:\\Tools\\Tectonic\\tectonic.exe',
    );
  });

  it('treats blank values from a copied .env.example as unset', () => {
    expect(loadRuntimeEnv({ TECTONIC_PATH: '', OUTREACH_CONFIG_PATH: '  ' })).toEqual({
      tectonicPath: 'tectonic',
      configPath: 'outreach.config.json',
    });
  });

  it('requires a postgres url with a dedicated schema', () => {
    expect(loadDatabaseUrl({ OUTREACH_DATABASE_URL: 'postgresql://u:p@host/db?sslmode=require&schema=outreach' })).toContain(
      'schema=outreach',
    );
    expect(() => loadDatabaseUrl({})).toThrow(EnvError);
    expect(() => loadDatabaseUrl({ OUTREACH_DATABASE_URL: 'postgresql://u:p@host/db' })).toThrow(/schema/);
    expect(() => loadDatabaseUrl({ OUTREACH_DATABASE_URL: 'postgresql://u:p@host/db?schema=public' })).toThrow(/schema/);
    expect(() => loadDatabaseUrl({ OUTREACH_DATABASE_URL: 'mysql://u:p@host/db?schema=outreach' })).toThrow(/postgres/);
  });

  it('never echoes the database url in an error', () => {
    try {
      loadDatabaseUrl({ OUTREACH_DATABASE_URL: 'postgresql://user:hunter2@host/db' });
      throw new Error('expected a failure');
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });

  it('treats a missing or blank Hunter key as not set, since it is optional', () => {
    expect(loadHunterApiKey({})).toBeNull();
    expect(loadHunterApiKey({ HUNTER_API_KEY: '   ' })).toBeNull();
    expect(loadHunterApiKey({ HUNTER_API_KEY: ' abc123 ' })).toBe('abc123');
  });

  it('reads the schema out of the validated database url', () => {
    expect(databaseSchemaOf('postgresql://u:p@host/db?sslmode=require&schema=outreach')).toBe('outreach');
    expect(() => databaseSchemaOf('postgresql://u:p@host/db')).toThrow(EnvError);
    expect(() => databaseSchemaOf('postgresql://u:p@host/db?schema=Bad-Name')).toThrow(EnvError);
  });
});
