// HTML to plain text, deliberately dependency-free. The output only has to be
// stable and faithful enough that a quote copied from the rendered page is
// found by the quote verifier; it is not a general-purpose HTML parser.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201D',
  ldquo: '\u201C',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  laquo: '\u00AB',
  raquo: '\u00BB',
  eacute: '\u00E9',
  egrave: '\u00E8',
  ecirc: '\u00EA',
  agrave: '\u00E0',
  acirc: '\u00E2',
  ccedil: '\u00E7',
  ocirc: '\u00F4',
  ucirc: '\u00FB',
  icirc: '\u00EE',
  copy: '\u00A9',
};

const BLOCK_TAGS =
  'address|article|aside|blockquote|body|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Invalid or out-of-range code points are left as written rather than throwing.
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      return String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts an HTML document or fragment to readable text: scripts, styles and
 * comments are removed, block elements become line breaks, entities are
 * decoded and whitespace is collapsed.
 */
export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ');

  const withBreaks = withoutNoise.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n');
  const withoutTags = withBreaks.replace(/<[^>]*>/g, '');

  return decodeEntities(withoutTags)
    .replace(/[ \t\f\v\u00A0\u202F]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}
