import { OutreachInputRowSchema } from '../schemas/outreach';
import type { OutreachInputRow } from '../schemas/outreach';

/** A validated input row plus the domain facts the dedupe and DB layers key on. */
export interface NormalizedRow extends OutreachInputRow {
  /** Lowercased address; the pipeline sends to exactly this. */
  email: string;
  /** Host used for dedupe: the email domain, or the website host when the email is free-mail. Null when neither is usable. */
  domain: string | null;
  /** True when the email is on a public mailbox provider (gmail.com, outlook.fr, ...). */
  freeMail: boolean;
  /** Unique key per company: the domain, or the full email when only a free-mail address is known. */
  domainKey: string;
}

export interface InvalidRow {
  /** Zero-based position in the input list. */
  index: number;
  row: unknown;
  errors: string[];
}

export interface NormalizeResult {
  valid: NormalizedRow[];
  invalid: InvalidRow[];
}

// Mailbox providers whose domain says nothing about the company. Not exhaustive:
// a miss only means a personal address is treated as a company domain.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.fr',
  'ymail.com',
  'outlook.com',
  'outlook.fr',
  'hotmail.com',
  'hotmail.fr',
  'live.com',
  'live.fr',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.fr',
  'gmx.de',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'laposte.net',
  'yandex.com',
  'mail.com',
  'zoho.com',
]);

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Canonical host for dedupe: lowercase, no scheme, no "www.", no port, no
 * path, IDN converted to punycode. Subdomains are kept on purpose
 * (cs.uni.edu and math.uni.edu are different departments). Returns null when
 * the value is not a plausible host.
 */
export function normalizeDomain(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let hostname: string;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return null;
  }
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

function parseRow(raw: unknown): { row: OutreachInputRow } | { errors: string[] } {
  const parsed = OutreachInputRowSchema.safeParse(raw);
  if (parsed.success) return { row: parsed.data };
  return {
    errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`),
  };
}

function toNormalizedRow(row: OutreachInputRow): NormalizedRow | { errors: string[] } {
  // A list cell like "a@x.fr; b@x.fr" is ambiguous: the spec sends to exactly
  // one given address, so refuse to pick one silently.
  if (/[;,\s]/.test(row.email)) {
    return { errors: ['email: contains more than one address or whitespace'] };
  }
  const email = row.email.toLowerCase();
  const freeMail = isFreeMailDomain(emailDomain(email));
  const websiteHost = row.website ? normalizeDomain(row.website) : null;
  const domain = freeMail ? websiteHost : normalizeDomain(emailDomain(email));

  if (!freeMail && domain === null) {
    return { errors: ['email: domain is not a valid host'] };
  }
  return { ...row, email, domain, freeMail, domainKey: domain ?? email };
}

/**
 * Validates agent-written rows one by one so a single bad row never loses the
 * rest of the list.
 */
export function normalizeRows(rawRows: readonly unknown[]): NormalizeResult {
  const valid: NormalizedRow[] = [];
  const invalid: InvalidRow[] = [];

  rawRows.forEach((raw, index) => {
    const parsed = parseRow(raw);
    if ('errors' in parsed) {
      invalid.push({ index, row: raw, errors: parsed.errors });
      return;
    }
    const normalized = toNormalizedRow(parsed.row);
    if ('errors' in normalized) {
      invalid.push({ index, row: raw, errors: normalized.errors });
      return;
    }
    valid.push(normalized);
  });

  return { valid, invalid };
}

// ── File text parsing (JSON, or CSV from French spreadsheets) ───────────────

// A Map, not an object: a header called "constructor" or "__proto__" must not find an inherited member.
const HEADER_ALIASES = new Map<string, keyof OutreachInputRow>(Object.entries({
  company: 'company',
  entreprise: 'company',
  societe: 'company',
  organisation: 'company',
  organization: 'company',
  universite: 'company',
  university: 'company',
  email: 'email',
  mail: 'email',
  courriel: 'email',
  emailaddress: 'email',
  adresseemail: 'email',
  name: 'name',
  nom: 'name',
  contact: 'name',
  role: 'role',
  poste: 'role',
  fonction: 'role',
  title: 'role',
  website: 'website',
  site: 'website',
  siteweb: 'website',
  url: 'website',
  notes: 'notes',
  note: 'notes',
  commentaire: 'notes',
  commentaires: 'notes',
} as Record<string, keyof OutreachInputRow>));

function canonicalHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// Excel in a French locale writes ';'-separated CSV because ',' is the decimal
// mark. Pick whichever delimiter dominates the header line.
function detectDelimiter(headerLine: string): ',' | ';' | '\t' {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const char of headerLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char] += 1;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[',']) return '\t';
  return ',';
}

function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const endRecord = (): void => {
    record.push(field);
    field = '';
    if (record.some((cell) => cell.trim() !== '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      field += char;
    }
  }
  endRecord();
  return records;
}

/** Parses delimiter-separated text with a header row into raw row objects. */
export function parseDelimitedRows(text: string): Record<string, string>[] {
  const withoutBom = text.replace(/^﻿/, '');
  const firstLine = withoutBom.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const [header, ...records] = splitRecords(withoutBom, detectDelimiter(firstLine));
  if (!header) return [];

  const columns = header.map((cell) => HEADER_ALIASES.get(canonicalHeader(cell)));
  return records.map((cells) => {
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      if (column !== undefined && cells[index] !== undefined) row[column] = cells[index].trim();
    });
    return row;
  });
}

/**
 * Parses the text of `normalized.json` (an array of rows, or `{ rows: [...] }`)
 * or a CSV export, tolerating a UTF-8 BOM. Throws when JSON is malformed.
 */
export function parseRowsFromText(text: string): unknown[] {
  const withoutBom = text.replace(/^﻿/, '').trimStart();
  if (withoutBom.startsWith('[') || withoutBom.startsWith('{')) {
    const parsed: unknown = JSON.parse(withoutBom);
    if (Array.isArray(parsed)) return parsed;
    const rows = (parsed as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows;
    throw new Error('JSON input must be an array of rows or an object with a "rows" array');
  }
  return parseDelimitedRows(withoutBom);
}
