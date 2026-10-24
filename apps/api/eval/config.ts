import * as path from 'node:path';

/** Everything that defines the experiment lives here so the report can quote it. */
export const EVAL_CONFIG = {
  // Seeded so the posting sample is reproducible from the same DB snapshot.
  sampleSeed: 20261023,
  bootstrapSeed: 20261024,
  bootstrapResamples: 10_000,
  // Resume page budget fed to selectAndDraft (the resume template is one page).
  pages: 1 as const,
  postings: 40,
  repeats: 3,
  concurrency: 4,
  minJdChars: 800,
  // Per-host quotas. The scraped corpus is dominated by one host (stripe.com);
  // uncapped, the sample would be 90% one company's boilerplate.
  quotas: {
    'jobs.ashbyhq.com': 10,
    'remoteok.com': 12,
    'stripe.com': 6,
    'jobs.lever.co': 6,
    'remotive.com': 4,
    'weworkremotely.com': 2,
  } as Record<string, number>,
  // Judge is pinned to a specific model id (generation stays on the "auto"
  // pool) and runs at temperature 0. Override with EVAL_JUDGE_MODEL.
  // gpt-oss-120b was the first choice but its route rejected the judge prompts
  // (HTTP 429 "prompt too large"); gemini-3-flash-preview was
  // then tried but its single route was rate limited (429) and timed out upstream
  // (502 after 60s) too often to finish; gemini-3.5-flash-lite answers in 5-12s.
  judgeModel: process.env.EVAL_JUDGE_MODEL ?? 'gemini-3.5-flash-lite',
  judgeTemperature: 0,
  calibrationClaims: 50,
  calibrationSeed: 20261025,
  // Stop the run (rather than burn retries) after this many consecutive
  // calls that failed with infrastructure errors after backoff.
  circuitBreakerThreshold: 4,
  retryBackoffMs: [5_000, 20_000, 60_000],
};

export const PATHS = {
  evalDir: __dirname,
  fixtures: path.join(__dirname, 'fixtures'),
  out: path.join(__dirname, 'out'),
  inventory:
    process.env.EVAL_INVENTORY_PATH ?? path.resolve(__dirname, '../../../data_inventory.json'),
  reportMd: path.join(
    'C:\\Users\\user\\Documents\\resume\\measurements',
    'A5-resumiq-fabrication-eval.md',
  ),
};
