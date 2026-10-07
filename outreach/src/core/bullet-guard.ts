import type { MasterDB } from '../resume/master-db';
import type { OutreachTailoredEntry, OutreachTailoring } from '../schemas/outreach';

import { escapeRegExp, extractNumbers } from './text-utils';

type ExperienceEntry = MasterDB['experience'][number];
type ProjectEntry = MasterDB['projects'][number];
export type SourceEntry = ExperienceEntry | ProjectEntry;

export type BulletViolationRule =
  | 'unknown_source_entry'
  | 'source_entry_mismatch'
  | 'invented_number'
  | 'technology_not_in_source'
  | 'foreign_technology'
  | 'skill_not_in_profile';

export interface BulletViolation {
  rule: BulletViolationRule;
  /** Where it happened, e.g. 'project "Foo" bullet 2', 'summary' or 'skills.databases'. */
  where: string;
  detail: string;
}

export interface BulletGuardResult {
  pass: boolean;
  violations: BulletViolation[];
}

export interface GuardOptions {
  /** Technology names that belong to the company (the dossier's tech_stack); naming one in the resume is a failure unless the profile really has it. */
  foreignTerms?: readonly string[];
}

/** Case-insensitive, trimmed exact match: the same lookup build-selection uses. */
export function findSourceEntry(
  db: MasterDB,
  kind: OutreachTailoredEntry['kind'],
  name: string,
): SourceEntry | undefined {
  const wanted = name.trim().toLowerCase();
  if (kind === 'experience') {
    return db.experience.find((entry) => entry.company.trim().toLowerCase() === wanted);
  }
  return db.projects.find((entry) => entry.name.trim().toLowerCase() === wanted);
}

function entryName(entry: SourceEntry): string {
  return 'company' in entry ? entry.company : entry.name;
}

// ── Technology matching ─────────────────────────────────────────────────────

// Abbreviations the user may write or the writer may use, mapped to one key.
const ALIAS_TO_KEY: Record<string, string> = {
  postgres: 'postgresql',
  js: 'javascript',
  ts: 'typescript',
  k8s: 'kubernetes',
  mongo: 'mongodb',
};

// Every spelling a technology may appear under in a bullet, by canonical key.
const SPELLINGS_BY_KEY: Record<string, readonly string[]> = {
  postgresql: ['Postgres', 'PostgreSQL'],
  javascript: ['JS', 'JavaScript'],
  typescript: ['TS', 'TypeScript'],
  node: ['Node', 'Node.js', 'NodeJS'],
  kubernetes: ['K8s', 'Kubernetes'],
  mongodb: ['Mongo', 'MongoDB'],
};

/** "Node.js", "NodeJS" and "node" are one technology; so are "Postgres" and "PostgreSQL". */
function canonicalTech(tech: string): string {
  const squashed = tech
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._\-/]/g, '');
  const withoutJs = squashed.length > 3 && squashed.endsWith('js') ? squashed.slice(0, -2) : squashed;
  return ALIAS_TO_KEY[withoutJs] ?? withoutJs;
}

// Names that are also ordinary English words are matched case-sensitively, or
// every "react" and "next" in a bullet would count as a technology.
const COMMON_WORD_TECHNOLOGIES = new Set([
  'react',
  'express',
  'next',
  'spark',
  'swift',
  'ruby',
  'rust',
  'make',
  'shell',
  'flow',
  'solid',
  'rails',
  'dart',
  'go',
  'bun',
  'helm',
  'node',
]);

// Common technologies a company is likely to run. A resume naming one the
// profile never lists is claiming a skill the user does not have, usually by
// copying the company's stack. Not exhaustive: the dossier's tech_stack covers
// the company-specific rest.
const BUILT_IN_TECHNOLOGIES: readonly string[] = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin', 'Swift', 'Rust', 'Golang', 'Ruby', 'PHP',
  'Scala', 'Elixir', 'Haskell', 'Clojure', 'Dart', 'C++', 'C#',
  'React', 'Angular', 'Vue', 'Svelte', 'Next.js', 'Nuxt', 'NestJS', 'Django', 'Flask', 'FastAPI',
  'Rails', 'Laravel', 'Symfony', 'Spring Boot', 'ASP.NET', '.NET', 'Node.js', 'Deno', 'Redux',
  'GraphQL', 'gRPC', 'tRPC', 'Tailwind CSS',
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Kubernetes', 'Docker', 'Terraform', 'Ansible', 'Jenkins',
  'GitHub Actions', 'GitLab CI', 'Nginx', 'Prometheus', 'Grafana', 'Linux', 'Vercel', 'Heroku',
  'Cloudflare',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Elasticsearch', 'Cassandra', 'DynamoDB',
  'Snowflake', 'BigQuery', 'Kafka', 'RabbitMQ', 'Spark', 'Hadoop', 'Airflow', 'Neo4j', 'Supabase',
  'Firebase',
  'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'LangChain',
];

function isCaseSensitiveSpelling(spelling: string): boolean {
  return spelling.replace(/[^\p{L}\p{N}]/gu, '').length <= 2 || COMMON_WORD_TECHNOLOGIES.has(canonicalTech(spelling));
}

function compilePattern(spellings: readonly string[], caseSensitive: boolean): RegExp {
  const source = spellings.map(escapeRegExp).join('|');
  // "+" and "#" after the name mean a different technology ("C" vs "C++", "C#").
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}+#])`, caseSensitive ? 'gu' : 'giu');
}

interface TechMatcher {
  key: string;
  /** Not part of the user's profile: any mention is a failure. */
  foreign: boolean;
  pattern: RegExp;
}

/** One or two matchers per technology: ordinary-word and short spellings are matched case-sensitively, the rest not. */
function buildMatchers(tech: string, foreign: boolean): TechMatcher[] {
  const key = canonicalTech(tech);
  const spellings = new Set([tech, ...(SPELLINGS_BY_KEY[key] ?? [])]);
  const withoutJs = tech.replace(/[.\s-]?js$/i, '');
  if (withoutJs.length > 2 && withoutJs !== tech) spellings.add(withoutJs);

  const sensitive = [...spellings].filter(isCaseSensitiveSpelling);
  const insensitive = [...spellings].filter((spelling) => !isCaseSensitiveSpelling(spelling));
  return [
    ...(sensitive.length > 0 ? [{ key, foreign, pattern: compilePattern(sensitive, true) }] : []),
    ...(insensitive.length > 0 ? [{ key, foreign, pattern: compilePattern(insensitive, false) }] : []),
  ];
}

function userSkillList(db: MasterDB): string[] {
  const { programming_languages, frameworks_and_libraries, infrastructure_and_tools, databases } = db.skills;
  return [...programming_languages, ...frameworks_and_libraries, ...infrastructure_and_tools, ...databases];
}

/** Every technology the profile knows about: the skills lists plus every entry's technologies_used. */
function profileVocabulary(db: MasterDB): string[] {
  const used = [...db.experience, ...db.projects].flatMap((entry) => entry.technologies_used);
  return [...new Set([...userSkillList(db), ...used].map((tech) => tech.trim()).filter(Boolean))];
}

function buildAllMatchers(db: MasterDB, options: GuardOptions): TechMatcher[] {
  const profile = profileVocabulary(db).flatMap((tech) => buildMatchers(tech, false));
  const known = new Set(profile.map((matcher) => matcher.key));
  const foreign = [...BUILT_IN_TECHNOLOGIES, ...(options.foreignTerms ?? [])]
    .map((tech) => tech.trim())
    .filter(Boolean)
    .flatMap((tech) => buildMatchers(tech, true))
    .filter((matcher) => !known.has(matcher.key));
  return [...profile, ...foreign];
}

interface TextAnalysis {
  /** Numbers in the text, minus the digits that are part of a technology name the profile lists ("Angular 17"). */
  numbers: string[];
  mentions: Map<string, { shown: string; foreign: boolean }>;
}

// A number after a name is a claim ("PostgreSQL 60%", "Kafka 3 million events"),
// not a version, so digits are only treated as part of the name when the text
// does not read as a quantity.
const QUANTITY_AFTER = /^\s*(?:%|\u00D7|percent\b|x\b|[kmb]\b|thousand|million|billion|users?|rows?|records?|requests?|events?|ms\b|seconds?|minutes?|hours?|days?|[kmgt]b\b)/i;

/**
 * Finds the technologies named in the text (a name inside a longer one, like
 * "Spring" in "Spring Boot", is not counted) and the numbers that are not part
 * of a listed technology's name. "Angular 17" is exempt only when the profile
 * lists exactly "Angular 17"; with a profile "Angular", the 17 is a number to
 * justify like any other.
 */
function analyzeText(text: string, matchers: readonly TechMatcher[]): TextAnalysis {
  const hits: Array<{ matcher: TechMatcher; start: number; end: number; text: string }> = [];
  for (const matcher of matchers) {
    for (const match of text.matchAll(matcher.pattern)) {
      const start = match.index ?? 0;
      hits.push({ matcher, start, end: start + match[0].length, text: match[0] });
    }
  }
  const outermost = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit &&
          other.start <= hit.start &&
          other.end >= hit.end &&
          other.end - other.start > hit.end - hit.start,
      ),
  );

  let withoutNames = text;
  for (const hit of outermost) {
    if (/\d/.test(hit.text) && !QUANTITY_AFTER.test(text.slice(hit.end))) {
      withoutNames = withoutNames.slice(0, hit.start) + ' '.repeat(hit.text.length) + withoutNames.slice(hit.end);
    }
  }

  return {
    numbers: extractNumbers(withoutNames),
    mentions: new Map(outermost.map((hit) => [hit.matcher.key, { shown: hit.text, foreign: hit.matcher.foreign }])),
  };
}

// ── Guards ──────────────────────────────────────────────────────────────────

// Only achievements and metrics: a technology name that happens to contain a
// number ("Angular 17") must not whitelist that number as a result.
function factNumbers(entries: readonly SourceEntry[]): Set<string> {
  return new Set(extractNumbers(entries.flatMap((entry) => [...entry.raw_achievements, ...entry.quantifiable_metrics]).join('\n')));
}

function checkText(
  text: string,
  where: string,
  context: { allowedNumbers: Set<string>; allowedTech: Set<string>; label: string; matchers: readonly TechMatcher[] },
): BulletViolation[] {
  const violations: BulletViolation[] = [];
  const analysis = analyzeText(text, context.matchers);

  for (const number of new Set(analysis.numbers)) {
    if (!context.allowedNumbers.has(number)) {
      violations.push({
        rule: 'invented_number',
        where,
        detail: `"${number}" is not in the achievements or metrics of ${context.label}`,
      });
    }
  }
  for (const [key, { shown, foreign }] of analysis.mentions) {
    if (foreign) {
      violations.push({
        rule: 'foreign_technology',
        where,
        detail: `"${shown}" is not one of your technologies; do not copy a company's stack into your resume`,
      });
    } else if (!context.allowedTech.has(key)) {
      violations.push({
        rule: 'technology_not_in_source',
        where,
        detail: `"${shown}" is not in technologies_used of ${context.label}`,
      });
    }
  }
  return violations;
}

/**
 * Checks a tailored resume against the profile it must be derived from.
 *
 * - Each bullet cites a real entry, uses no number absent from that entry's
 *   achievements/metrics (technology versions like "Angular 17" are ignored),
 *   and names no technology absent from that entry's technologies_used.
 * - The summary is held to the union of the selected entries (numbers) and of
 *   the selected entries plus the shown skills (technologies).
 * - Any common technology, or one listed in `options.foreignTerms`, that the
 *   profile never lists is a failure wherever it appears.
 * - The shown skills are a subset of the user's skills.
 *
 * Limit: a technology that is in neither the profile, the built-in list nor
 * `foreignTerms` cannot be recognised.
 */
export function guardTailoring(tailoring: OutreachTailoring, db: MasterDB, options: GuardOptions = {}): BulletGuardResult {
  const violations: BulletViolation[] = [];
  const matchers = buildAllMatchers(db, options);
  const selected: SourceEntry[] = [];

  for (const entry of tailoring.entries) {
    const source = findSourceEntry(db, entry.kind, entry.name);
    if (!source) {
      violations.push({
        rule: 'unknown_source_entry',
        where: `${entry.kind} "${entry.name}"`,
        detail: `no ${entry.kind} named "${entry.name}" in data_inventory`,
      });
      continue;
    }
    selected.push(source);
    const name = entryName(source);
    const context = {
      allowedNumbers: factNumbers([source]),
      allowedTech: new Set(source.technologies_used.map(canonicalTech)),
      label: `"${name}"`,
      matchers,
    };

    entry.bullets.forEach((bullet, index) => {
      const where = `${entry.kind} "${name}" bullet ${index + 1}`;

      if (bullet.source_entry.trim().toLowerCase() !== name.trim().toLowerCase()) {
        violations.push({
          rule: 'source_entry_mismatch',
          where,
          detail: `bullet cites "${bullet.source_entry}" but sits under "${name}"`,
        });
        return;
      }
      violations.push(...checkText(bullet.text, where, context));
    });
  }

  const shownSkills = Object.values(tailoring.skills).flat();
  violations.push(
    ...checkText(tailoring.summary, 'summary', {
      allowedNumbers: factNumbers(selected),
      allowedTech: new Set([...selected.flatMap((entry) => entry.technologies_used), ...shownSkills].map(canonicalTech)),
      label: 'the selected entries',
      matchers,
    }),
  );

  const knownSkills = new Set(userSkillList(db).map(canonicalTech));
  for (const [category, skills] of Object.entries(tailoring.skills)) {
    for (const skill of skills) {
      if (!knownSkills.has(canonicalTech(skill))) {
        violations.push({
          rule: 'skill_not_in_profile',
          where: `skills.${category}`,
          detail: `"${skill}" is not one of your skills`,
        });
      }
    }
  }

  return { pass: violations.length === 0, violations };
}
