import { config } from "dotenv";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { createInterface } from "readline/promises";
import { join } from "path";
import { execSync } from "child_process";
import {
  analyzeJob,
  checkCompatibility,
  selectAndDraft,
  critiqueAndRevise,
} from "./agents";
import { checkBridge } from "./llm";
import { render } from "./renderer";
import type { AISelection, JobDNA, MasterDB } from "./types";

config({ path: join(__dirname, "..", ".env") });

const ROOT = join(__dirname, "..");
const DB_PATH = join(ROOT, "..", "data_inventory.json");

function read(path: string, required = true): string {
  if (!existsSync(path)) {
    if (required) throw new Error(`Required file not found: ${path}`);
    return "";
  }
  return readFileSync(path, "utf-8").trim();
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function tryCompile(outputDir: string): boolean {
  const texFile = join(outputDir, "resume.tex");
  // Pass parent env so PATH-installed binaries (tectonic, pdflatex) are found.
  const env = { ...process.env };

  for (const compiler of ["tectonic", "pdflatex"]) {
    try {
      if (compiler === "tectonic") {
        execSync(`tectonic "${texFile}"`, { cwd: outputDir, stdio: "pipe", env });
      } else {
        execSync(
          `pdflatex -interaction=nonstopmode -output-directory="${outputDir}" "${texFile}"`,
          { cwd: outputDir, stdio: "pipe", env },
        );
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

function saveVersioned(outputDir: string, slug: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  const vDir = join(outputDir, "versions", `${date}_${time}_${slug}`);
  mkdirSync(vDir, { recursive: true });

  for (const file of ["resume.json", "resume.tex", "resume.pdf"]) {
    const src = join(outputDir, file);
    if (existsSync(src)) copyFileSync(src, join(vDir, file));
  }
  return vDir;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const renderOnly = args.includes("--render-only");
  const verbose = args.includes("--verbose");
  const noCritique = args.includes("--no-critique");
  const pagesIdx = args.indexOf("--pages");
  const pagesVal =
    pagesIdx >= 0
      ? args[pagesIdx + 1]
      : args.find((a) => a.startsWith("--pages="))?.split("=")[1];
  const pages: 1 | 2 = pagesVal === "1" ? 1 : 2;

  const outputDir = join(ROOT, "output");
  mkdirSync(outputDir, { recursive: true });

  if (!renderOnly) {
    try {
      await checkBridge();
      console.log(
        `✓ Bridge running at ${process.env.BRIDGE_URL ?? "http://127.0.0.1:3000"}`,
      );
    } catch {
      console.log("  Bridge not reachable — falling back to Groq/Ollama");
    }
  }

  const db: MasterDB = JSON.parse(read(DB_PATH));
  const skeletonPath = join(ROOT, "templates", "skeleton.tex");

  let selection: AISelection;
  let jobSlug = "resume";

  if (renderOnly) {
    const jsonPath = join(outputDir, "resume.json");
    if (!existsSync(jsonPath)) {
      throw new Error(
        "output/resume.json not found — run npm run generate first",
      );
    }
    selection = JSON.parse(read(jsonPath)) as AISelection;
    console.log("Render-only: loaded selection from output/resume.json");
  } else {
    const jd = read(join(ROOT, "input", "job.txt"));
    if (jd.startsWith("Paste the job description here")) {
      throw new Error(
        "Replace the placeholder in input/job.txt with the actual job description",
      );
    }

    const companyInfo = read(join(ROOT, "input", "company.txt"), false);
    const hasCompany =
      companyInfo &&
      !companyInfo.startsWith("Optional: paste company information");

    console.log("Agent 1: Analyzing job description...");
    const jobDNA: JobDNA = await analyzeJob(jd, hasCompany ? companyInfo : "");
    console.log(`✓ Job: ${jobDNA.job_title} (${jobDNA.seniority})`);
    if (verbose)
      console.log(`  ATS keywords: ${jobDNA.ats_keywords.join(", ")}`);
    jobSlug = slugify(jobDNA.job_title);

    console.log("\nCompatibility check...");
    const compat = await checkCompatibility(jobDNA, db);
    const compatBar =
      "█".repeat(Math.round(compat.score / 10)) +
      "░".repeat(10 - Math.round(compat.score / 10));
    console.log(`  Score: ${compat.score}/100 [${compatBar}]`);

    compat.warnings.forEach((w) => console.log(`  ⚠  ${w}`));

    if (!compat.compatible) {
      console.log("\n✗ Incompatible — mandatory skills with no DB coverage:");
      compat.blockers.forEach((b) => console.log(`    ✗ ${b}`));
      console.log("\nSuggested DB additions:");
      compat.suggestions.forEach((s) => console.log(`    → ${s}`));
      console.log("\nAdd these to data_inventory.json and re-run.");
      process.exit(1);
    }

    if (verbose && compat.suggestions.length) {
      console.log("  DB improvements:");
      compat.suggestions.forEach((s) => console.log(`    → ${s}`));
    }

    if (pages === 1) console.log("  Mode: 1-page");

    console.log("\nAgent 2: Selecting content and drafting bullets...");
    const draft = await selectAndDraft(jobDNA, db, pages);
    console.log(
      `✓ Draft: ${draft.experience.length} role(s), ${draft.projects.length} project(s)`,
    );
    if (verbose) console.log(`  Sections: ${draft.section_order.join(" → ")}`);

    if (noCritique) {
      selection = draft;
      console.log("  (critique skipped — --no-critique)");
    } else {
      console.log("\nCritique pass: Auditing bullet quality...");
      selection = await critiqueAndRevise(draft, jobDNA, db);
      console.log("✓ Self-critique complete");

      if (selection.match_score !== undefined) {
        const scoreBar =
          "█".repeat(Math.round(selection.match_score / 10)) +
          "░".repeat(10 - Math.round(selection.match_score / 10));
        console.log(
          `  Final match score: ${selection.match_score}/100 [${scoreBar}]`,
        );
        if (verbose && selection.match_reasoning)
          console.log(`  ${selection.match_reasoning}`);
      }
    }

    const jsonPath = join(outputDir, "resume.json");
    writeFileSync(jsonPath, JSON.stringify(selection, null, 2));
    console.log("\n✓ Saved: output/resume.json");

    if (process.stdin.isTTY) {
      const edit = await askYesNo("  Edit bullets before rendering? [y/N] ");
      if (edit) {
        const editorCmd =
          process.env.EDITOR ??
          (process.platform === "win32" ? "notepad" : "vi");
        try {
          execSync(`"${editorCmd}" "${jsonPath}"`, { stdio: "inherit" });
        } catch {
          console.log(
            `  Editor failed. Edit ${jsonPath} manually, then run: npm run render`,
          );
          process.exit(0);
        }
        selection = JSON.parse(read(jsonPath)) as AISelection;
      }
    }
  }

  console.log("\nRendering LaTeX...");
  const tex = render(selection, db, skeletonPath);
  const texPath = join(outputDir, "resume.tex");
  writeFileSync(texPath, tex);
  console.log("✓ Saved: output/resume.tex");

  console.log("Compiling PDF...");
  const compiled = tryCompile(outputDir);
  if (compiled) {
    console.log("✓ Compiled: output/resume.pdf");
  } else {
    console.log("\n  LaTeX compiler not found locally.");
    console.log(
      "    • Install tectonic: https://tectonic-typesetting.github.io",
    );
    console.log("    • Install pdflatex via MiKTeX or TeX Live");
    console.log("    • Upload output/resume.tex to overleaf.com/project");
  }

  if (!renderOnly) {
    const vDir = saveVersioned(outputDir, jobSlug);
    if (verbose)
      console.log(
        `\n✓ Versioned: output/versions/${vDir.split(/[\\/]/).pop()}`,
      );
  }
}

main().catch((err: Error) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
