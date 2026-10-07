import type { OutreachAvailabilityLines, OutreachLanguage, OutreachTrack } from '../schemas/outreach';

import { resolveLanguage } from './locale';
import type { OverlapRegion } from './locale';
import { countWords } from './text-utils';

// Fallback email (SPEC section 6): no verified hook, so it names the company,
// optionally its public one-liner, one project of the candidate's and the
// config's availability lines. Templates are fixed text per language: the
// output is deterministic and goes through the same critic as a written email.

export interface GenericEmailInput {
  language: OutreachLanguage;
  companyName: string;
  /** Researcher's one-line description of the company; used only when short. */
  oneLiner?: string;
  /** Name of the person addressed, when known. */
  contactName?: string;
  availability: OutreachAvailabilityLines;
  region: OverlapRegion;
  track: OutreachTrack;
  project: { name: string; technologies: readonly string[] };
}

export interface GenericEmail {
  subject: string;
  body: string;
  follow_up_body: string;
  cta: string;
}

const MAX_ONE_LINER_WORDS = 20;
const MAX_SUBJECT_LENGTH = 60;
const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'm', 'mme', 'mlle', 'madame', 'monsieur']);

const FOCUS: Record<OutreachLanguage, Record<OutreachTrack, string>> = {
  en: {
    ai: 'applied AI and machine learning',
    swe: 'backend and systems engineering',
    fullstack: 'full-stack web development',
  },
  fr: {
    ai: "l'IA appliquée et l'apprentissage automatique",
    swe: 'le développement backend et les systèmes',
    fullstack: 'le développement web full-stack',
  },
};

const CTA: Record<OutreachLanguage, string> = {
  en: 'Would you be open to a short call this week?',
  fr: 'Auriez-vous le temps pour un court appel cette semaine ?',
};

/** First name to greet, or null when the value does not look like a person's name. */
export function greetingName(contactName: string | undefined): string | null {
  if (!contactName) return null;
  const tokens = contactName
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0 || tokens.length > 3) return null;
  if (!tokens.every((token) => /^[\p{L}'-]+$/u.test(token))) return null;
  const first = tokens.find((token) => !TITLES.has(token.toLowerCase()));
  return first && first.length >= 2 ? first : null;
}

// Two-letter country-code TLDs only; ".com" says nothing. "uk" is GB.
export function countryFromDomain(domain: string | null): string | null {
  if (domain === null) return null;
  const tld = domain.slice(domain.lastIndexOf('.') + 1).toLowerCase();
  if (!/^[a-z]{2}$/.test(tld)) return null;
  return tld === 'uk' ? 'GB' : tld.toUpperCase();
}

/** Email language when research did not run: from the country-code TLD, English otherwise. */
export function languageFromDomain(domain: string | null): OutreachLanguage {
  const country = countryFromDomain(domain);
  return country === null ? 'en' : resolveLanguage({ country });
}

// A technology with a bare number ("Python 3") would trip the critic's invented-number rule.
function presentableTechnologies(technologies: readonly string[]): string[] {
  return technologies.filter((tech) => !/(^|\s)\d+(\.\d+)*(\s|$)/.test(tech)).slice(0, 3);
}

function joinList(items: readonly string[], language: OutreachLanguage): string {
  if (items.length <= 1) return items.join('');
  const and = language === 'fr' ? 'et' : 'and';
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

function subjectFor(language: OutreachLanguage, companyName: string): string {
  const specific = language === 'fr' ? `Aide en développement pour ${companyName}` : `Engineering help for ${companyName}`;
  if (specific.length <= MAX_SUBJECT_LENGTH) return specific;
  return language === 'fr' ? 'Aide en développement à temps partiel' : 'Part-time engineering help';
}

function buildBody(input: GenericEmailInput, includeOneLiner: boolean): string {
  const { language, companyName, availability, region, track, project } = input;
  const name = greetingName(input.contactName);
  const oneLiner = includeOneLiner && input.oneLiner ? ` (${input.oneLiner.trim().replace(/[.\s]+$/, '')})` : '';
  const tech = joinList(presentableTechnologies(project.technologies), language);
  const lines = availability;

  if (language === 'fr') {
    const withTech = tech ? ` avec ${tech}` : '';
    return [
      `${name ? `Bonjour ${name},` : 'Bonjour,'} j'ai découvert ${companyName}${oneLiner} et je souhaitais me présenter.`,
      `Je poursuis des études en génie logiciel, avec un intérêt marqué pour ${FOCUS.fr[track]} ; j'ai récemment réalisé ${project.name}${withTech}.`,
      `${lines.hours_line}, ${lines.start_line}.`,
      `${lines.ask_line}.`,
      `${lines.overlap[region]}.`,
      CTA.fr,
    ].join(' ');
  }
  const withTech = tech ? ` with ${tech}` : '';
  return [
    `${name ? `Hi ${name},` : 'Hello,'} I came across ${companyName}${oneLiner} and wanted to introduce myself.`,
    `I am a software engineering student focused on ${FOCUS.en[track]}; most recently I built ${project.name}${withTech}.`,
    `${lines.hours_line}, ${lines.start_line}.`,
    `${lines.ask_line}.`,
    `${lines.overlap[region]}.`,
    CTA.en,
  ].join(' ');
}

function buildFollowUp(input: GenericEmailInput): string {
  const name = greetingName(input.contactName);
  if (input.language === 'fr') {
    return (
      `${name ? `Bonjour ${name},` : 'Bonjour,'} je complète mon message précédent : je peux vous présenter ${input.project.name} ` +
      "lors d'un court appel si cela vous est utile. Je m'adapte volontiers à votre agenda. Merci de votre lecture."
    );
  }
  return (
    `${name ? `Hi ${name},` : 'Hello,'} I wanted to add one detail to my earlier message: I am happy to walk you through ` +
    `${input.project.name} on a short call if that is useful. I am flexible on timing and can work around your calendar. ` +
    'Thanks for reading.'
  );
}

/**
 * Builds the generic email. The one-liner is included only when short;
 * callers that find the critic rejecting it call again with `oneLiner` unset.
 */
export function buildGenericEmail(input: GenericEmailInput): GenericEmail {
  const useOneLiner = input.oneLiner !== undefined && countWords(input.oneLiner) <= MAX_ONE_LINER_WORDS;
  return {
    subject: subjectFor(input.language, input.companyName),
    body: buildBody(input, useOneLiner),
    follow_up_body: buildFollowUp(input),
    cta: CTA[input.language],
  };
}
