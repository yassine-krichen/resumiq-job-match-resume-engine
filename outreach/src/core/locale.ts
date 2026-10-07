import type { OutreachLanguage } from '../schemas/outreach';

// SPEC section 3: French for France, Belgium (FR), Switzerland (Romandie),
// Quebec, Luxembourg and Monaco. English everywhere else, no German.

const FRENCH_COUNTRIES = new Set(['FR', 'LU', 'MC']);

function foldAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

// Region/city hints for countries that are only partly French-speaking. Matched
// as whole words so "Jura" does not match "Jurassic".
const FRENCH_REGION_HINTS: Record<'BE' | 'CH' | 'CA', readonly string[]> = {
  BE: ['wallonie', 'wallonia', 'bruxelles', 'brussels', 'liege', 'namur', 'charleroi', 'mons', 'hainaut', 'louvain-la-neuve'],
  CH: ['romandie', 'geneve', 'geneva', 'vaud', 'lausanne', 'neuchatel', 'fribourg', 'jura', 'valais', 'sion', 'nyon'],
  CA: ['quebec', 'qc', 'montreal', 'laval', 'gatineau', 'sherbrooke', 'trois-rivieres', 'levis'],
};

function regionIsFrench(country: 'BE' | 'CH' | 'CA', region: string): boolean {
  const folded = foldAccents(region);
  return FRENCH_REGION_HINTS[country].some((hint) =>
    new RegExp(`(^|[^a-z])${hint.replace(/[-]/g, '\\-')}($|[^a-z])`).test(folded),
  );
}

// Used only when the country is unknown.
const FRENCH_TIMEZONES = new Set([
  'Europe/Paris',
  'Europe/Luxembourg',
  'Europe/Monaco',
  'America/Montreal',
]);

export interface LocaleInput {
  /** ISO 3166-1 alpha-2, uppercase. */
  country?: string | null;
  /** State, province, canton or city; needed to tell Romandie from Zurich, Wallonia from Flanders, Quebec from Ontario. */
  region?: string | null;
  timezone?: string | null;
}

/**
 * Email language for a company. An ambiguous bilingual country with no region
 * information resolves to English, which every recipient in these markets reads.
 */
export function resolveLanguage({ country, region, timezone }: LocaleInput): OutreachLanguage {
  const code = country?.toUpperCase();
  if (code) {
    if (FRENCH_COUNTRIES.has(code)) return 'fr';
    if ((code === 'BE' || code === 'CH' || code === 'CA') && region) {
      return regionIsFrench(code, region) ? 'fr' : 'en';
    }
    return 'en';
  }
  return timezone && FRENCH_TIMEZONES.has(timezone) ? 'fr' : 'en';
}

const COUNTRY_TIMEZONES: Record<string, string> = {
  FR: 'Europe/Paris',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  LU: 'Europe/Luxembourg',
  MC: 'Europe/Monaco',
  DE: 'Europe/Berlin',
  AT: 'Europe/Vienna',
  NL: 'Europe/Amsterdam',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  IT: 'Europe/Rome',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  US: 'America/New_York',
  CA: 'America/Toronto',
  AU: 'Australia/Sydney',
  SG: 'Asia/Singapore',
  IN: 'Asia/Kolkata',
  JP: 'Asia/Tokyo',
  AE: 'Asia/Dubai',
  TN: 'Africa/Tunis',
  MA: 'Africa/Casablanca',
};

/**
 * Timezone to use when research did not find the HQ city's zone. The US falls
 * back to Eastern (SPEC section 3). Null when the country has no entry: the
 * caller decides whether to ask the researcher again or skip the row.
 */
export function fallbackTimezone(country: string): string | null {
  return COUNTRY_TIMEZONES[country.toUpperCase()] ?? null;
}

export type OverlapRegion = 'europe' | 'us' | 'other';

// The US/Canada overlap line ("12:00-16:00 ET") only makes sense for US and
// Canadian zones; Sao_Paulo or Mexico_City are also under America/.
const NORTH_AMERICA_ZONES = new Set([
  'America/New_York', 'America/Detroit', 'America/Chicago', 'America/Menominee', 'America/Denver',
  'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau',
  'America/Sitka', 'America/Yakutat', 'America/Nome', 'America/Metlakatla', 'America/Adak',
  'America/Toronto', 'America/Montreal', 'America/Nipigon', 'America/Thunder_Bay', 'America/Atikokan',
  'America/Winnipeg', 'America/Rainy_River', 'America/Regina', 'America/Swift_Current',
  'America/Edmonton', 'America/Cambridge_Bay', 'America/Yellowknife', 'America/Inuvik',
  'America/Vancouver', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Creston',
  'America/Whitehorse', 'America/Dawson', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton',
  'America/Goose_Bay', 'America/Blanc-Sablon', 'America/St_Johns', 'America/Iqaluit',
  'America/Pangnirtung', 'America/Rankin_Inlet', 'America/Resolute', 'Pacific/Honolulu',
]);
const NORTH_AMERICA_PREFIXES = ['America/Indiana/', 'America/Kentucky/', 'America/North_Dakota/', 'US/', 'Canada/'];

/** Which overlap line of the config applies to a recipient timezone. */
export function overlapRegion(timezone: string): OverlapRegion {
  if (timezone.startsWith('Europe/')) return 'europe';
  if (NORTH_AMERICA_ZONES.has(timezone) || NORTH_AMERICA_PREFIXES.some((prefix) => timezone.startsWith(prefix))) {
    return 'us';
  }
  return 'other';
}
