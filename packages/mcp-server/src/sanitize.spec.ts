import { homedir } from 'os';

import { sanitizeMessage } from './sanitize';

describe('sanitizeMessage', () => {
  it('replaces the home directory and everything under it', () => {
    const message = sanitizeMessage(`cannot read ${homedir()}/notes/inventory.json`, {});

    expect(message).not.toContain(homedir());
    expect(message).not.toContain('inventory.json');
    expect(message).toContain('[path]');
  });

  it('replaces the home directory written with the other slash style', () => {
    const flipped = homedir().includes('\\') ? homedir().replace(/\\/g, '/') : homedir().replace(/\//g, '\\');

    expect(sanitizeMessage(`cannot read ${flipped}`, {})).not.toContain(flipped);
  });

  it('replaces Windows and POSIX absolute paths', () => {
    const message = sanitizeMessage('open C:\\Data\\private\\inv.json failed, then /srv/app/data/inv.json failed', {});

    expect(message).not.toMatch(/Data|private|srv|inv\.json/);
    expect(message).toContain('[path]');
  });

  it('redacts API-key-looking tokens and any 32+ character token', () => {
    const message = sanitizeMessage('key sk-abcdef0123456789 and blob AbCdEf0123456789AbCdEf0123456789XYZ', {});

    expect(message).not.toContain('sk-abcdef0123456789');
    expect(message).not.toContain('AbCdEf0123456789AbCdEf0123456789XYZ');
  });

  it('redacts the value of an environment variable but ignores short values', () => {
    const env = { RESUMIQ_TOKEN: 'hunter2-hunter2', MODE: 'dev' };

    const message = sanitizeMessage('failed with hunter2-hunter2 in mode dev', env);

    expect(message).not.toContain('hunter2-hunter2');
    expect(message).toContain('mode dev');
  });

  it('caps the message length', () => {
    expect(sanitizeMessage('x '.repeat(500), {}).length).toBeLessThanOrEqual(301);
  });

  it('leaves an ordinary message alone', () => {
    expect(sanitizeMessage('No projects entry named "Foo"', {})).toBe('No projects entry named "Foo"');
  });
});
