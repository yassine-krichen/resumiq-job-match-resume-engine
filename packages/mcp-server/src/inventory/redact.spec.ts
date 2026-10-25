import { projectEntry } from './redact';

const certification = (credentialId: unknown) => ({
  name: 'Cloud Practitioner',
  issuer: 'ExampleCloud',
  date: '2025-02',
  credential_id: credentialId,
  link: `https://example.com/verify/${String(credentialId)}`,
  source: `export:${String(credentialId)}`,
  description: `Credential ${String(credentialId)} issued`,
});

describe('projectEntry', () => {
  it('never includes credential_id itself', () => {
    expect(projectEntry('certifications', certification('ABC-12345'))).not.toHaveProperty('credential_id');
  });

  it.each([
    ['a string id', 'ABC-12345'],
    ['a numeric id', 123456789],
    ['a short id', 'A1'],
  ])('drops link, source and description when the credential id is %s', (_label, id) => {
    const out = projectEntry('certifications', certification(id));

    expect(out).toEqual({ name: 'Cloud Practitioner', issuer: 'ExampleCloud', date: '2025-02' });
  });

  it('drops a verification link whose id is a case variant of the credential id', () => {
    const entry = { ...certification('AbC-123'), link: 'https://example.com/v/abc-123' };

    expect(projectEntry('certifications', entry)).not.toHaveProperty('link');
  });

  it('drops a verification link whose id is percent-encoded', () => {
    const entry = { ...certification('AB C/12'), link: 'https://example.com/v/AB%20C%2F12' };

    expect(JSON.stringify(projectEntry('certifications', entry))).not.toContain('%2F12');
  });

  it('keeps link, source and description when there is no credential id', () => {
    const out = projectEntry('certifications', certification(''));

    expect(out).toEqual(expect.objectContaining({ link: expect.any(String), source: expect.any(String), description: expect.any(String) }));
  });

  it('does not treat a missing or null credential id as present', () => {
    expect(projectEntry('certifications', { ...certification(''), credential_id: null })).toHaveProperty('link');
    expect(projectEntry('certifications', { name: 'X', link: 'https://example.com' })).toHaveProperty('link');
  });

  it('drops fields that are not on the allow-list', () => {
    const out = projectEntry('projects', { name: 'P', secret_note: 'hidden', email: 'a@b.c' });

    expect(out).toEqual({ name: 'P' });
  });
});
