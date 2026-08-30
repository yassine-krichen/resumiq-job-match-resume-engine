import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import type { AISelection, MasterDB } from '@resumiq/ai-bridge';
import type { RenderEngine, RenderResult } from '../render-engine.interface';
import { buildTypstDocument } from './content-builder';
import { TYPST_SKELETON } from './skeleton';

const COMPILE_TIMEOUT_MS = 30_000;

/**
 * Minimal env for the compiler subprocess. typst only needs PATH to resolve
 * its own binary and HOME/USERPROFILE for its font/cache dirs — the app's
 * full process.env (DB credentials, API keys, auth secrets) must never be
 * exposed to a spawned child process.
 */
function compilerEnv(): NodeJS.ProcessEnv {
  const { PATH, Path, HOME, USERPROFILE, TEMP, TMP } = process.env;
  return { PATH, Path, HOME, USERPROFILE, TEMP, TMP };
}

interface ShrinkStep {
  fontSize: number;
  leading: number;
  itemSpacing: number;
  sectionGap: number;
}

/**
 * Auto-shrink ladder: font-size/spacing step down first, before ever touching
 * content. Cheap Typst recompiles (~200-500ms) make a real fit loop viable —
 * something the LaTeX path doesn't attempt (see ROADMAP_v2.md).
 */
const SHRINK_LADDER: ShrinkStep[] = [
  { fontSize: 11, leading: 0.62, itemSpacing: 0.35, sectionGap: 10 },
  { fontSize: 10.5, leading: 0.58, itemSpacing: 0.3, sectionGap: 8 },
  { fontSize: 10, leading: 0.54, itemSpacing: 0.25, sectionGap: 6 },
  { fontSize: 9.5, leading: 0.5, itemSpacing: 0.2, sectionGap: 5 },
];

function applyShrinkStep(template: string, step: ShrinkStep): string {
  return template
    .replace(/%%FONT_SIZE%%/g, String(step.fontSize))
    .replace(/%%LEADING%%/g, String(step.leading))
    .replace(/%%ITEM_SPACING%%/g, String(step.itemSpacing))
    .replace(/%%SECTION_GAP%%/g, String(step.sectionGap));
}

/**
 * Compiles resumes via a locally installed `typst` binary. Unlike LatexRenderer,
 * this engine compiles repeatedly inside render() — stepping down font-size and
 * spacing until the resume fits one page, or the shrink budget is exhausted.
 * pageCount is always the true final page count; it is never misreported.
 */
export class TypstRenderer implements RenderEngine {
  async render(selection: AISelection, db: MasterDB, _templateId: string): Promise<RenderResult> {
    const documentTemplate = buildTypstDocument(selection, db, TYPST_SKELETON);
    const workDir = join(tmpdir(), `resume-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });

    try {
      let result: RenderResult | null = null;

      for (const step of SHRINK_LADDER) {
        const source = applyShrinkStep(documentTemplate, step);
        result = await this.compileOnce(source, workDir);
        if (result.pageCount <= 1) break;
      }

      // SHRINK_LADDER is never empty, so result is always assigned.
      return result!;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async compileOnce(source: string, workDir: string): Promise<RenderResult> {
    const typPath = join(workDir, 'resume.typ');
    const pdfPath = join(workDir, 'resume.pdf');
    await writeFile(typPath, source, 'utf-8');

    await this.compile(typPath, pdfPath, workDir);

    const pdf = await readFile(pdfPath);
    const pageCount = (await PDFDocument.load(pdf)).getPageCount();
    return { pdf, pageCount, source };
  }

  private compile(typPath: string, pdfPath: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('typst', ['compile', typPath, pdfPath], { cwd, env: compilerEnv() });

      let stderr = '';
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, COMPILE_TIMEOUT_MS);

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn typst — is it installed and on PATH? ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new Error(`typst timed out after ${COMPILE_TIMEOUT_MS}ms and was killed`));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`typst exited with code ${code}:\n${stderr.slice(0, 2000)}`));
        }
      });
    });
  }
}
