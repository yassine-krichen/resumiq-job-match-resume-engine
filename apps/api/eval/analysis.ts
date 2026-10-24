import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AISelection, CompatibilityResult, JobDNA } from '@resumiq/ai-bridge';

import { StepCache, stepKey } from './cache';
import { EVAL_CONFIG, PATHS } from './config';
import type { JudgeResult, JudgeVerdict, Posting, StepRecord, StepStatus } from './eval.types';
import { extractClaims, isNarrative } from './grounding/extract-claims';
import type { Claim } from './grounding/extract-claims';
import { groundClaim } from './grounding/ground';
import type { ClaimGrounding, FabricationType } from './grounding/ground';
import { buildIndex } from './grounding/inventory-index';
import type { InventoryIndex } from './grounding/inventory-index';
import { loadInventory } from './inventory';

export interface ScoredClaim {
  claim: Claim;
  grounding: ClaimGrounding;
  judge?: JudgeVerdict;
  /** Deterministic strict check failed. */
  detStrict: boolean;
  /** Deterministic loose check failed. */
  detLoose: boolean;
  judgeUnsupported: boolean;
  judgePartial: boolean;
  /** Headline rule: deterministic strict check fails OR judge says unsupported. */
  combined: boolean;
  /** Same rule with the loose deterministic check. */
  combinedLoose: boolean;
  types: Set<FabricationType>;
}

export type ArmStatus = StepStatus | 'not_run';

export interface ArmResult {
  status: ArmStatus;
  judgeStatus: ArmStatus;
  claims: ScoredClaim[];
  selection?: AISelection;
  model: string | null;
}

export interface Unit {
  posting: Posting;
  repeat: number;
  fit: 'compatible' | 'incompatible' | 'unknown';
  index?: InventoryIndex;
  a: ArmResult;
  b: ArmResult;
}

export interface LoadedEval {
  units: Unit[];
  postings: Posting[];
  usablePostings: Posting[];
  droppedPostings: Posting[];
  records: StepRecord[];
  derivedRecords: StepRecord[];
  inventorySha: { raw: string; sentToLlm: string };
}

function lastModel(rec: StepRecord | undefined): string | null {
  if (!rec) return null;
  const ok = [...rec.calls].reverse().find((c) => c.httpStatus === 200 && c.model);
  return ok?.model ?? null;
}

function scoreArm(
  selection: AISelection,
  index: InventoryIndex,
  judge: JudgeResult | undefined,
): ScoredClaim[] {
  const verdicts = new Map((judge?.verdicts ?? []).map((v) => [v.id, v]));
  return extractClaims(selection, index).map((claim) => {
    const grounding = groundClaim(claim, index);
    const verdict = verdicts.get(claim.id);
    const judgeUnsupported = verdict?.verdict === 'unsupported';
    const types = new Set<FabricationType>(grounding.flags.map((f) => f.type));
    if (judgeUnsupported && !grounding.strictFabricated) types.add('judge');
    return {
      claim,
      grounding,
      judge: verdict,
      detStrict: grounding.strictFabricated,
      detLoose: grounding.looseFabricated,
      judgeUnsupported,
      judgePartial: verdict?.verdict === 'partial',
      combined: grounding.strictFabricated || judgeUnsupported,
      combinedLoose: grounding.looseFabricated || judgeUnsupported,
      types,
    };
  });
}

function armFromRecords(
  gen: StepRecord | undefined,
  judgeRec: StepRecord | undefined,
  index: InventoryIndex,
): ArmResult {
  if (!gen) return { status: 'not_run', judgeStatus: 'not_run', claims: [], model: null };
  if (gen.status !== 'ok') {
    return { status: gen.status, judgeStatus: 'not_run', claims: [], model: lastModel(gen) };
  }
  const selection = gen.result as AISelection;
  // Only verdicts from the configured judge model are used; a record from any
  // other judge (e.g. the abandoned gpt-oss-120b pass) is treated as absent.
  const candidate = judgeRec?.status === 'ok' ? (judgeRec.result as JudgeResult) : undefined;
  const judge = candidate?.judgeModel === EVAL_CONFIG.judgeModel ? candidate : undefined;
  return {
    status: 'ok',
    judgeStatus: judgeRec && judgeRec.status === 'ok' && !judge ? 'not_run' : (judgeRec?.status ?? 'not_run'),
    claims: scoreArm(selection, index, judge),
    selection,
    model: lastModel(gen),
  };
}

/** Joins fixtures and the run cache into scored units. Pure read; no LLM calls. */
export function loadEval(runName: string): LoadedEval {
  const postings = JSON.parse(
    fs.readFileSync(path.join(PATHS.fixtures, 'postings.json'), 'utf8'),
  ) as Posting[];
  const derived = new StepCache(path.join(PATHS.fixtures, 'derived-steps.jsonl'));
  const cache = new StepCache(path.join(PATHS.out, runName, 'records.jsonl'));
  const inventory = loadInventory();

  const ranPostings = new Set(cache.all().map((r) => r.postingId));
  const repeatsSeen = Math.max(0, ...cache.all().map((r) => r.repeat));
  const considered = postings.filter((p) => ranPostings.has(p.id) || derived.get(stepKey(p.id, 0, 'jobdna')));
  const usablePostings: Posting[] = [];
  const droppedPostings: Posting[] = [];
  const units: Unit[] = [];

  for (const p of considered) {
    const dnaRec = derived.get(stepKey(p.id, 0, 'jobdna'));
    if (dnaRec?.status !== 'ok') {
      droppedPostings.push(p);
      continue;
    }
    if (!ranPostings.has(p.id)) continue;
    usablePostings.push(p);
    const dna = dnaRec.result as JobDNA;
    const compat = derived.get(stepKey(p.id, 0, 'compat'));
    const fit: Unit['fit'] =
      compat?.status === 'ok'
        ? (compat.result as CompatibilityResult).compatible
          ? 'compatible'
          : 'incompatible'
        : 'unknown';
    const index = buildIndex(inventory.db, [
      ...dna.mandatory_technical_skills,
      ...dna.nice_to_have_skills,
    ]);
    for (let r = 1; r <= repeatsSeen; r++) {
      const draft = cache.get(stepKey(p.id, r, 'draft'));
      if (!draft) continue;
      units.push({
        posting: p,
        repeat: r,
        fit,
        index,
        a: armFromRecords(draft, cache.get(stepKey(p.id, r, 'judge_a')), index),
        b: armFromRecords(
          cache.get(stepKey(p.id, r, 'critique')),
          cache.get(stepKey(p.id, r, 'judge_b')),
          index,
        ),
      });
    }
  }

  return {
    units,
    postings,
    usablePostings,
    droppedPostings,
    records: cache.all(),
    derivedRecords: derived.all(),
    inventorySha: { raw: inventory.rawSha256, sentToLlm: inventory.redactedSha256 },
  };
}

export const isComplete = (u: Unit): boolean => u.a.status === 'ok' && u.b.status === 'ok';

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface Tally {
  fab: number;
  tot: number;
}

export type ArmMetric = (arm: ArmResult) => Tally;

const narrative = (arm: ArmResult): ScoredClaim[] => arm.claims.filter((c) => isNarrative(c.claim));
const countWhere = (cs: ScoredClaim[], f: (c: ScoredClaim) => boolean): number => cs.filter(f).length;

export const METRICS: Record<string, ArmMetric> = {
  claim_headline: (a) => ({ fab: countWhere(narrative(a), (c) => c.combined), tot: narrative(a).length }),
  claim_det_strict: (a) => ({ fab: countWhere(narrative(a), (c) => c.detStrict), tot: narrative(a).length }),
  claim_det_loose: (a) => ({ fab: countWhere(narrative(a), (c) => c.detLoose), tot: narrative(a).length }),
  claim_judge_unsupported: (a) => ({
    fab: countWhere(narrative(a), (c) => c.judgeUnsupported),
    tot: narrative(a).length,
  }),
  claim_judge_partial: (a) => ({ fab: countWhere(narrative(a), (c) => c.judgePartial), tot: narrative(a).length }),
  claim_all_kinds_combined: (a) => ({ fab: countWhere(a.claims, (c) => c.combined), tot: a.claims.length }),
  listing_claims_combined: (a) => {
    const listing = a.claims.filter((c) => !isNarrative(c.claim));
    return { fab: countWhere(listing, (c) => c.combined), tot: listing.length };
  },
  resume_any_combined: (a) => ({ fab: a.claims.some((c) => c.combined) ? 1 : 0, tot: 1 }),
  resume_any_det_strict: (a) => ({ fab: a.claims.some((c) => c.detStrict) ? 1 : 0, tot: 1 }),
  fabricated_per_resume: (a) => ({ fab: countWhere(a.claims, (c) => c.combined), tot: 1 }),
  claims_per_resume: (a) => ({ fab: a.claims.length, tot: 1 }),
  narrative_claims_per_resume: (a) => ({ fab: narrative(a).length, tot: 1 }),
};

export interface PostingCluster {
  postingId: string;
  host: string;
  fit: Unit['fit'];
  units: Unit[];
}

/** Complete pairs grouped by posting (the bootstrap resampling unit). */
export function clustersOf(units: readonly Unit[]): PostingCluster[] {
  const byPosting = new Map<string, PostingCluster>();
  for (const u of units.filter(isComplete)) {
    const c = byPosting.get(u.posting.id) ?? {
      postingId: u.posting.id,
      host: u.posting.host,
      fit: u.fit,
      units: [],
    };
    c.units.push(u);
    byPosting.set(u.posting.id, c);
  }
  return [...byPosting.values()];
}

export function sumArm(
  clusters: readonly PostingCluster[],
  metric: ArmMetric,
  arm: 'a' | 'b',
): Tally {
  let fab = 0;
  let tot = 0;
  for (const c of clusters) {
    for (const u of c.units) {
      const t = metric(u[arm]);
      fab += t.fab;
      tot += t.tot;
    }
  }
  return { fab, tot };
}

export const ratio = (t: Tally): number => (t.tot === 0 ? NaN : t.fab / t.tot);

export function mcnemarCounts(
  units: readonly Unit[],
  flagged: (arm: ArmResult) => boolean,
): { bothFab: number; aOnly: number; bOnly: number; neither: number } {
  const out = { bothFab: 0, aOnly: 0, bOnly: 0, neither: 0 };
  for (const u of units.filter(isComplete)) {
    const a = flagged(u.a);
    const b = flagged(u.b);
    if (a && b) out.bothFab++;
    else if (a) out.aOnly++;
    else if (b) out.bOnly++;
    else out.neither++;
  }
  return out;
}
