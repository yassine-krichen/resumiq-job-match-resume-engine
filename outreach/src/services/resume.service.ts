import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildSelection } from '../core/build-selection';
import { buildTrackTailoring } from '../core/track-selection';
import type { AppConfig } from '../config/app-config';
import { TRACKS } from '../config/app-config';
import type { OutreachPaths } from '../config/paths';
import type { RenderResult } from '../resume/latex-renderer';
import type { MasterDB } from '../resume/master-db';
import type { AISelection } from '../resume/types';
import type { OutreachTailoring, OutreachTrack } from '../schemas/outreach';

import { relativeToRoot, trackResumePath } from './run-layout';

/** A resume attached to a cold email must stay small and fit one page (SPEC section 4). */
export const MAX_RESUME_BYTES = 80 * 1024;

export interface ResumeRenderer {
  render(selection: AISelection, db: MasterDB): Promise<RenderResult>;
}

export class ResumeRenderError extends Error {}

/** A bullet takes about two lines of the skeleton's 11.96pt pitch. */
const POINTS_PER_BULLET = 24;
const POINTS_PER_LINE = 11.96;

/** How many bullets to cut to get the spill back onto page one; two when the overflow could not be measured. */
export function bulletsToRemove(overflowPoints: number | undefined): number {
  return overflowPoints === undefined ? 2 : Math.max(1, Math.ceil(overflowPoints / POINTS_PER_BULLET));
}

/** The resume rendered fine but ran onto more than one page: the writer can fix that by cutting content. */
export class ResumeTooLongError extends ResumeRenderError {
  /** What to tell the writer in critic.json. */
  readonly advice: string;

  constructor(
    readonly pageCount: number,
    readonly overflowPoints: number | undefined,
  ) {
    super(`resume is ${pageCount} pages, expected 1`);
    const bullets = bulletsToRemove(overflowPoints);
    const spill =
      overflowPoints === undefined ? '' : ` about ${Math.max(1, Math.round(overflowPoints / POINTS_PER_LINE))} lines spill onto page 2;`;
    this.advice =
      `resume is ${pageCount} pages:${spill} remove at least ${bullets} bullets or one whole entry, ` +
      'and keep every bullet to one line';
  }
}

/** Renders a tailoring and checks it is sendable: exactly one page and under 80 KB. */
export async function renderTailoring(
  tailoring: OutreachTailoring,
  db: MasterDB,
  renderer: ResumeRenderer,
): Promise<RenderResult> {
  let result: RenderResult;
  try {
    result = await renderer.render(buildSelection(tailoring, db), db);
  } catch (error) {
    throw new ResumeRenderError(`render failed: ${(error as Error).message}`);
  }
  if (result.pageCount > 1) throw new ResumeTooLongError(result.pageCount, result.overflowPoints);
  if (result.pageCount !== 1) throw new ResumeRenderError(`resume is ${result.pageCount} pages, expected 1`);
  if (result.pdf.length >= MAX_RESUME_BYTES) {
    throw new ResumeRenderError(`resume is ${result.pdf.length} bytes, expected under ${MAX_RESUME_BYTES}`);
  }
  return result;
}

export async function writeResumeFiles(pdfPath: string, result: RenderResult): Promise<void> {
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, result.pdf);
  await writeFile(pdfPath.replace(/\.pdf$/, '.tex'), result.source, 'utf-8');
}

export interface TrackResumeReport {
  track: OutreachTrack;
  pdfPath: string;
  bytes: number;
  entries: string[];
}

/** Builds the three fallback resumes into storage/tracks/. Throws on the first track that cannot be built. */
export async function buildTrackResumes(
  db: MasterDB,
  config: AppConfig,
  paths: OutreachPaths,
  renderer: ResumeRenderer,
): Promise<TrackResumeReport[]> {
  const reports: TrackResumeReport[] = [];
  for (const track of TRACKS) {
    let result: RenderResult;
    let tailoring: OutreachTailoring;
    try {
      tailoring = buildTrackTailoring(db, config.tracks[track]);
      result = await renderTailoring(tailoring, db, renderer);
    } catch (error) {
      throw new Error(`Track "${track}": ${(error as Error).message}`);
    }
    const pdfPath = trackResumePath(paths, track);
    await writeResumeFiles(pdfPath, result);
    await writeFile(join(dirname(pdfPath), `${track}.tailoring.json`), `${JSON.stringify(tailoring, null, 2)}\n`, 'utf-8');
    reports.push({
      track,
      pdfPath: relativeToRoot(paths, pdfPath),
      bytes: result.pdf.length,
      entries: tailoring.entries.map((entry) => entry.name),
    });
  }
  return reports;
}
