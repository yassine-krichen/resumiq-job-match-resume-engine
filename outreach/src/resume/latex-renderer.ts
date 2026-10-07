import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { render as buildLatexDocument } from './renderer';
import { LATEX_SKELETON } from './skeleton';
import type { AISelection, MasterDB } from './types';

const COMPILE_TIMEOUT_MS = 30_000;

export interface RenderResult {
  pdf: Buffer;
  pageCount: number;
  /** The exact .tex source that produced `pdf`, kept so a PDF is reproducible. */
  source: string;
}

/**
 * Minimal env for the compiler subprocess. tectonic only needs PATH to
 * resolve its own binary/dependencies and HOME/USERPROFILE for its cache
 * dir — the app's full process.env (DB credentials, API keys) must never be
 * exposed to a spawned child process.
 */
function compilerEnv(): NodeJS.ProcessEnv {
  const { PATH, Path, HOME, USERPROFILE, TEMP, TMP } = process.env;
  return { PATH, Path, HOME, USERPROFILE, TEMP, TMP };
}

/**
 * Compiles resumes via a locally installed `tectonic` binary. Each render
 * gets its own temp directory under os.tmpdir() to avoid collisions between
 * concurrent renders.
 *
 * @param tectonicPath Path to the tectonic binary; the bare name `tectonic`
 * is resolved through PATH (on Windows it usually lives in C:\Tools\Tectonic).
 */
export class LatexRenderer {
  constructor(private readonly tectonicPath: string = 'tectonic') {}

  async render(selection: AISelection, db: MasterDB): Promise<RenderResult> {
    const tex = buildLatexDocument(selection, db, LATEX_SKELETON);
    const workDir = join(tmpdir(), `outreach-resume-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });

    try {
      const texPath = join(workDir, 'resume.tex');
      await writeFile(texPath, tex, 'utf-8');

      await this.compile(texPath, workDir);

      const pdf = await readFile(join(workDir, 'resume.pdf'));
      const pageCount = (await PDFDocument.load(pdf)).getPageCount();

      return { pdf, pageCount, source: tex };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private compile(texPath: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.tectonicPath, [texPath], { cwd, env: compilerEnv() });

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
        reject(
          new Error(
            `Failed to spawn tectonic ("${this.tectonicPath}") - is it installed? Set TECTONIC_PATH or add it to PATH. ${err.message}`,
          ),
        );
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new Error(`tectonic timed out after ${COMPILE_TIMEOUT_MS}ms and was killed`));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tectonic exited with code ${code}:\n${stderr.slice(0, 2000)}`));
        }
      });
    });
  }
}
