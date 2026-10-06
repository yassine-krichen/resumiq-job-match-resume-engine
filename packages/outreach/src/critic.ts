import type { MasterDB, OutreachClaim, OutreachConfig, OutreachDraft, OutreachLanguage } from '@resumiq/schemas';

import { overlapRegion } from './locale';
import { containsWord, countWords, extractNumbers, normalizeForMatch } from './text-utils';

// Deterministic checks from SPEC section 5. The writer agent only sees the
// failures and retries; nothing here calls an LLM.

export type CriticRule =
  | 'subject_length'
  | 'subject_exclamation'
  | 'subject_all_caps'
  | 'body_word_count'
  | 'follow_up_word_count'
  | 'banned_phrase'
  | 'call_to_action'
  | 'question_marks'
  | 'hook'
  | 'availability'
  | 'internship_mention'
  | 'invented_number'
  | 'unknown_project'
  | 'proof_point'
  | 'foreign_link'
  | 'placeholder'
  | 'markdown'
  | 'em_dash'
  | 'company_name'
  | 'language';

export interface CriticFailure {
  rule: CriticRule;
  detail: string;
}

export interface CriticResult {
  pass: boolean;
  failures: CriticFailure[];
}

export interface CriticInput {
  draft: OutreachDraft;
  language: OutreachLanguage;
  companyName: string;
  /** IANA zone of the recipient; selects which overlap line must appear. */
  timezone: string;
  config: OutreachConfig;
  /** Claims that passed the quote verifier; the hook must point at one of these. */
  verifiedClaims: readonly OutreachClaim[];
  masterDb: MasterDB;
}

export const BANNED_PHRASES: Record<OutreachLanguage, readonly string[]> = {
  en: [
    'reaching out',
    'leverage',
    'i hope this finds you',
    'i hope this email finds you',
    'i hope you are doing well',
    'i hope you are well',
    "i hope you're doing well",
    'i am writing to',
    "i'm writing to",
    'passionate',
    'synergy',
    'touch base',
    'esteemed',
    'cutting-edge',
  ],
  fr: [
    'je me permets de vous contacter',
    "n'hésitez pas",
    'passionné',
    "j'espère que vous allez bien",
    'je vous écris',
    'dynamique',
  ],
};

export const BANNED_FOLLOW_UP_PHRASES: readonly string[] = ['just following up', 'circling back', 'bumping'];

const BODY_WORD_BANDS: Record<OutreachLanguage, { min: number; max: number }> = {
  en: { min: 50, max: 120 },
  fr: { min: 55, max: 130 },
};
const FOLLOW_UP_WORD_BAND = { min: 25, max: 70 };
const MAX_SUBJECT_LENGTH = 60;

// Distinctive function words only: words shared by both languages ("a", "on",
// "plus", "me") are left out so they cannot tip the count.
const STOPWORDS: Record<OutreachLanguage, ReadonlySet<string>> = {
  en: new Set([
    'the', 'and', 'of', 'to', 'with', 'for', 'is', 'are', 'was', 'my', 'you', 'your', 'this', 'that',
    'we', 'our', 'have', 'has', 'would', 'can', 'will', 'i', 'it', 'in', 'at', 'by', 'from', 'be',
  ]),
  fr: new Set([
    'le', 'la', 'les', 'des', 'du', 'de', 'et', 'un', 'une', 'je', 'vous', 'votre', 'vos', 'pour',
    'avec', 'dans', 'est', 'sont', 'que', 'qui', 'au', 'aux', 'mon', 'ma', 'mes', 'sur', 'nous',
    'notre', 'ce', 'cette', 'ces',
  ]),
};

const LEGAL_SUFFIXES = new Set([
  'inc', 'llc', 'ltd', 'limited', 'gmbh', 'sas', 'sarl', 'sa', 'corp', 'corporation', 'co', 'company', 'plc', 'ag', 'bv',
]);

interface NamedText {
  label: 'subject' | 'body' | 'follow-up';
  text: string;
}

function allTexts(draft: OutreachDraft): NamedText[] {
  return [
    { label: 'subject', text: draft.subject },
    { label: 'body', text: draft.body },
    { label: 'follow-up', text: draft.follow_up_body },
  ];
}

// ── Individual rules; each returns its failures ─────────────────────────────

function checkSubject(draft: OutreachDraft, companyName: string): CriticFailure[] {
  const failures: CriticFailure[] = [];
  const { subject } = draft;
  if (subject.length > MAX_SUBJECT_LENGTH) {
    failures.push({ rule: 'subject_length', detail: `subject is ${subject.length} chars, max ${MAX_SUBJECT_LENGTH}` });
  }
  if (subject.includes('!')) {
    failures.push({ rule: 'subject_exclamation', detail: 'subject contains "!"' });
  }
  // 4+ letters so "AI", "API" and "SaaS" pass, and a company written in
  // capitals (NASA) is not penalised for its own name.
  const companyUpper = companyName.toUpperCase();
  const shouting = (subject.match(/\p{L}{4,}/gu) ?? []).filter(
    (word) => word === word.toUpperCase() && word !== word.toLowerCase() && !companyUpper.includes(word),
  );
  if (shouting.length > 0) {
    failures.push({ rule: 'subject_all_caps', detail: `all-caps word in subject: ${shouting.join(', ')}` });
  }
  return failures;
}

function checkWordCounts(draft: OutreachDraft, language: OutreachLanguage): CriticFailure[] {
  const failures: CriticFailure[] = [];
  const bodyBand = BODY_WORD_BANDS[language];
  const bodyWords = countWords(draft.body);
  if (bodyWords < bodyBand.min || bodyWords > bodyBand.max) {
    failures.push({
      rule: 'body_word_count',
      detail: `body has ${bodyWords} words, expected ${bodyBand.min}-${bodyBand.max} (${language})`,
    });
  }
  const followUpWords = countWords(draft.follow_up_body);
  if (followUpWords < FOLLOW_UP_WORD_BAND.min || followUpWords > FOLLOW_UP_WORD_BAND.max) {
    failures.push({
      rule: 'follow_up_word_count',
      detail: `follow-up has ${followUpWords} words, expected ${FOLLOW_UP_WORD_BAND.min}-${FOLLOW_UP_WORD_BAND.max}`,
    });
  }
  return failures;
}

function checkBannedPhrases(draft: OutreachDraft): CriticFailure[] {
  const failures: CriticFailure[] = [];
  const everyPhrase = [...BANNED_PHRASES.en, ...BANNED_PHRASES.fr];
  for (const { label, text } of allTexts(draft)) {
    const normalized = normalizeForMatch(text);
    const phrases = label === 'follow-up' ? [...everyPhrase, ...BANNED_FOLLOW_UP_PHRASES] : everyPhrase;
    for (const phrase of phrases) {
      if (normalized.includes(normalizeForMatch(phrase))) {
        failures.push({ rule: 'banned_phrase', detail: `${label} contains banned phrase "${phrase}"` });
      }
    }
  }
  return failures;
}

function checkCallToAction(draft: OutreachDraft): CriticFailure[] {
  const failures: CriticFailure[] = [];
  const cta = normalizeForMatch(draft.cta);
  const body = normalizeForMatch(draft.body);
  const occurrences = cta === '' ? 0 : body.split(cta).length - 1;
  if (occurrences !== 1) {
    failures.push({
      rule: 'call_to_action',
      detail: `the call to action must appear exactly once in the body verbatim, found ${occurrences}`,
    });
  }
  // The subject and body are one email, so they share the single allowed question mark.
  for (const { label, text } of [
    { label: 'subject and body', text: `${draft.subject}\n${draft.body}` },
    { label: 'follow-up', text: draft.follow_up_body },
  ]) {
    const questionMarks = (text.match(/\?/g) ?? []).length;
    if (questionMarks > 1) {
      failures.push({ rule: 'question_marks', detail: `${label} has ${questionMarks} question marks, max 1` });
    }
  }
  return failures;
}

function checkHook(draft: OutreachDraft, verifiedClaims: readonly OutreachClaim[]): CriticFailure[] {
  if (draft.generic) return [];
  const failures: CriticFailure[] = [];
  const claim = verifiedClaims.find((candidate) => candidate.id === draft.hook_claim_id);
  if (!claim) {
    failures.push({ rule: 'hook', detail: `hook_claim_id "${draft.hook_claim_id}" is not a verified claim` });
  }
  const anchor = draft.anchor_phrase === null ? '' : normalizeForMatch(draft.anchor_phrase);
  if (anchor === '' || !normalizeForMatch(draft.body).includes(anchor)) {
    failures.push({ rule: 'hook', detail: 'the anchor phrase does not appear verbatim in the body' });
  }
  return failures;
}

function checkAvailability(draft: OutreachDraft, input: CriticInput): CriticFailure[] {
  const lines = input.config.availability[input.language];
  const region = overlapRegion(input.timezone);
  const required = [
    { name: 'hours', line: lines.hours_line },
    { name: 'start date', line: lines.start_line },
    { name: `overlap (${region})`, line: lines.overlap[region] },
  ];
  const body = normalizeForMatch(draft.body);
  return required
    .filter(({ line }) => !body.includes(normalizeForMatch(line)))
    .map(({ name, line }) => ({
      rule: 'availability' as const,
      detail: `the ${name} line is missing from the body: "${line}"`,
    }));
}

// Keyword check rather than verbatim: the writer may rephrase the ask, but the
// summer internship has to be on the table when the config says it is.
const INTERNSHIP_KEYWORDS: Record<OutreachLanguage, readonly string[]> = {
  en: ['internship', 'summer 2027'],
  fr: ['stage', 'été 2027'],
};

function checkInternship(draft: OutreachDraft, input: CriticInput): CriticFailure[] {
  if (!input.config.summer_internship.available) return [];
  const body = normalizeForMatch(draft.body);
  const mentioned = INTERNSHIP_KEYWORDS[input.language].some((keyword) => containsWord(body, keyword));
  return mentioned
    ? []
    : [
        {
          rule: 'internship_mention',
          detail: `the body must mention the summer internship (${INTERNSHIP_KEYWORDS[input.language].join(' / ')})`,
        },
      ];
}

function mentionedEntries(draft: OutreachDraft, masterDb: MasterDB): Array<MasterDB['projects'][number] | MasterDB['experience'][number]> {
  const names = new Set(draft.mentioned_projects.map((name) => name.trim().toLowerCase()));
  return [
    ...masterDb.projects.filter((project) => names.has(project.name.trim().toLowerCase())),
    ...masterDb.experience.filter((job) => names.has(job.company.trim().toLowerCase())),
  ];
}

// Deliberately narrow: only what the email itself is allowed to be based on.
// The whole profile (phone digits, other jobs' metrics) and the claim's
// paraphrase text are not sources, or any plausible number would pass.
function allowedNumbers(draft: OutreachDraft, input: CriticInput): Set<string> {
  const { config, language, verifiedClaims, masterDb, companyName } = input;
  const lines = config.availability[language];
  const hookClaim = verifiedClaims.find((claim) => claim.id === draft.hook_claim_id);
  const entries = mentionedEntries(draft, masterDb);

  return new Set(
    extractNumbers(
      [
        hookClaim?.quote ?? '',
        ...entries.flatMap((entry) => [
          'company' in entry ? entry.company : entry.name,
          ...entry.raw_achievements,
          ...entry.quantifiable_metrics,
        ]),
        String(config.hours_per_week),
        config.start_date,
        lines.hours_line,
        lines.start_line,
        lines.ask_line,
        ...Object.values(lines.overlap),
        config.summer_internship.start ?? '',
        String(config.summer_internship.min_weeks ?? ''),
        // The company name is required in the email, so its digits are too.
        companyName,
      ].join('\n'),
    ),
  );
}

function checkNumbers(draft: OutreachDraft, input: CriticInput): CriticFailure[] {
  const allowed = allowedNumbers(draft, input);
  const failures: CriticFailure[] = [];
  for (const { label, text } of allTexts(draft)) {
    for (const number of new Set(extractNumbers(text))) {
      if (!allowed.has(number)) {
        failures.push({
          rule: 'invented_number',
          detail: `${label} has the number "${number}", found in no cited quote, mentioned entry or config value`,
        });
      }
    }
  }
  return failures;
}

function checkProjects(draft: OutreachDraft, masterDb: MasterDB): CriticFailure[] {
  const failures: CriticFailure[] = [];
  const known = new Set([
    ...masterDb.projects.map((project) => project.name.trim().toLowerCase()),
    ...masterDb.experience.map((job) => job.company.trim().toLowerCase()),
  ]);
  const body = normalizeForMatch(draft.body);

  for (const name of draft.mentioned_projects) {
    if (!known.has(name.trim().toLowerCase())) {
      failures.push({ rule: 'unknown_project', detail: `"${name}" is not a project or employer in data_inventory` });
    } else if (!draft.generic && !containsWord(body, name)) {
      failures.push({ rule: 'proof_point', detail: `"${name}" is listed as mentioned but is not named in the body` });
    }
  }
  if (!draft.generic && draft.mentioned_projects.length === 0) {
    failures.push({ rule: 'proof_point', detail: 'the body needs one proof point from your own projects' });
  }
  return failures;
}

function normalizeLink(link: string): string {
  return link
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[.,;:!?)\]]+$/, '')
    .replace(/\/+$/, '');
}

// Links with a scheme or "www.", a bare domain with a path (acme.io/x), and a
// bare domain on a common TLD. The lookbehind skips the domain part of an
// email address; ".net" is left out of the path-less list because "ASP.NET"
// is far more likely than a link.
const LINK_PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s<>"')\]]+/gi,
  /\bwww\.[^\s<>"')\]]+/gi,
  /(?<![@\p{L}\p{N}._-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\/[^\s<>"')\]]*/giu,
  /(?<![@\p{L}\p{N}._-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|io|dev|ai|fr|org|app|tn|tech|cloud|xyz|eu|uk|de|ch|info)(?![\p{L}\p{N}/-])/giu,
];

function checkLinks(draft: OutreachDraft, masterDb: MasterDB): CriticFailure[] {
  const own = [
    ...masterDb.personal_info.links.map((link) => link.url),
    ...masterDb.projects.flatMap((project) => project.links.map((link) => link.url)),
  ].map(normalizeLink);

  const failures: CriticFailure[] = [];
  for (const { label, text } of allTexts(draft)) {
    const found = LINK_PATTERNS.flatMap((pattern) => text.match(pattern) ?? []);
    for (const link of new Set(found.map(normalizeLink))) {
      // A deeper path under one of your own profile/repo links is still yours.
      const isOwn = own.some((owned) => link === owned || link.startsWith(`${owned}/`));
      if (!isOwn) failures.push({ rule: 'foreign_link', detail: `${label} links to "${link}", which is not one of your links` });
    }
  }
  return failures;
}

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\[[^\]\n]{1,60}\]/,
  /\{\{?[^}\n]{1,60}\}?\}/,
  /<[^>\n]{1,40}>/,
  /lorem ipsum/i,
  /\b(?:TODO|TBD|XXX|FIXME)\b/,
];

const MARKDOWN_PATTERNS: readonly RegExp[] = [
  /\*\*[^*\n]+\*\*/,
  /(^|\s)\*[^*\s][^*\n]*\*(\s|$)/,
  /__[^_\n]+__/,
  /`[^`\n]+`/,
  /^#{1,6}\s/m,
  /^\s*[-*•]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /\[[^\]\n]+\]\([^)\n]+\)/,
];

function checkFormatting(draft: OutreachDraft): CriticFailure[] {
  const failures: CriticFailure[] = [];
  for (const { label, text } of allTexts(draft)) {
    if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) {
      failures.push({ rule: 'placeholder', detail: `${label} contains a placeholder` });
    }
    if (MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))) {
      failures.push({ rule: 'markdown', detail: `${label} contains markdown formatting` });
    }
    if (text.includes('—')) {
      failures.push({ rule: 'em_dash', detail: `${label} contains an em dash` });
    }
  }
  return failures;
}

function companyCoreName(companyName: string): string {
  const tokens = normalizeForMatch(companyName)
    .replace(/[.,]/g, '')
    .split(' ')
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function checkCompanyName(draft: OutreachDraft, companyName: string): CriticFailure[] {
  const core = companyCoreName(companyName);
  return containsWord(`${draft.subject} ${draft.body}`, core)
    ? []
    : [{ rule: 'company_name', detail: `the company name "${companyName}" is not in the subject or body` }];
}

function countStopwords(text: string, language: OutreachLanguage): number {
  const words = normalizeForMatch(text).match(/\p{L}+/gu) ?? [];
  return words.filter((word) => STOPWORDS[language].has(word)).length;
}

function checkLanguage(draft: OutreachDraft, language: OutreachLanguage): CriticFailure[] {
  const other: OutreachLanguage = language === 'en' ? 'fr' : 'en';
  const failures: CriticFailure[] = [];
  // Checked separately: a French follow-up under an English body must not hide behind it.
  for (const { label, text } of [
    { label: 'body', text: draft.body },
    { label: 'follow-up', text: draft.follow_up_body },
  ]) {
    const expectedHits = countStopwords(text, language);
    const otherHits = countStopwords(text, other);
    if (expectedHits < 3 || expectedHits <= otherHits * 2) {
      failures.push({
        rule: 'language',
        detail: `${label} does not read as ${language} (${language} function words: ${expectedHits}, ${other}: ${otherHits})`,
      });
    }
  }
  return failures;
}

/**
 * Runs every SPEC section 5 rule and reports all failures at once, so the
 * writer's retry can fix them together.
 */
export function critiqueDraft(input: CriticInput): CriticResult {
  const { draft, language, companyName, masterDb, verifiedClaims } = input;
  const failures = [
    ...checkSubject(draft, companyName),
    ...checkWordCounts(draft, language),
    ...checkBannedPhrases(draft),
    ...checkCallToAction(draft),
    ...checkHook(draft, verifiedClaims),
    ...checkAvailability(draft, input),
    ...checkInternship(draft, input),
    ...checkNumbers(draft, input),
    ...checkProjects(draft, masterDb),
    ...checkLinks(draft, masterDb),
    ...checkFormatting(draft),
    ...checkCompanyName(draft, companyName),
    ...checkLanguage(draft, language),
  ];
  return { pass: failures.length === 0, failures };
}
