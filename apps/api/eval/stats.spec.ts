import { clusterBootstrap, cohenKappa, mcnemarExact } from './stats';

describe('mcnemarExact', () => {
  it('returns 1 when there are no discordant pairs', () => {
    expect(mcnemarExact(0, 0)).toBe(1);
  });

  it('returns 1 for a perfectly balanced split', () => {
    expect(mcnemarExact(5, 5)).toBe(1);
  });

  it('matches hand-computed two-sided binomial values', () => {
    // n=5, k=0: 2 * (1/32)
    expect(mcnemarExact(0, 5)).toBeCloseTo(0.0625, 10);
    // n=10, k=1: 2 * (1 + 10) / 1024
    expect(mcnemarExact(1, 9)).toBeCloseTo(0.021484375, 10);
    // n=4, k=1: 2 * (1 + 4) / 16
    expect(mcnemarExact(1, 3)).toBeCloseTo(0.625, 10);
  });

  it('is symmetric in its arguments', () => {
    expect(mcnemarExact(2, 8)).toBe(mcnemarExact(8, 2));
  });
});

describe('cohenKappa', () => {
  it('is 1 for perfect agreement and 0 for chance-level agreement', () => {
    expect(cohenKappa(10, 0, 0, 10)).toBe(1);
    expect(cohenKappa(5, 5, 5, 5)).toBe(0);
  });

  it('is negative for systematic disagreement', () => {
    expect(cohenKappa(0, 10, 10, 0)).toBe(-1);
  });

  it('is NaN for an empty table', () => {
    expect(cohenKappa(0, 0, 0, 0)).toBeNaN();
  });
});

describe('clusterBootstrap', () => {
  const clusters = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => ({ x }));
  const mean = (s: readonly { x: number }[]): number => s.reduce((a, c) => a + c.x, 0) / s.length;

  it('is deterministic for a fixed seed', () => {
    const a = clusterBootstrap(clusters, mean, 500, 42);
    const b = clusterBootstrap(clusters, mean, 500, 42);
    expect(a).toEqual(b);
  });

  it('draws different resamples for different seeds', () => {
    const draws = (seed: number): number[] => {
      const seen: number[] = [];
      clusterBootstrap(clusters, (s) => (seen.push(s.reduce((a, c) => a + c.x * 31, 0)), mean(s)), 20, seed);
      return seen;
    };
    expect(draws(1)).not.toEqual(draws(2));
    expect(draws(1)).toEqual(draws(1));
  });

  it('reports the point estimate on the original clusters and brackets it', () => {
    const r = clusterBootstrap(clusters, mean, 2000, 7);
    expect(r.estimate).toBe(4.5);
    expect(r.lo).toBeLessThanOrEqual(4.5);
    expect(r.hi).toBeGreaterThanOrEqual(4.5);
    expect(r.lo).toBeGreaterThan(1);
    expect(r.hi).toBeLessThan(8);
  });

  it('gives a zero-width interval when every cluster is identical', () => {
    const r = clusterBootstrap([{ x: 3 }, { x: 3 }, { x: 3 }], mean, 200, 5);
    expect(r.lo).toBe(3);
    expect(r.hi).toBe(3);
  });

  it('skips resamples whose statistic is undefined', () => {
    type Tally = { fab: number; tot: number };
    const ratio = (s: readonly Tally[]): number => {
      const tot = s.reduce((a, c) => a + c.tot, 0);
      return tot === 0 ? NaN : s.reduce((a, c) => a + c.fab, 0) / tot;
    };
    const r = clusterBootstrap<Tally>([{ fab: 1, tot: 2 }, { fab: 0, tot: 0 }], ratio, 300, 3);
    expect(r.usedResamples).toBeLessThan(300);
    expect(r.usedResamples).toBeGreaterThan(0);
  });

  it('returns NaN bounds for no clusters', () => {
    const r = clusterBootstrap([] as { x: number }[], () => NaN, 10, 1);
    expect(r.lo).toBeNaN();
    expect(r.usedResamples).toBe(0);
  });
});
