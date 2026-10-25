import { IndexedEntry } from './entries';
import { Section } from './sections';

export const SNIPPET_MAX_CHARS = 240;
const SOURCES_MAX = 5;
const SOURCE_MAX_CHARS = 200;

export interface SearchHit {
  section: Section;
  id: string;
  title: string;
  snippet: string;
  score: number;
  sources: string[];
}

export interface SearchOptions {
  sections?: readonly Section[];
  limit: number;
}

// Title outranks the skill lists, which outrank free prose.
const FIELD_WEIGHTS: Record<string, number> = {
  title: 10,
  technologies_used: 5,
  core_competencies: 5,
  related_skills: 5,
  skills_validated: 5,
  tagline: 3,
  issuer: 3,
  relevant_coursework: 3,
  raw_achievements: 2,
  honors: 2,
};
const DEFAULT_PROSE_WEIGHT = 1;
const PHRASE_BONUS = 0.5;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'of', 'in', 'on', 'for', 'to', 'with', 'using', 'use', 'is', 'are',
  'as', 'at', 'by', 'we', 'you', 'our', 'your', 'experience', 'strong', 'knowledge', 'ability',
]);

function weightOf(field: string): number {
  return FIELD_WEIGHTS[field] ?? DEFAULT_PROSE_WEIGHT;
}

function stem(token: string): string {
  // Tokens carrying symbols (c++, node.js, c#) are identifiers, not words.
  if (!/^[a-z]+$/.test(token)) return token;
  for (const suffix of ['ing', 'ed', 'es', 's', 'e']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) return token.slice(0, -suffix.length);
  }
  return token;
}

/** Lowercase, split on anything but [a-z0-9+#.], stem, drop stopwords. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
}

interface PreparedItem {
  text: string;
  tokens: string[];
}

interface PreparedField {
  name: string;
  weight: number;
  items: PreparedItem[];
}

function prepare(entry: IndexedEntry): PreparedField[] {
  return entry.fields.map((f) => ({
    name: f.name,
    weight: weightOf(f.name),
    items: f.items.map((text) => ({ text, tokens: tokenize(text) })),
  }));
}

function containsSequence(tokens: string[], pair: [string, string]): boolean {
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (tokens[i] === pair[0] && tokens[i + 1] === pair[1]) return true;
  }
  return false;
}

function capText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Window of `text` around the first matching token, hard-capped at SNIPPET_MAX_CHARS. */
function windowAround(text: string, matchedWords: string[]): string {
  if (text.length <= SNIPPET_MAX_CHARS) return text;
  const lower = text.toLowerCase();
  let first = -1;
  for (const word of matchedWords) {
    const at = lower.indexOf(word);
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  const start = Math.max(0, first - 60);
  const body = text.slice(start, start + SNIPPET_MAX_CHARS - 2);
  return capText(`${start > 0 ? '…' : ''}${body}`, SNIPPET_MAX_CHARS);
}

function pickSnippet(fields: PreparedField[], queryTokens: Set<string>, entry: IndexedEntry): string {
  let best: { text: string; matches: number; weight: number; words: string[] } | undefined;
  for (const field of fields) {
    if (field.name === 'title') continue;
    for (const item of field.items) {
      const matched = new Set(item.tokens.filter((t) => queryTokens.has(t)));
      if (matched.size === 0) continue;
      if (!best || matched.size > best.matches || (matched.size === best.matches && field.weight > best.weight)) {
        best = { text: item.text, matches: matched.size, weight: field.weight, words: [...matched] };
      }
    }
  }
  if (best) return windowAround(best.text, best.words);
  // Title-only match: show the most descriptive line instead of repeating the title.
  const lead = fields.find((f) => f.name !== 'title' && f.items.length > 0)?.items[0]?.text;
  return capText(lead ?? entry.title, SNIPPET_MAX_CHARS);
}

function boundedSources(sources: string[]): string[] {
  return sources.slice(0, SOURCES_MAX).map((s) => capText(s, SOURCE_MAX_CHARS));
}

/**
 * Deterministic weighted token ranking. Per query token: IDF (rarer terms count
 * more) x field weight x mild term-frequency saturation, plus a bonus when
 * adjacent query tokens appear adjacent in an item ("spring boot"). Ties break
 * by section order then index, so output order never depends on hash order.
 */
export function searchEntries(index: readonly IndexedEntry[], query: string, options: SearchOptions): SearchHit[] {
  const orderedQuery = tokenize(query);
  const queryTokens = [...new Set(orderedQuery)];
  if (queryTokens.length === 0) return [];
  const queryTokenSet = new Set(queryTokens);
  const allowed = options.sections && options.sections.length > 0 ? new Set(options.sections) : undefined;

  const prepared = index.map((entry) => ({ entry, fields: prepare(entry) }));

  const docFreq = new Map<string, number>();
  for (const { fields } of prepared) {
    const seen = new Set<string>();
    for (const field of fields) for (const item of field.items) for (const t of item.tokens) seen.add(t);
    for (const t of queryTokens) if (seen.has(t)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const idf = (token: string): number => Math.log(1 + prepared.length / (1 + (docFreq.get(token) ?? 0)));

  // Adjacent pairs in query order (stopwords already removed).
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < orderedQuery.length; i += 1) pairs.push([orderedQuery[i], orderedQuery[i + 1]]);

  const scored: { hit: SearchHit; order: number }[] = [];
  prepared.forEach(({ entry, fields }, order) => {
    if (allowed && !allowed.has(entry.section)) return;
    let score = 0;
    for (const token of queryTokens) {
      let tokenScore = 0;
      for (const field of fields) {
        let tf = 0;
        for (const item of field.items) for (const t of item.tokens) if (t === token) tf += 1;
        if (tf > 0) tokenScore += field.weight * (0.5 + Math.min(tf, 3) / 6);
      }
      score += tokenScore * idf(token);
    }
    for (const pair of pairs) {
      const field = fields.find((f) => f.items.some((item) => containsSequence(item.tokens, pair)));
      if (field) score += field.weight * PHRASE_BONUS * idf(pair[0]);
    }
    if (score <= 0) return;
    scored.push({
      order,
      hit: {
        section: entry.section,
        id: entry.id,
        title: entry.title,
        snippet: pickSnippet(fields, queryTokenSet, entry),
        score: Math.round(score * 1000) / 1000,
        sources: boundedSources(entry.sources),
      },
    });
  });

  scored.sort((a, b) => b.hit.score - a.hit.score || a.order - b.order);
  return scored.slice(0, options.limit).map((s) => s.hit);
}
