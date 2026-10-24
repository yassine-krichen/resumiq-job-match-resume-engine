// Freezes the evaluation inputs (idempotent and resumable).
//
// 1. Samples postings from the app's own ingested Job rows (stratified by host,
//    seeded) and writes fixtures/postings.json (third-party JD text: gitignored)
//    plus fixtures/manifest.json (ids, URLs, sha256, sampling parameters: committable).
// 2. Runs analyzeJob once per posting and checkCompatibility once per posting
//    (the latter only to label poor-fit postings; it does not gate drafting).
//
// Usage (from apps/api):
//   npx ts-node --transpile-only eval/build-fixtures.ts [--limit N]
// --limit N only builds the LLM-derived fixtures for the first N postings (smoke runs).
import 'dotenv/config';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { analyzeJob, checkCompatibility } from '@resumiq/ai-bridge';
import type { CompatibilityResult, JobDNA } from '@resumiq/ai-bridge';
import { PrismaClient } from '@prisma/client';

import { StepCache, stepKey } from './cache';
import { EVAL_CONFIG, PATHS } from './config';
import type { Posting } from './eval.types';
import { loadInventory } from './inventory';
import { installCapture } from './llm-capture';
import { CircuitBreaker, FatalEvalError } from './retry';
import { seededShuffle } from './rng';
import { mapLimit, runStep } from './step-runner';

const POSTINGS_FILE = path.join(PATHS.fixtures, 'postings.json');
const MANIFEST_FILE = path.join(PATHS.fixtures, 'manifest.json');
const STEPS_FILE = path.join(PATHS.fixtures, 'derived-steps.jsonl');

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

async function samplePostings(): Promise<Posting[]> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.job.findMany({
      where: { source: 'scraper' },
      select: { id: true, sourceUrl: true, title: true, companyName: true, rawJd: true },
      orderBy: { id: 'asc' },
    });
    const byHost = new Map<string, Posting[]>();
    for (const r of rows) {
      if (r.rawJd.length < EVAL_CONFIG.minJdChars || !r.sourceUrl) continue;
      let host: string;
      try {
        host = new URL(r.sourceUrl).hostname;
      } catch {
        continue;
      }
      if (!(host in EVAL_CONFIG.quotas)) continue;
      const list = byHost.get(host) ?? [];
      list.push({
        id: r.id,
        host,
        sourceUrl: r.sourceUrl,
        title: r.title,
        companyName: r.companyName,
        rawJd: r.rawJd,
        sha256: sha256(r.rawJd),
      });
      byHost.set(host, list);
    }

    const picked = new Map<string, Posting[]>();
    for (const [host, quota] of Object.entries(EVAL_CONFIG.quotas)) {
      picked.set(host, seededShuffle(byHost.get(host) ?? [], EVAL_CONFIG.sampleSeed).slice(0, quota));
    }
    // Round-robin across hosts so any prefix of the list (smoke runs) spans providers.
    const ordered: Posting[] = [];
    for (let i = 0; ordered.length < EVAL_CONFIG.postings; i++) {
      let added = false;
      for (const list of picked.values()) {
        if (i < list.length && ordered.length < EVAL_CONFIG.postings) {
          ordered.push(list[i]);
          added = true;
        }
      }
      if (!added) break;
    }
    return ordered;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  fs.mkdirSync(PATHS.fixtures, { recursive: true });

  let postings: Posting[];
  if (fs.existsSync(POSTINGS_FILE)) {
    postings = JSON.parse(fs.readFileSync(POSTINGS_FILE, 'utf8')) as Posting[];
    console.error(`postings.json exists (${postings.length}); not resampling`);
  } else {
    postings = await samplePostings();
    fs.writeFileSync(POSTINGS_FILE, JSON.stringify(postings, null, 2));
    console.error(`sampled ${postings.length} postings`);
  }

  const inventory = loadInventory();
  const counts: Record<string, number> = {};
  for (const p of postings) counts[p.host] = (counts[p.host] ?? 0) + 1;
  fs.writeFileSync(
    MANIFEST_FILE,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        sampling: {
          query: "Job where source='scraper' and length(rawJd) >= minJdChars and host in quotas",
          seed: EVAL_CONFIG.sampleSeed,
          minJdChars: EVAL_CONFIG.minJdChars,
          quotas: EVAL_CONFIG.quotas,
          perHostCounts: counts,
        },
        inventory: {
          rawSha256: inventory.rawSha256,
          sentToLlmSha256: inventory.redactedSha256,
          normalizations: inventory.normalizations,
        },
        postings: postings.map((p) => ({
          id: p.id,
          host: p.host,
          sourceUrl: p.sourceUrl,
          sha256: p.sha256,
          chars: p.rawJd.length,
        })),
      },
      null,
      2,
    ),
  );

  if (!process.env.FREELLMAPI_API_KEY) throw new Error('FREELLMAPI_API_KEY is not set');
  installCapture();
  const cache = new StepCache(STEPS_FILE);
  const breaker = new CircuitBreaker();
  const subset = postings.slice(0, Number.isFinite(limit) ? limit : postings.length);

  await mapLimit(subset, EVAL_CONFIG.concurrency, async (p) => {
    const dna = await runStep<JobDNA>({
      postingId: p.id,
      repeat: 0,
      stage: 'jobdna',
      cache,
      breaker,
      fn: () => analyzeJob(p.rawJd, `${p.companyName} is hiring.`),
    });
    console.error(`jobdna ${p.id} ${dna.status}`);
    if (dna.status !== 'ok') return;
    const compat = await runStep<CompatibilityResult>({
      postingId: p.id,
      repeat: 0,
      stage: 'compat',
      cache,
      breaker,
      fn: () => checkCompatibility(dna.result as JobDNA, inventory.db),
    });
    console.error(`compat ${p.id} ${compat.status}`);
  });

  const ok = subset.filter((p) => cache.get(stepKey(p.id, 0, 'jobdna'))?.status === 'ok').length;
  console.error(`jobdna ok for ${ok}/${subset.length}`);
}

main().catch((err) => {
  console.error(err instanceof FatalEvalError ? `STOPPED: ${err.message}` : err);
  process.exit(1);
});
