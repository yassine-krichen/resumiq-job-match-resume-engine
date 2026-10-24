// Human-label calibration for the LLM judge and the deterministic checker.
//
//   Export a labeling sheet (50 narrative claims, arm hidden, blank label column):
//     npx ts-node --transpile-only eval/calibration.ts --run full
//   Refuses to overwrite a sheet that already has labels unless --force is given.
//
// The owner fills the `label` column with supported | partial | fabricated.
// report.ts picks the labels up automatically on its next run.
import * as fs from 'node:fs';
import * as path from 'node:path';

import { clustersOf, isComplete, loadEval } from './analysis';
import type { LoadedEval, ScoredClaim, Unit } from './analysis';
import { EVAL_CONFIG, PATHS } from './config';
import { isNarrative } from './grounding/extract-claims';
import { seededShuffle } from './rng';
import { cohenKappa } from './stats';

export const LABELS_CSV = path.join(PATHS.out, 'human-labels.csv');
export const LABELS_KEY = path.join(PATHS.out, 'human-labels.key.json');

export type HumanLabel = 'supported' | 'partial' | 'fabricated';

interface Candidate {
  unit: Unit;
  arms: Array<'A' | 'B'>;
  scored: ScoredClaim;
}

export interface LabelKeyEntry {
  labelId: string;
  postingId: string;
  repeat: number;
  claimId: string;
  arms: Array<'A' | 'B'>;
  stratum: 'flagged' | 'unflagged';
}

function evidenceFor(c: ScoredClaim): string {
  const entry = c.claim.entry;
  if (!entry) return 'Whole inventory: see summaries, skills, and entry technologies (summary line).';
  const json = entry.json as Record<string, unknown>;
  const list = (k: string): string[] => (Array.isArray(json[k]) ? (json[k] as string[]) : []);
  return [
    `ENTRY: ${entry.label}`,
    `TECH: ${list('technologies_used').join(', ')}`,
    `ACHIEVEMENTS: ${list('raw_achievements').join(' | ')}`,
    `METRICS: ${list('quantifiable_metrics').join(' | ')}`,
  ]
    .join(' || ')
    .slice(0, 6000);
}

function csvField(value: string): string {
  return `"${value.replace(/\r?\n/g, ' | ').replace(/"/g, '""')}"`;
}

function candidates(loaded: LoadedEval): Candidate[] {
  const seen = new Map<string, Candidate>();
  // Only pairs with a judge verdict in both arms: an unjudged claim would be mislabeled "unflagged".
  const judged = loaded.units.filter((u) => isComplete(u) && u.a.judgeStatus === 'ok' && u.b.judgeStatus === 'ok');
  for (const u of judged) {
    for (const [arm, result] of [['A', u.a], ['B', u.b]] as const) {
      for (const s of result.claims.filter((c) => isNarrative(c.claim))) {
        const key = `${u.posting.id}|${u.repeat}|${s.claim.text.trim().toLowerCase()}`;
        const existing = seen.get(key);
        if (existing) existing.arms.push(arm);
        else seen.set(key, { unit: u, arms: [arm], scored: s });
      }
    }
  }
  return [...seen.values()];
}

function pickStratified(pool: Candidate[], want: number, seed: number): Candidate[] {
  const perPosting = new Map<string, number>();
  const out: Candidate[] = [];
  for (const c of seededShuffle(pool, seed)) {
    if (out.length >= want) break;
    const used = perPosting.get(c.unit.posting.id) ?? 0;
    if (used >= 3) continue;
    perPosting.set(c.unit.posting.id, used + 1);
    out.push(c);
  }
  return out;
}

export function exportLabelSheet(runName: string, force: boolean): string {
  if (fs.existsSync(LABELS_CSV) && !force) {
    const filled = [...readLabels().values()].length;
    if (filled > 0) {
      throw new Error(`${LABELS_CSV} already has ${filled} labels; refusing to overwrite (use --force).`);
    }
  }
  const loaded = loadEval(runName);
  const all = candidates(loaded);
  const flagged = all.filter((c) => c.scored.combined || c.scored.judgePartial);
  const unflagged = all.filter((c) => !(c.scored.combined || c.scored.judgePartial));
  const half = EVAL_CONFIG.calibrationClaims / 2;
  const pickedFlagged = pickStratified(flagged, half, EVAL_CONFIG.calibrationSeed);
  const pickedUnflagged = pickStratified(
    unflagged,
    EVAL_CONFIG.calibrationClaims - pickedFlagged.length,
    EVAL_CONFIG.calibrationSeed + 1,
  );
  const stratum = new Map<Candidate, 'flagged' | 'unflagged'>();
  pickedFlagged.forEach((c) => stratum.set(c, 'flagged'));
  pickedUnflagged.forEach((c) => stratum.set(c, 'unflagged'));
  const sheet = seededShuffle([...stratum.keys()], EVAL_CONFIG.calibrationSeed + 2);

  const key: LabelKeyEntry[] = [];
  const rows = ['label_id,claim_type,entry,claim_text,inventory_evidence,label,notes'];
  sheet.forEach((c, i) => {
    const labelId = `L${String(i + 1).padStart(2, '0')}`;
    key.push({
      labelId,
      postingId: c.unit.posting.id,
      repeat: c.unit.repeat,
      claimId: c.scored.claim.id,
      arms: c.arms,
      stratum: stratum.get(c) as 'flagged' | 'unflagged',
    });
    rows.push(
      [
        labelId,
        c.scored.claim.kind,
        c.scored.claim.entryLabel,
        c.scored.claim.text,
        evidenceFor(c.scored),
        '',
        '',
      ]
        .map(csvField)
        .join(','),
    );
  });

  fs.mkdirSync(PATHS.out, { recursive: true });
  fs.writeFileSync(LABELS_CSV, `﻿${rows.join('\r\n')}\r\n`);
  fs.writeFileSync(LABELS_KEY, JSON.stringify(key, null, 2));
  return `wrote ${sheet.length} claims (${pickedFlagged.length} flagged, ${pickedUnflagged.length} unflagged; ${clustersOf(loaded.units).length} postings available) to ${LABELS_CSV}`;
}

// ── Reading labels back ─────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeLabel(raw: string): HumanLabel | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('s')) return 'supported';
  if (v.startsWith('p')) return 'partial';
  if (v.startsWith('f') || v.startsWith('u')) return 'fabricated';
  return null;
}

/** label_id -> label, for every row the owner has filled in. */
export function readLabels(): Map<string, HumanLabel> {
  const out = new Map<string, HumanLabel>();
  if (!fs.existsSync(LABELS_CSV)) return out;
  const rows = parseCsv(fs.readFileSync(LABELS_CSV, 'utf8').replace(/^﻿/, ''));
  const header = rows[0] ?? [];
  const idCol = header.indexOf('label_id');
  const labelCol = header.indexOf('label');
  if (idCol < 0 || labelCol < 0) return out;
  for (const r of rows.slice(1)) {
    const label = normalizeLabel(r[labelCol] ?? '');
    if (label && r[idCol]) out.set(r[idCol], label);
  }
  return out;
}

export interface RaterAgreement {
  name: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  kappa: number;
}

export interface CalibrationResult {
  labeled: number;
  humanFabricated: number;
  humanPartial: number;
  humanSupported: number;
  raters: RaterAgreement[];
  judgeThreeClassAccuracy: number;
}

function agreement(name: string, pairs: Array<{ human: boolean; system: boolean }>): RaterAgreement {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of pairs) {
    if (p.human && p.system) tp++;
    else if (!p.human && p.system) fp++;
    else if (p.human && !p.system) fn++;
    else tn++;
  }
  return {
    name,
    tp, fp, fn, tn,
    precision: tp + fp === 0 ? NaN : tp / (tp + fp),
    recall: tp + fn === 0 ? NaN : tp / (tp + fn),
    kappa: cohenKappa(tp, fp, fn, tn),
  };
}

/** Returns null when the owner has not labeled anything yet. */
export function computeCalibration(loaded: LoadedEval): CalibrationResult | null {
  const labels = readLabels();
  if (labels.size === 0 || !fs.existsSync(LABELS_KEY)) return null;
  const key = JSON.parse(fs.readFileSync(LABELS_KEY, 'utf8')) as LabelKeyEntry[];

  const rows: Array<{ human: HumanLabel; scored: ScoredClaim }> = [];
  for (const k of key) {
    const human = labels.get(k.labelId);
    if (!human) continue;
    const unit = loaded.units.find((u) => u.posting.id === k.postingId && u.repeat === k.repeat);
    const arm = k.arms[0] === 'A' ? unit?.a : unit?.b;
    const scored = arm?.claims.find((c) => c.claim.id === k.claimId);
    if (scored) rows.push({ human, scored });
  }
  if (rows.length === 0) return null;

  const humanFab = (h: HumanLabel): boolean => h === 'fabricated';
  const threeClass = rows.filter((r) => {
    const j = r.scored.judge?.verdict;
    return (
      (j === 'supported' && r.human === 'supported') ||
      (j === 'partial' && r.human === 'partial') ||
      (j === 'unsupported' && r.human === 'fabricated')
    );
  }).length;

  return {
    labeled: rows.length,
    humanFabricated: rows.filter((r) => r.human === 'fabricated').length,
    humanPartial: rows.filter((r) => r.human === 'partial').length,
    humanSupported: rows.filter((r) => r.human === 'supported').length,
    raters: [
      agreement('LLM judge (unsupported)', rows.map((r) => ({ human: humanFab(r.human), system: r.scored.judgeUnsupported }))),
      agreement('Deterministic checker (strict)', rows.map((r) => ({ human: humanFab(r.human), system: r.scored.detStrict }))),
      agreement('Headline rule (det OR judge)', rows.map((r) => ({ human: humanFab(r.human), system: r.scored.combined }))),
    ],
    judgeThreeClassAccuracy: threeClass / rows.length,
  };
}

if (require.main === module) {
  const runIdx = process.argv.indexOf('--run');
  const run = runIdx >= 0 ? process.argv[runIdx + 1] : 'full';
  console.log(exportLabelSheet(run, process.argv.includes('--force')));
}
