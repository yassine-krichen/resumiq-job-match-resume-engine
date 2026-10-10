import { PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { PDFDocument, PDFStream } from 'pdf-lib';

// Best-effort size of a resume's overflow, so the writer's retry can be told how much to cut instead of just
// "2 pages". The resume is compiled by tectonic, whose content streams place every text run with
// `<dx> <dy> Td` inside a frame whose origin is the top-left of the text area (`1 0 0 1 72 720 cm`), so
// the most negative dy on a page is its deepest line. Nothing here is exact; it only has to be the right size.

/** Baseline pitch of the resume skeleton (10pt text): one more line is added below the deepest baseline. */
const LINE_HEIGHT_POINTS = 11.96;
const TEXT_MOVE = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Td/g;

/** Depth in points of the text on one page's decoded content stream, or null when it has no positioned text. */
export function spillDepthPoints(content: string): number | null {
  let deepest: number | null = null;
  for (const match of content.matchAll(TEXT_MOVE)) {
    const dy = Number(match[2]);
    if (deepest === null || dy < deepest) deepest = dy;
  }
  if (deepest === null) return null;
  return Math.max(0, -deepest) + LINE_HEIGHT_POINTS;
}

function decode(stream: PDFStream): string {
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString('latin1');
}

function pageContent(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (contents === undefined) return '';
  if (contents instanceof PDFArray) {
    return Array.from({ length: contents.size() }, (_, index) => decode(contents.lookup(index) as PDFStream)).join('\n');
  }
  return decode(contents);
}

/**
 * Total depth in points of the text that sits on every page after the first (0 for a one-page document).
 * Returns undefined when a stream cannot be read: callers fall back to a generic instruction.
 */
export async function measureOverflowPoints(doc: PDFDocument): Promise<number | undefined> {
  try {
    let total = 0;
    for (let index = 1; index < doc.getPageCount(); index += 1) {
      total += spillDepthPoints(pageContent(doc, index)) ?? 0;
    }
    return total;
  } catch {
    return undefined;
  }
}

