import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { analyzeJob, selectAndDraft, critiqueAndRevise } from './agents';
import { checkBridge } from './llm';
import { render } from './renderer';
import type { AISelection, MasterDB } from './types';

config({ path: join(__dirname, '..', '.env') });

const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, '..', 'data_inventory.json');

function read(path: string, required = true): string {
  if (!existsSync(path)) {
    if (required) throw new Error(`Required file not found: ${path}`);
    return '';
  }
  return readFileSync(path, 'utf-8').trim();
}

function tryCompile(outputDir: string): boolean {
  const texFile = join(outputDir, 'resume.tex');
  for (const compiler of ['tectonic', 'pdflatex']) {
    try {
      if (compiler === 'tectonic') {
        execSync(`tectonic "${texFile}"`, { cwd: outputDir, stdio: 'pipe' });
      } else {
        execSync(
          `pdflatex -interaction=nonstopmode -output-directory="${outputDir}" "${texFile}"`,
          { cwd: outputDir, stdio: 'pipe' },
        );
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function main(): Promise<void> {
  const renderOnly = process.argv.includes('--render-only');

  mkdirSync(join(ROOT, 'output'), { recursive: true });

  if (!renderOnly) {
    await checkBridge();
    console.log(`✓ Bridge running at ${process.env.BRIDGE_URL ?? 'http://127.0.0.1:3000'}`);
  }

  const db: MasterDB = JSON.parse(read(DB_PATH));
  const skeletonPath = join(ROOT, 'templates', 'skeleton.tex');

  let selection: AISelection;

  if (renderOnly) {
    const jsonPath = join(ROOT, 'output', 'resume.json');
    if (!existsSync(jsonPath)) {
      throw new Error('output/resume.json not found — run npm run generate first');
    }
    selection = JSON.parse(read(jsonPath)) as AISelection;
    console.log('Render-only: loaded selection from output/resume.json');
  } else {
    const jd = read(join(ROOT, 'input', 'job.txt'));
    if (jd.startsWith('Paste the job description here')) {
      throw new Error('Replace the placeholder in input/job.txt with the actual job description');
    }

    const companyInfo = read(join(ROOT, 'input', 'company.txt'), false);
    const hasCompany =
      companyInfo && !companyInfo.startsWith('Optional: paste company information');

    console.log('Agent 1: Analyzing job description...');
    const jobDNA = await analyzeJob(jd, hasCompany ? companyInfo : '');
    console.log(`✓ Job: ${jobDNA.job_title} (${jobDNA.seniority})`);
    console.log(`  ATS keywords: ${jobDNA.ats_keywords.join(', ')}`);

    console.log('\nAgent 2: Selecting content and drafting bullets...');
    const draft = await selectAndDraft(jobDNA, db);
    console.log(
      `✓ Draft: ${draft.experience.length} experience(s), ${draft.projects.length} project(s)`,
    );
    console.log(`  Sections: ${draft.section_order.join(' → ')}`);

    console.log('\nCritique pass: Auditing bullet quality...');
    selection = await critiqueAndRevise(draft, jobDNA, db);
    console.log('✓ Self-critique complete');

    const jsonPath = join(ROOT, 'output', 'resume.json');
    writeFileSync(jsonPath, JSON.stringify(selection, null, 2));
    console.log('\n✓ Saved: output/resume.json');
    console.log('  Review it. Edit bullets if needed. Then the .tex is generated below.');
    console.log('  To re-render after edits: npm run render\n');
  }

  console.log('Rendering LaTeX...');
  const tex = render(selection, db, skeletonPath);
  const texPath = join(ROOT, 'output', 'resume.tex');
  writeFileSync(texPath, tex);
  console.log('✓ Saved: output/resume.tex');

  console.log('Compiling PDF...');
  const compiled = tryCompile(join(ROOT, 'output'));
  if (compiled) {
    console.log('✓ Compiled: output/resume.pdf');
  } else {
    console.log('\n  LaTeX compiler not found locally.');
    console.log('  Options:');
    console.log('    • Install tectonic: https://tectonic-typesetting.github.io');
    console.log('    • Install pdflatex via MiKTeX or TeX Live');
    console.log('    • Upload output/resume.tex to overleaf.com/project');
  }
}

main().catch((err: Error) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
