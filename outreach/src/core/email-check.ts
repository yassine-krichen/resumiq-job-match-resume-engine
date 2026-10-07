import { promises as dns } from 'node:dns';

export type MxStatus = 'ok' | 'none' | 'unknown' | 'unchecked';

export interface EmailCheckResult {
  syntaxValid: boolean;
  /** info@, contact@, careers@ ... still sendable, but flagged for the reviewer. */
  roleAccount: boolean;
  /** 'none' means the domain definitely cannot receive mail; 'unknown' means the lookup itself failed. */
  mx: MxStatus;
}

/** Returns the mail exchangers of a domain; throws a Node DNS error when the lookup fails. */
export type MxResolver = (domain: string) => Promise<string[]>;

const ROLE_LOCAL_PARTS = new Set([
  'info',
  'contact',
  'hello',
  'hi',
  'admin',
  'administrator',
  'support',
  'help',
  'sales',
  'office',
  'team',
  'jobs',
  'job',
  'careers',
  'career',
  'recruiting',
  'recruitment',
  'recrutement',
  'rh',
  'hr',
  'talent',
  'press',
  'presse',
  'marketing',
  'webmaster',
  'postmaster',
  'noreply',
  'no-reply',
  'donotreply',
  'accueil',
  'secretariat',
  'stages',
  'stage',
  'internships',
]);

// Pragmatic, not RFC 5322 complete: one @, a dotted domain, no quoted local
// parts or comments.
const EMAIL_SYNTAX = /^[^\s@"(),:;<>[\\\]]+@[^\s@"(),:;<>[\\\]]+\.[^\s@"(),:;<>[\\\]]{2,}$/;

export function isValidEmailSyntax(email: string): boolean {
  if (email.length > 254 || !EMAIL_SYNTAX.test(email)) return false;
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return !domain.startsWith('-') && !domain.endsWith('-') && !domain.includes('..');
}

export function isRoleAccount(email: string): boolean {
  const local = email.slice(0, email.lastIndexOf('@')).toLowerCase();
  return ROLE_LOCAL_PARTS.has(local);
}

// ENOTFOUND / ENODATA are definitive answers; timeouts, SERVFAIL and the like
// are not, and must not drop a good lead.
const DEFINITIVE_DNS_ERRORS = new Set(['ENOTFOUND', 'ENODATA']);

function isDefinitiveDnsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && DEFINITIVE_DNS_ERRORS.has(code);
}

// RFC 7505: a single MX of "." (some resolvers return "") says the domain accepts no mail.
function realExchangers(exchangers: readonly string[]): string[] {
  return exchangers.filter((exchange) => exchange !== '' && exchange !== '.');
}

/** Default resolver: MX records, falling back to an A record (implicit MX, RFC 5321 section 5.1). */
export const resolveMailExchangers: MxResolver = async (domain) => {
  try {
    const records = await dns.resolveMx(domain);
    // Any MX record means the domain decided how it receives mail: no A-record
    // fallback, and a lone null MX makes this return [] (RFC 7505).
    if (records.length > 0) return realExchangers(records.map((record) => record.exchange));
  } catch (error) {
    if (!isDefinitiveDnsError(error)) throw error;
  }
  try {
    const addresses = await dns.resolve4(domain);
    return addresses.length > 0 ? [domain] : [];
  } catch (error) {
    if (isDefinitiveDnsError(error)) return [];
    throw error;
  }
};

/**
 * Syntax, role-account flag and (unless `resolveMx` is null) an MX lookup. The
 * resolver is injectable so tests and offline runs never touch the network.
 */
export async function checkEmail(
  email: string,
  options: { resolveMx?: MxResolver | null } = {},
): Promise<EmailCheckResult> {
  const syntaxValid = isValidEmailSyntax(email);
  const roleAccount = syntaxValid && isRoleAccount(email);
  if (!syntaxValid || options.resolveMx === null) return { syntaxValid, roleAccount, mx: 'unchecked' };

  const resolve = options.resolveMx ?? resolveMailExchangers;
  try {
    const exchangers = realExchangers(await resolve(email.slice(email.lastIndexOf('@') + 1)));
    return { syntaxValid, roleAccount, mx: exchangers.length > 0 ? 'ok' : 'none' };
  } catch (error) {
    return { syntaxValid, roleAccount, mx: isDefinitiveDnsError(error) ? 'none' : 'unknown' };
  }
}
