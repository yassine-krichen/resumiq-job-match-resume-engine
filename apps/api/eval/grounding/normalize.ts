/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Spelling variants the COMPAT prompt also treats as equivalent.
const TECH_ALIASES: Record<string, string> = {
  postgres: 'postgresql',
  k8s: 'kubernetes',
  nodejs: 'node',
  reactjs: 'react',
  nextjs: 'next',
  vuejs: 'vue',
  expressjs: 'express',
  nestjs: 'nest',
  golang: 'go',
  ts: 'typescript',
  js: 'javascript',
  mongo: 'mongodb',
  tailwind: 'tailwindcss',
  amazonwebservices: 'aws',
  googlecloudplatform: 'gcp',
  googlecloud: 'gcp',
};

/** Canonical comparison key for a technology / skill name. */
export function techKey(name: string): string {
  const stripped = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\.js\b/g, '')
    .replace(/\s+v?\d+(\.\d+)*\s*$/, '')
    .replace(/[^a-z0-9+#]/g, '');
  return TECH_ALIASES[stripped] ?? stripped;
}

/** True when one normalized phrase equals the other or contains it as whole words. */
export function phraseMatches(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < 4) return false;
  return ` ${longer} `.includes(` ${shorter} `);
}
