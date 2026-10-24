// Computes every number from the cached run and writes the report.
// Pure read of fixtures + out/<run>/records.jsonl (+ owner labels if present); makes no LLM calls.
//
//   npx ts-node --transpile-only eval/report.ts --run full
//   (smoke runs write out/smoke/report.md; the full run also writes the A5 measurement file)
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  clustersOf,
  isComplete,
  loadEval,
  mcnemarCounts,
  METRICS,
  ratio,
  sumArm,
} from './analysis';
import type { ArmResult, LoadedEval, PostingCluster, ScoredClaim, Unit } from './analysis';
import { computeCalibration, LABELS_CSV } from './calibration';
import type { CalibrationResult } from './calibration';
import { EVAL_CONFIG, PATHS } from './config';
import { isNarrative } from './grounding/extract-claims';
import type { FabricationType } from './grounding/ground';
import { clusterBootstrap, mcnemarExact } from './stats';
import type { Interval } from './stats';

const pct = (x: number, digits = 1): string => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : 'n/a');
const pp = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pp` : 'n/a');
const num = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : 'n/a');
const ci = (i: Interval, f: (x: number) => string = pct): string => `${f(i.estimate)} [${f(i.lo)}, ${f(i.hi)}]`;

function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

interface MetricRow {
  name: string;
  a: Interval;
  b: Interval;
  diff: Interval;
  tallyA: { fab: number; tot: number };
  tallyB: { fab: number; tot: number };
}

function metricRow(clusters: PostingCluster[], name: keyof typeof METRICS): MetricRow {
  const metric = METRICS[name];
  const stat = (arm: 'a' | 'b') => (sample: readonly PostingCluster[]): number =>
    ratio(sumArm(sample, metric, arm));
  const diffStat = (sample: readonly PostingCluster[]): number => stat('a')(sample) - stat('b')(sample);
  const n = EVAL_CONFIG.bootstrapResamples;
  const seed = EVAL_CONFIG.bootstrapSeed;
  return {
    name,
    a: clusterBootstrap(clusters, stat('a'), n, seed),
    b: clusterBootstrap(clusters, stat('b'), n, seed),
    diff: clusterBootstrap(clusters, diffStat, n, seed),
    tallyA: sumArm(clusters, metric, 'a'),
    tallyB: sumArm(clusters, metric, 'b'),
  };
}

const excludesZero = (i: Interval): boolean => Number.isFinite(i.lo) && (i.lo > 0 || i.hi < 0);

function modelCounts(records: LoadedEval['records'], stage: string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const r of records.filter((x) => x.stage === stage && x.status === 'ok')) {
    const m = [...r.calls].reverse().find((c) => c.httpStatus === 200 && c.model)?.model ?? 'unrecorded';
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1]);
}

function typeBreakdown(units: Unit[]): string[][] {
  const types: FabricationType[] = ['number', 'tech', 'entry', 'title', 'skill', 'judge'];
  const count = (arm: 'a' | 'b', t: FabricationType): number =>
    units.reduce((s, u) => s + u[arm].claims.filter((c) => c.types.has(t)).length, 0);
  return types.map((t) => [t, String(count('a', t)), String(count('b', t))]);
}

function groupTable(
  clusters: PostingCluster[],
  keyOf: (c: PostingCluster) => string,
): string[][] {
  const keys = [...new Set(clusters.map(keyOf))].sort();
  return keys.map((k) => {
    const sub = clusters.filter((c) => keyOf(c) === k);
    const a = sumArm(sub, METRICS.claim_headline, 'a');
    const b = sumArm(sub, METRICS.claim_headline, 'b');
    const fmt = (t: { fab: number; tot: number }): string => `${t.fab}/${t.tot} (${pct(ratio(t))})`;
    return [k, String(sub.length), String(sub.reduce((s, c) => s + c.units.length, 0)), fmt(a), fmt(b)];
  });
}

function statusCounts(units: Unit[], pick: (u: Unit) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of units) out[pick(u)] = (out[pick(u)] ?? 0) + 1;
  return out;
}

function flaggedExamples(units: Unit[], arm: 'a' | 'b', limit: number): string[] {
  const out: string[] = [];
  for (const u of units.filter(isComplete)) {
    for (const c of u[arm].claims.filter((x) => x.combined && isNarrative(x.claim))) {
      if (out.length >= limit) return out;
      const why = [
        ...c.grounding.flags.map((f) => `${f.type}: ${f.detail}`),
        ...(c.judgeUnsupported ? [`judge: ${c.judge?.issue || 'unsupported'}`] : []),
      ].join('; ');
      out.push(`- [${u.posting.host} r${u.repeat}] "${c.claim.text.slice(0, 160)}" (${why})`);
    }
  }
  return out;
}

function critiqueEffects(units: Unit[]): { removedOrChanged: number; retained: number; introduced: number } {
  const norm = (s: string): string => s.trim().toLowerCase();
  let removedOrChanged = 0;
  let retained = 0;
  let introduced = 0;
  for (const u of units.filter(isComplete)) {
    const aTexts = new Set(u.a.claims.filter((c) => isNarrative(c.claim)).map((c) => norm(c.claim.text)));
    const bTexts = new Set(u.b.claims.filter((c) => isNarrative(c.claim)).map((c) => norm(c.claim.text)));
    for (const c of u.a.claims.filter((x) => x.combined && isNarrative(x.claim))) {
      if (bTexts.has(norm(c.claim.text))) retained++;
      else removedOrChanged++;
    }
    for (const c of u.b.claims.filter((x) => x.combined && isNarrative(x.claim))) {
      if (!aTexts.has(norm(c.claim.text))) introduced++;
    }
  }
  return { removedOrChanged, retained, introduced };
}

function judgeVsDet(units: Unit[]): { both: number; detOnly: number; judgeOnly: number; neither: number; partial: number } {
  const out = { both: 0, detOnly: 0, judgeOnly: 0, neither: 0, partial: 0 };
  for (const u of units.filter(isComplete)) {
    for (const arm of [u.a, u.b]) {
      for (const c of arm.claims.filter((x) => isNarrative(x.claim) && x.judge)) {
        if (c.judgePartial) out.partial++;
        if (c.detStrict && c.judgeUnsupported) out.both++;
        else if (c.detStrict) out.detOnly++;
        else if (c.judgeUnsupported) out.judgeOnly++;
        else out.neither++;
      }
    }
  }
  return out;
}

export interface ReportOutput {
  markdown: string;
  json: Record<string, unknown>;
}

export function buildReport(runName: string): ReportOutput {
  const loaded = loadEval(runName);
  const { units, records, derivedRecords } = loaded;
  const complete = units.filter(isComplete);
  const clusters = clustersOf(units);
  const calibration: CalibrationResult | null = computeCalibration(loaded);

  const rows: Record<string, MetricRow> = {};
  for (const name of Object.keys(METRICS)) rows[name] = metricRow(clusters, name);
  const judgedUnits = complete.filter((u) => u.a.judgeStatus === 'ok' && u.b.judgeStatus === 'ok');
  const judgeIncomplete = judgedUnits.length < complete.length;
  // With partial judge coverage the OR rule would mix definitions (judge+det on some
  // pairs, det only on others), so the headline is restricted to pairs judged in both arms.
  const headlineClusters = judgeIncomplete ? clustersOf(judgedUnits) : clusters;
  const h = judgeIncomplete ? metricRow(headlineClusters, 'claim_headline') : rows.claim_headline;
  const rl = judgeIncomplete ? metricRow(headlineClusters, 'resume_any_combined') : rows.resume_any_combined;
  if (judgeIncomplete) {
    for (const name of ['claim_judge_unsupported', 'claim_judge_partial', 'claim_all_kinds_combined', 'fabricated_per_resume'] as const) {
      rows[name] = metricRow(headlineClusters, name);
    }
  }
  const fullPlan = loaded.usablePostings.length * EVAL_CONFIG.repeats;
  const partial = complete.length < fullPlan || judgeIncomplete;

  const mc = mcnemarCounts(judgeIncomplete ? judgedUnits : units, (a: ArmResult) => a.claims.some((c) => c.combined));
  const mcDet = mcnemarCounts(units, (a: ArmResult) => a.claims.some((c) => c.detStrict));
  const pMc = mcnemarExact(mc.aOnly, mc.bOnly);
  const pMcDet = mcnemarExact(mcDet.aOnly, mcDet.bOnly);

  const planned = fullPlan;
  const draftStatus = statusCounts(units, (u) => u.a.status);
  const critStatus = statusCounts(units, (u) => u.b.status);
  const judgeAStatus = statusCounts(units.filter((u) => u.a.status === 'ok'), (u) => u.a.judgeStatus);
  const judgeBStatus = statusCounts(units.filter((u) => u.b.status === 'ok'), (u) => u.b.judgeStatus);
  const noJudge = complete.filter((u) => u.a.judgeStatus !== 'ok' || u.b.judgeStatus !== 'ok').length;

  const allCalls = [...records, ...derivedRecords].flatMap((r) => r.calls);
  const httpStatus: Record<string, number> = {};
  for (const c of allCalls) httpStatus[String(c.httpStatus)] = (httpStatus[String(c.httpStatus)] ?? 0) + 1;
  const rotated = complete.filter((u) => u.a.model && u.b.model && u.a.model !== u.b.model).length;
  const effects = critiqueEffects(units);
  const jd = judgeVsDet(units);
  const fitCounts = statusCounts(complete, (u) => u.fit);

  const stricter = rows.claim_det_strict;
  const looser = rows.claim_det_loose;
  const ju = rows.claim_judge_unsupported;
  const lines: string[] = [];
  const push = (...s: string[]): void => void lines.push(...s);

  push(
    '# A5. Resumiq fabrication evaluation: critique pass off vs on',
    '',
    `Generated ${new Date().toISOString()} from run \`${runName}\`. Re-run: see the last section.`,
    '',
    ...(partial
      ? [
          `> **PARTIAL RESULT.** The run stopped before completing. Planned: ${fullPlan} resume pairs (${loaded.usablePostings.length} postings x ${EVAL_CONFIG.repeats} repeats). Complete pairs (both arms valid): ${complete.length}. Pairs with an LLM-judge verdict in both arms: ${judgedUnits.length}. Why it stopped: the final judge (${EVAL_CONFIG.judgeModel}) hit its freellmapi daily quota (HTTP 429, soonest reset about 11 hours) and then returned intermittent 404 "not in the catalog" errors, so the circuit breaker tripped during repeat 2 (generation itself was healthy; 4 critique calls failed schema validation and are counted in Failures). Switching to a third judge would have mixed judges, so the run was stopped; resume later with the same command and the same judge to finish repeats 2 and 3 and re-judge the gaps. The headline below is restricted to the ${judgedUnits.length} judged pairs; the deterministic-only rows use all ${complete.length} complete pairs. Postings covered by repeat 1: ${new Set(complete.filter((u) => u.repeat === 1).map((u) => u.posting.id)).size}; repeat 2 or 3 pairs: ${complete.filter((u) => u.repeat > 1).length}. Intervals are wide and the sample is smaller than the pre-registered design.`,
          '',
        ]
      : []),
    '## Headline',
    '',
    `Unit: narrative claims (experience and project bullets plus the summary) checked against the owner's real career inventory. A claim counts as fabricated if the deterministic checker flags it (strict: every figure and technology must belong to the claim's own inventory entry) OR the LLM judge calls it unsupported.`,
    '',
    table(
      ['Metric', 'Arm A: draft only', 'Arm B: draft + critique', 'A minus B (95% CI)'],
      [
        [
          '**Claim-level fabrication rate (headline)**',
          `${ci(h.a)} (${h.tallyA.fab}/${h.tallyA.tot})`,
          `${ci(h.b)} (${h.tallyB.fab}/${h.tallyB.tot})`,
          `${pp(h.diff.estimate)} [${pp(h.diff.lo)}, ${pp(h.diff.hi)}]`,
        ],
        [
          'Resume-level: share of resumes with at least one fabricated claim (any claim type)',
          `${ci(rl.a)} (${rl.tallyA.fab}/${rl.tallyA.tot})`,
          `${ci(rl.b)} (${rl.tallyB.fab}/${rl.tallyB.tot})`,
          `${pp(rl.diff.estimate)} [${pp(rl.diff.lo)}, ${pp(rl.diff.hi)}]`,
        ],
      ],
    ),
    '',
    `Sample: ${new Set(headlineClusters.map((c) => c.postingId)).size} postings, ${headlineClusters.reduce((n, c) => n + c.units.length, 0)} resume pairs in the headline (both arms valid${judgeIncomplete ? ' and both judged' : ''}; ${complete.length} complete pairs overall), ${h.tallyA.tot} narrative claims in arm A and ${h.tallyB.tot} in arm B. Intervals are percentile bootstrap, ${EVAL_CONFIG.bootstrapResamples} resamples of postings (a posting's repeats stay together), seed ${EVAL_CONFIG.bootstrapSeed}.`,
    '',
    `Exact McNemar on resume-level pairs (headline rule): A flagged and B clean = ${mc.aOnly}, A clean and B flagged = ${mc.bOnly}, both flagged = ${mc.bothFab}, neither = ${mc.neither}; p = ${num(pMc, 4)}. Deterministic-only version: ${mcDet.aOnly} vs ${mcDet.bOnly} discordant, p = ${num(pMcDet, 4)}. Repeats of one posting are not independent, so this p-value is anti-conservative; the clustered bootstrap interval above is the better guide.`,
    '',
    `**Calibration status: ${calibration ? `owner-labeled subset present (${calibration.labeled} claims), see Calibration below` : 'LLM JUDGE NOT YET CALIBRATED. The owner has not labeled the 50-claim sheet, so the judge-based part of the headline is unvalidated.'}**`,
    '',
    '## Other claim-level definitions',
    '',
    judgeIncomplete
      ? `Deterministic and listing rows use all ${complete.length} complete pairs; judge-dependent rows (judge unsupported, judge partial, all kinds combined) use the ${judgedUnits.length} judged pairs.`
      : 'Same pairs as the headline.',
    '',
    table(
      ['Definition', 'Arm A', 'Arm B', 'A minus B (95% CI)'],
      [
        ['Deterministic strict only (figure/tech must be in the claim\'s own entry)', rows.claim_det_strict],
        ['Deterministic loose only (figure/tech may come from anywhere in the inventory)', rows.claim_det_loose],
        ['LLM judge "unsupported" only', rows.claim_judge_unsupported],
        ['LLM judge "partial" (reported separately, not counted as fabricated)', rows.claim_judge_partial],
        ['All claim kinds combined (adds employer, role, skill, certification, award items)', rows.claim_all_kinds_combined],
        ['Listing claims only (employer/project names, skills, certs, awards)', rows.listing_claims_combined],
      ].map(([label, row]) => {
        const r = row as MetricRow;
        return [
          label as string,
          `${pct(r.a.estimate)} [${pct(r.a.lo)}, ${pct(r.a.hi)}] (${r.tallyA.fab}/${r.tallyA.tot})`,
          `${pct(r.b.estimate)} [${pct(r.b.lo)}, ${pct(r.b.hi)}] (${r.tallyB.fab}/${r.tallyB.tot})`,
          `${pp(r.diff.estimate)} [${pp(r.diff.lo)}, ${pp(r.diff.hi)}]`,
        ];
      }),
    ),
    '',
    `Strict vs loose: strict flags ${stricter.tallyA.fab}/${stricter.tallyB.fab} (A/B) vs loose ${looser.tallyA.fab}/${looser.tallyB.fab}; the gap is figures or technologies that exist elsewhere in the inventory but were attributed to the wrong entry.`,
    '',
    '## Does the critique delete claims instead of fixing them?',
    '',
    table(
      ['Quantity', 'Arm A', 'Arm B'],
      [
        ['Mean claims per resume (all kinds)', ci(rows.claims_per_resume.a, (x) => num(x)), ci(rows.claims_per_resume.b, (x) => num(x))],
        ['Mean narrative claims per resume', ci(rows.narrative_claims_per_resume.a, (x) => num(x)), ci(rows.narrative_claims_per_resume.b, (x) => num(x))],
        ['Mean flagged claims per resume (any kind)', ci(rows.fabricated_per_resume.a, (x) => num(x)), ci(rows.fabricated_per_resume.b, (x) => num(x))],
      ],
    ),
    '',
    `Of the ${effects.retained + effects.removedOrChanged} narrative claims flagged in arm A, ${effects.retained} appear verbatim in arm B (not fixed) and ${effects.removedOrChanged} are absent or reworded in arm B. Arm B contains ${effects.introduced} flagged narrative claims whose text is not in the same resume's arm A (new or rewritten by the critique).`,
    '',
    '## Per-category breakdown',
    '',
    'Claims containing at least one flag of each type (a claim can carry several), complete pairs only:',
    '',
    table(['Type', 'Arm A', 'Arm B'], typeBreakdown(complete)),
    '',
    'Types: number = figure not attributable to the entry; tech = technology not attributed to the entry (or not in the inventory at all); entry = employer or project absent from the inventory (its bullets are counted too); title = role mismatch or certification/award absent; skill = skills-section item absent; judge = flagged by the LLM judge only.',
    '',
    'By source host (headline claim-level, fabricated/total):',
    '',
    table(['Host', 'Postings', 'Pairs', 'Arm A', 'Arm B'], groupTable(clusters, (c) => c.host)),
    '',
    `By fit (from one checkCompatibility call per posting; it did not gate drafting; unknown = that call failed): compatible ${fitCounts.compatible ?? 0}, incompatible ${fitCounts.incompatible ?? 0}, unknown ${fitCounts.unknown ?? 0} pairs.`,
    '',
    table(['Fit', 'Postings', 'Pairs', 'Arm A', 'Arm B'], groupTable(clusters, (c) => c.fit)),
    '',
    '## Judge versus deterministic checker (narrative claims with a judge verdict)',
    '',
    table(
      ['Both flag', 'Deterministic only', 'Judge only', 'Neither', 'Judge "partial"'],
      [[String(jd.both), String(jd.detOnly), String(jd.judgeOnly), String(jd.neither), String(jd.partial)]],
    ),
    '',
    `Judge-only flags are qualitative (scope, ownership, outcome, or an identity not in the evidence). Judge coverage: ${complete.length - noJudge}/${complete.length} complete pairs have a judge verdict for both arms; claims without a verdict are scored on the deterministic check alone.`,
    '',
    '## Failures (counted as outcomes, not dropped)',
    '',
    `Planned resume pairs: ${planned}. Executed (draft attempted): ${units.length}. Complete pairs used above: ${complete.length}.`,
    '',
    table(
      ['Step', 'ok', 'schema_failure', 'infra_error', 'skipped / not run'],
      [
        ['Arm A draft (selectAndDraft)', ...(['ok', 'schema_failure', 'infra_error', 'not_run'].map((k) => String(draftStatus[k] ?? 0)))],
        ['Arm B critique (critiqueAndRevise)', ...(['ok', 'schema_failure', 'infra_error', 'not_run'].map((k) => String(critStatus[k] ?? 0)))],
        ['Judge on arm A', ...(['ok', 'schema_failure', 'infra_error', 'not_run'].map((k) => String(judgeAStatus[k] ?? 0)))],
        ['Judge on arm B', ...(['ok', 'schema_failure', 'infra_error', 'not_run'].map((k) => String(judgeBStatus[k] ?? 0)))],
      ],
    ),
    '',
    `schema_failure = the model output was still invalid after the library's own repair retry (LlmValidationError). infra_error = HTTP 429/5xx, timeout, or network failure after the runner's backoff retries. Postings dropped because analyzeJob failed: ${loaded.droppedPostings.length}. HTTP responses recorded (all stages, including retries and failed attempts): ${allCalls.length}; by status: ${JSON.stringify(httpStatus)}.`,
    '',
    '## Models seen',
    '',
    'Generation used the freellmapi `auto` pool, which rotates free-tier models and does not allow pinning. The model returned by each successful call is recorded; the table counts the final successful call of each step.',
    '',
    table(
      ['Stage', 'Models (count)'],
      ['jobdna', 'compat', 'draft', 'critique', 'judge_a', 'judge_b'].map((s) => [
        s,
        (s === 'jobdna' || s === 'compat'
          ? modelCounts(derivedRecords, s)
          : modelCounts(records, s)
        )
          .map(([m, n]) => `${m} (${n})`)
          .join(', ') || 'none',
      ]),
    ),
    '',
    `In ${rotated}/${complete.length} complete pairs the draft and critique were served by different models. The judge is pinned to \`${EVAL_CONFIG.judgeModel}\` (requested) at temperature ${EVAL_CONFIG.judgeTemperature}; the returned id above is the model that actually answered.`,
    '',
    '## Calibration (judge and checker versus owner labels)',
    '',
  );

  if (calibration) {
    push(
      `${calibration.labeled} owner-labeled claims: ${calibration.humanFabricated} fabricated, ${calibration.humanPartial} partial, ${calibration.humanSupported} supported. The sample is stratified (about half flagged by a system, half not), so these precision/recall figures describe the labeled sheet, not the whole run. "Positive" = owner label fabricated.`,
      '',
      table(
        ['Rater', 'TP', 'FP', 'FN', 'TN', 'Precision', 'Recall', "Cohen's kappa"],
        calibration.raters.map((r) => [r.name, String(r.tp), String(r.fp), String(r.fn), String(r.tn), pct(r.precision), pct(r.recall), num(r.kappa)]),
      ),
      '',
      `Judge three-class exact agreement with the owner (supported / partial / fabricated): ${pct(calibration.judgeThreeClassAccuracy)}.`,
    );
  } else {
    push(
      `Not available. The labeling sheet is at \`${LABELS_CSV}\` (50 claims, arm hidden, blank \`label\` column; fill with supported, partial, or fabricated). After labeling, re-run \`npm run eval:report\` and this section is computed automatically. Until then, treat the judge-based numbers as unvalidated and prefer the deterministic-only rows.`,
    );
  }

  push(
    '',
    '## Method',
    '',
    `- Pipeline under test: \`@resumiq/ai-bridge\` \`selectAndDraft\` (arm A) then \`critiqueAndRevise\` applied to that same draft (arm B). Paired by construction, so arm B is conditional on arm A's draft; the measured effect is "critique applied to a draft", which is what the API does in production. \`pages=${EVAL_CONFIG.pages}\`. Temperature is the library default (0.4) for both.`,
    `- Ground truth: the owner's \`data_inventory.json\` (sha256 ${loaded.inventorySha.raw.slice(0, 16)}..., as sent to the model sha256 ${loaded.inventorySha.sentToLlm.slice(0, 16)}...). Phone and email were redacted before any LLM call; missing project date keys were set to '' to satisfy the schema.`,
    `- Postings: ${loaded.postings.length} sampled from the app's own ingested \`Job\` rows (scraper source, rawJd >= ${EVAL_CONFIG.minJdChars} chars), seeded shuffle ${EVAL_CONFIG.sampleSeed}, stratified by host with fixed per-host quotas (${JSON.stringify(EVAL_CONFIG.quotas)}), because uncapped sampling would be about 90% one company. All compatibility levels included; poor-fit postings are not filtered out. Ids, URLs and sha256 hashes are committed in \`apps/api/eval/fixtures/manifest.json\`; the posting text is gitignored.`,
    `- Repeats: ${EVAL_CONFIG.repeats} independent runs per posting per arm (freellmapi offers no seed). JobDNA is produced once per posting by \`analyzeJob\` and frozen, so both arms and all repeats share identical inputs.`,
    '- Deterministic checker (no LLM): employers, roles, project names, skills, certifications and awards must exist in the inventory; every figure in a bullet must appear in that entry\'s inventory text (versions after technology names are ignored; 10k = 10,000; a coarser rounding of an inventory figure is routed to the judge instead of failing); every technology named must belong to that entry (vocabulary = inventory technologies plus about 190 common technologies plus the posting\'s required/nice-to-have skills, which is the injection channel).',
    `- LLM judge: one call per resume per arm, separate prompt wording from the generator, pinned model \`${EVAL_CONFIG.judgeModel}\`, temperature ${EVAL_CONFIG.judgeTemperature}, blind to arm, shown only the evidence entry for each line. Verdicts: supported, partial, unsupported.`,
    `- Judge switches: the judge was first pinned to gpt-oss-120b; its route answered HTTP 429 ("All models exhausted ... prompt too large for the model") on most prompts after 34 verdicts. On the owner's direction it was switched to gemini-3-flash-preview, whose single route then returned repeated 429s and 60-second upstream 502 timeouts (about 8 verdicts in 25 minutes, far too slow to finish 240 judge calls). It was then switched to ${EVAL_CONFIG.judgeModel} (the fallback the coordinator named), which answers in 5 to 12 seconds. All earlier verdicts were removed from the run cache (archived as out/full/records.*-judge-archive.jsonl) and every resume was re-judged from scratch; the analysis only accepts verdicts tagged with the configured judge model, so judges are never mixed.`,
    '- Headline rule (fixed before the run): claim fabricated = deterministic strict check fails OR judge says unsupported. Judge "partial" is reported separately. Headline unit = narrative claims (bullets and summary); listing claims (names, skills, certifications) are reported separately because they would dilute the rate. A resume is "flagged" if any claim of any kind is flagged.',
    `- Statistics: ratio-of-sums rates, percentile bootstrap over postings (${EVAL_CONFIG.bootstrapResamples} resamples), exact McNemar on resume-level pairs. Only complete pairs enter the paired statistics; failures are tabulated above.`,
    '',
    '## Caveats',
    '',
    `- Judge/generator family overlap: the judge (${EVAL_CONFIG.judgeModel}) is a Gemini model and most generation calls were served by Gemini models (mostly gemini-3.1-flash-lite-preview, see Models seen). A judge from the same family as the generator may share its blind spots or be lenient toward its phrasing, which would bias the judged rate downward; it could also be harsher on non-Gemini output. The pinned judge is not independent of the generator.`,
    `- The judge is ${calibration ? 'calibrated only on the owner-labeled sheet shown above' : 'NOT calibrated: no owner labels yet'}, and it is a free-tier model that may share a family with the generator. The deterministic rows do not depend on it.`,
    '- The deterministic checker cannot see qualitative inflation (scope, ownership, outcome) and can mis-flag legitimate paraphrases of figures or technologies (spelled-out numbers are not parsed; derived sums are not recognised). It is validated only by a planted-fabrication self-check (`eval/sanity-check.ts`) and, once labeled, by the owner sheet.',
    `- Strictness choices that move the numbers: a skills-section item is grounded if it appears anywhere in the inventory (skills lists, any entry's technologies, or entry text), not only in the skills section; a project name that is actually a deliverable inside an experience entry (e.g. FiberLog Pro) resolves to that entry instead of counting as invented; award and volunteering titles must match inventory titles up to whole-word containment, so paraphrased awards (e.g. Best Capstone Project 2025) are flagged as not in the inventory even where the inventory describes a similar recognition.`,
    '- One candidate, one inventory: results describe how this pipeline behaves on this owner\'s data and do not generalise to other profiles.',
    '- The model behind `auto` changes between calls, including between the draft and its critique, and across the 1-2 hours of the run; the effect measured is the pipeline as served, not a fixed model.',
    '- Repeats of a posting are correlated (same job description and inventory); intervals cluster by posting but the number of independent postings is small.',
    '- The posting sample is limited by the ingested corpus: usable JDs come from six hosts; one host is capped at 6 of 40 to prevent boilerplate dominance. Stripe JDs are truncated at 4000 characters by the ingester.',
    '- A critique that deletes a flagged claim lowers the rate without correcting anything; see the deletion table above.',
    '',
    '## Examples of flagged claims',
    '',
    'Arm A:',
    ...flaggedExamples(units, 'a', 8),
    '',
    'Arm B:',
    ...flaggedExamples(units, 'b', 8),
    '',
  );

  // Resume bullet: derived only from the numbers above.
  const bulletBasis = `${h.tallyA.tot} narrative claims per arm`;
  let bullet: string;
  if (h.tallyA.tot === 0 || !Number.isFinite(h.diff.estimate)) {
    bullet = 'No bullet: not enough completed pairs to compute a rate.';
  } else if (h.diff.lo > 0) {
    bullet = `Measured the draft-then-critique pipeline against my own career data on ${new Set(headlineClusters.map((c) => c.postingId)).size} real job postings (${headlineClusters.reduce((n, c) => n + c.units.length, 0)} paired resumes, ${bulletBasis}): the critique pass cut the claim-level fabrication rate from ${pct(h.a.estimate)} to ${pct(h.b.estimate)} (difference ${pp(h.diff.estimate)}, 95% CI ${pp(h.diff.lo)} to ${pp(h.diff.hi)}), by deterministic grounding checks plus an LLM judge.`;
  } else if (h.diff.hi < 0) {
    bullet = `PARTIAL DATA (${judgedUnits.length} judged pairs). Measured the draft-then-critique pipeline against my own career data on ${new Set(headlineClusters.map((c) => c.postingId)).size} real job postings (${headlineClusters.reduce((n, c) => n + c.units.length, 0)} paired resumes): the critique pass did NOT reduce fabrication; the claim-level rate went from ${pct(h.a.estimate)} to ${pct(h.b.estimate)} (difference ${pp(h.diff.estimate)}, 95% CI ${pp(h.diff.lo)} to ${pp(h.diff.hi)}). Not usable as an improvement claim.`;
  } else {
    bullet = `Built a grounding evaluation for an LLM resume pipeline (deterministic checks against the owner's career data plus an LLM judge) and ran it on ${new Set(headlineClusters.map((c) => c.postingId)).size} real job postings (${headlineClusters.reduce((n, c) => n + c.units.length, 0)} paired resumes, ${bulletBasis}): measured claim-level fabrication of ${pct(h.a.estimate)} for the draft and ${pct(h.b.estimate)} after the critique pass; the difference (${pp(h.diff.estimate)}, 95% CI ${pp(h.diff.lo)} to ${pp(h.diff.hi)}) is not distinguishable from zero.`;
  }
  push(
    '## Proposed resume bullet (real numbers only)',
    '',
    bullet,
    '',
    `Constraint: ${excludesZero(h.diff) ? 'the interval excludes zero' : 'the interval includes zero, so do not claim a reduction'}. ${calibration ? '' : 'Add "LLM-judged, not yet human-calibrated" wording or cite the deterministic-only row until the owner labels the sheet.'} Deterministic-only (no judge) claim-level rate: ${ci(stricter.a)} for A and ${ci(stricter.b)} for B, difference ${pp(stricter.diff.estimate)} [${pp(stricter.diff.lo)}, ${pp(stricter.diff.hi)}]. Judge-only unsupported rate: ${pct(ju.a.estimate)} for A and ${pct(ju.b.estimate)} for B.`,
    '',
    '## Re-run',
    '',
    '```',
    'cd apps/api',
    'npm run eval:fixtures                 # freezes postings + JobDNA + compat (resumable)',
    'npm run eval:run -- --run full        # 40 postings x 3 repeats (resumable; same command resumes)',
    'npm run eval:labels                   # writes eval/out/human-labels.csv (refuses to overwrite filled labels)',
    'npm run eval:report -- --run full     # recomputes everything, picks up owner labels',
    'npm run eval:sanity                   # no-LLM self-check of the grounding checker',
    'npm run eval:test                     # unit tests for the pure modules (jest)',
    '```',
    '',
    'Smoke run: `npm run eval:run -- --run smoke --n 2 --repeats 1` (after `npm run eval:fixtures -- --limit 2`).',
    '',
  );

  const json = {
    run: runName,
    generatedAt: new Date().toISOString(),
    pairs: { planned, executed: units.length, complete: complete.length },
    metrics: Object.fromEntries(
      Object.entries(rows).map(([k, r]) => [k, { a: r.a, b: r.b, diff: r.diff, tallyA: r.tallyA, tallyB: r.tallyB }]),
    ),
    mcnemar: { headline: { ...mc, p: pMc }, deterministic: { ...mcDet, p: pMcDet } },
    failures: { draftStatus, critStatus, judgeAStatus, judgeBStatus, droppedPostings: loaded.droppedPostings.length },
    calibration,
  };
  return { markdown: lines.join('\n'), json };
}

if (require.main === module) {
  const runIdx = process.argv.indexOf('--run');
  const run = runIdx >= 0 ? process.argv[runIdx + 1] : 'full';
  const out = buildReport(run);
  const outDir = path.join(PATHS.out, run);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.md'), out.markdown);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(out.json, null, 2));
  console.log(`wrote ${path.join(outDir, 'report.md')}`);
  if (run === 'full') {
    fs.mkdirSync(path.dirname(PATHS.reportMd), { recursive: true });
    fs.writeFileSync(PATHS.reportMd, out.markdown);
    console.log(`wrote ${PATHS.reportMd}`);
  }
}
