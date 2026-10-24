import { mulberry32 } from './rng';

export interface Interval {
  estimate: number;
  lo: number;
  hi: number;
  /** Resamples that produced a defined statistic (denominator > 0). */
  usedResamples: number;
}

/**
 * Percentile bootstrap that resamples whole clusters (postings), keeping a
 * posting's repeats together because they share the same job description.
 */
export function clusterBootstrap<C>(
  clusters: readonly C[],
  stat: (sample: readonly C[]) => number,
  resamples: number,
  seed: number,
): Interval {
  const estimate = stat(clusters);
  if (clusters.length === 0) return { estimate, lo: NaN, hi: NaN, usedResamples: 0 };
  const rand = mulberry32(seed);
  const values: number[] = [];
  for (let b = 0; b < resamples; b++) {
    const sample: C[] = new Array(clusters.length);
    for (let i = 0; i < clusters.length; i++) sample[i] = clusters[Math.floor(rand() * clusters.length)];
    const v = stat(sample);
    if (Number.isFinite(v)) values.push(v);
  }
  values.sort((x, y) => x - y);
  const at = (q: number): number => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))];
  return { estimate, lo: values.length ? at(0.025) : NaN, hi: values.length ? at(0.975) : NaN, usedResamples: values.length };
}

/** Exact two-sided McNemar test: b and c are the two discordant-pair counts. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  // P(X <= k) for X ~ Binomial(n, 0.5), accumulated iteratively.
  let term = Math.pow(0.5, n);
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term = (term * (n - i + 1)) / i;
    cdf += term;
  }
  return Math.min(1, 2 * cdf);
}

/** Cohen's kappa for two binary raters from a 2x2 table. */
export function cohenKappa(tp: number, fp: number, fn: number, tn: number): number {
  const n = tp + fp + fn + tn;
  if (n === 0) return NaN;
  const po = (tp + tn) / n;
  const pe = ((tp + fp) / n) * ((tp + fn) / n) + ((fn + tn) / n) * ((fp + tn) / n);
  return pe === 1 ? NaN : (po - pe) / (1 - pe);
}
