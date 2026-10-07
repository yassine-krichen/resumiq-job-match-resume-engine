import { checkEmail, isRoleAccount, isValidEmailSyntax } from './email-check';

describe('isValidEmailSyntax', () => {
  it.each(['claire@acme.fr', 'first.last+tag@sub.acme.co.uk', 'a_b-c@xn--caf-dma.fr'])('accepts %s', (email) => {
    expect(isValidEmailSyntax(email)).toBe(true);
  });

  it.each([
    'no-at-sign.com',
    'two@@acme.com',
    'spaces in@acme.com',
    'a@acme',
    '.lead@acme.com',
    'dou..ble@acme.com',
    'a@-acme.com',
    '<a@acme.com>',
    'a@acme.com, b@acme.com',
  ])('rejects %s', (email) => {
    expect(isValidEmailSyntax(email)).toBe(false);
  });
});

describe('isRoleAccount', () => {
  it('flags shared mailboxes such as careers@ and recrutement@', () => {
    expect(isRoleAccount('Careers@acme.com')).toBe(true);
    expect(isRoleAccount('recrutement@acme.fr')).toBe(true);
  });

  it('does not flag a named person', () => {
    expect(isRoleAccount('claire.martin@acme.com')).toBe(false);
  });
});

describe('checkEmail', () => {
  it('reports ok when the injected resolver finds a mail exchanger', async () => {
    const result = await checkEmail('claire@acme.com', { resolveMx: async () => ['mx.acme.com'] });

    expect(result).toEqual({ syntaxValid: true, roleAccount: false, mx: 'ok' });
  });

  it('reports none when the domain has no mail exchangers', async () => {
    const result = await checkEmail('info@acme.com', { resolveMx: async () => [] });

    expect(result).toEqual({ syntaxValid: true, roleAccount: true, mx: 'none' });
  });

  it('reports none for a definitive DNS miss but unknown for a transient failure', async () => {
    const notFound = Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
    const timeout = Object.assign(new Error('slow'), { code: 'ETIMEOUT' });

    const missing = await checkEmail('a@gone.example', { resolveMx: () => Promise.reject(notFound) });
    const flaky = await checkEmail('a@slow.example', { resolveMx: () => Promise.reject(timeout) });

    expect(missing.mx).toBe('none');
    expect(flaky.mx).toBe('unknown');
  });

  it.each([[['.']], [['']], [['.', '']]])('treats a null MX (RFC 7505) %j as a domain that accepts no mail', async (exchangers) => {
    const result = await checkEmail('a@nomail.example', { resolveMx: async () => exchangers });

    expect(result.mx).toBe('none');
  });

  it('skips the lookup for an invalid address and never calls the resolver', async () => {
    const resolveMx = jest.fn().mockResolvedValue(['mx']);

    const result = await checkEmail('not-an-email', { resolveMx });

    expect(result).toEqual({ syntaxValid: false, roleAccount: false, mx: 'unchecked' });
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it('skips the lookup when the resolver is disabled with null', async () => {
    const result = await checkEmail('claire@acme.com', { resolveMx: null });

    expect(result.mx).toBe('unchecked');
  });
});
