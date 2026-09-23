// Manual, committed verification script — NOT part of any test suite. Run
// it against the real freellmapi "auto" model to check how many entries of a
// deliberately messy, mixed-type paste survive `OnboardingService#parseCareerText`
// (as a complete entry, an incomplete-but-editable draft, or a full drop).
//
// Run from apps/api:
//   npm run verify:ingest -- [runs]
// (defaults to 5 runs if [runs] is omitted). Loads .env itself, same as
// scan-and-ingest.ts — nothing else does that for a standalone script.
import 'dotenv/config';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';

// Written informally/messily on purpose — mixed casing, no bullet
// formatting, comma-separated tech lists, a GPA as a bare-looking number,
// abbreviated dates — the kind of real paste that broke strict validation
// before the lenient-draft path existed. ~9 distinct career facts: 2 jobs,
// 1 internship, 1 degree, 2 personal projects, 1 cert, 1 award, a skills line.
const SAMPLE_PASTE = `\
software engineer @ Northwind Systems, mar 2022 - present, remote. built out the billing
service in node/typescript, moved it onto postgres, cut p95 latency by like 35%. also mentored
2 junior devs. stack: TypeScript, Node.js, Postgres, Redis, Docker

before that was a Backend Dev Intern at Fabrikam Labs summer 2021, worked on their internal
tooling in Python and helped ship a scraper that pulled ~5k records/day

earlier, Junior Developer at Contoso Retail, jan 2020 to feb 2022, built their internal admin
dashboard using React and Express, nothing too fancy

side project: built "logtrail", a small log-tailing CLI in Rust, 2023, about 80 stars on github,
repo at github.com/example/logtrail

another side project - a Chrome extension called "tabsaver" that snapshots open tabs, built with
plain JS, 2021

got the AWS Solutions Architect Associate cert from Amazon in 2023

BS Computer Science, Contoso State University, 2016-2020, gpa was 3.6, minored in stats

won "Hackathon Winner" at TechCrunch Disrupt 2019 for a real-time collab editor

skills: typescript, python, react, node.js, postgres, redis, docker, aws, git, ci/cd
`;

interface RunSummary {
  complete: number;
  incomplete: number;
  incompleteDetails: Array<{ type: string; missingFields: string[] }>;
  dropped: number;
  droppedDetails: Array<{ type: string; reason: string }>;
}

async function runOnce(service: OnboardingService): Promise<RunSummary> {
  const result = await service.parseCareerText(SAMPLE_PASTE, null);

  const complete = result.entries.filter((e) => e.missingFields.length === 0);
  const incomplete = result.entries.filter((e) => e.missingFields.length > 0);

  return {
    complete: complete.length,
    incomplete: incomplete.length,
    incompleteDetails: incomplete.map((e) => ({ type: e.type, missingFields: e.missingFields })),
    dropped: result.droppedEntries.length,
    droppedDetails: result.droppedEntries.map((d) => ({ type: d.type, reason: d.reason })),
  };
}

async function main() {
  const runs = Number(process.argv[2]) || 5;
  const service = new OnboardingService();

  const summaries: RunSummary[] = [];
  for (let i = 1; i <= runs; i++) {
    console.log(`\n── Run ${i}/${runs} ──`);
    try {
      const summary = await runOnce(service);
      summaries.push(summary);

      console.log(`  complete:   ${summary.complete}`);
      console.log(`  incomplete: ${summary.incomplete}`);
      for (const d of summary.incompleteDetails) {
        console.log(`    - ${d.type}: missing [${d.missingFields.join(', ')}]`);
      }
      console.log(`  dropped:    ${summary.dropped}`);
      for (const d of summary.droppedDetails) {
        console.log(`    - ${d.type}: ${d.reason}`);
      }
    } catch (err) {
      console.log(`  FAILED: ${(err as Error).message}`);
    }
  }

  if (summaries.length === 0) {
    console.log('\nAll runs failed — nothing to aggregate.');
    process.exitCode = 1;
    return;
  }

  const totalComplete = summaries.reduce((sum, s) => sum + s.complete, 0);
  const totalIncomplete = summaries.reduce((sum, s) => sum + s.incomplete, 0);
  const totalDropped = summaries.reduce((sum, s) => sum + s.dropped, 0);
  const totalEntries = totalComplete + totalIncomplete + totalDropped;

  console.log('\n── Aggregate ──');
  console.log(`  runs completed: ${summaries.length}/${runs}`);
  console.log(`  total entries:  ${totalEntries}`);
  console.log(
    `  complete:       ${totalComplete} (${((totalComplete / totalEntries) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  incomplete:     ${totalIncomplete} (${((totalIncomplete / totalEntries) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  dropped:        ${totalDropped} (${((totalDropped / totalEntries) * 100).toFixed(1)}%)`,
  );
}

main().catch((err) => {
  console.error('Verification script failed:', err);
  process.exitCode = 1;
});
