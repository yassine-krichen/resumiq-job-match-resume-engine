import { SENTINELS, loadSnapshot, tieInventory, validInventory } from '../test-support/fixture';

import { buildIndex } from './entries';
import { SNIPPET_MAX_CHARS, searchEntries } from './search';

function search(data: unknown, query: string, limit = 8, sections?: Parameters<typeof searchEntries>[2]['sections']) {
  return searchEntries(buildIndex(loadSnapshot(data).view), query, { limit, sections });
}

describe('searchEntries', () => {
  it('ranks a project whose technologies_used contains the term above one that only mentions it in prose', () => {
    const hits = search(validInventory(), 'Redis');
    const ids = hits.map((h) => h.title);

    expect(ids.indexOf('Cache Service')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('Notes App')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('Cache Service')).toBeLessThan(ids.indexOf('Notes App'));
  });

  it('ranks an exact title match above a technology-list match', () => {
    const data = validInventory();
    (data.projects as Record<string, unknown>[]).push({
      ...(data.projects as Record<string, unknown>[])[0],
      name: 'Redis',
      technologies_used: ['Go'],
    });

    const hits = search(data, 'redis');

    expect(hits[0].title).toBe('Redis');
  });

  it('never returns personal_info fields, even when queried for them', () => {
    const data = validInventory();
    const queries = [SENTINELS.phone, SENTINELS.email, SENTINELS.key, SENTINELS.name, 'sentinel', 'example.com'];

    const everything = queries.map((q) => JSON.stringify(search(data, q, 25))).join('');

    for (const secret of [SENTINELS.phone, SENTINELS.email, SENTINELS.key, SENTINELS.name, SENTINELS.credentialId]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('does not index or return certification credential ids', () => {
    expect(search(validInventory(), SENTINELS.credentialId)).toEqual([]);
  });

  it('caps results at the limit', () => {
    expect(search(tieInventory(), 'kafka', 2)).toHaveLength(2);
  });

  it('orders tied scores by section then index, the same way on every call', () => {
    const first = search(tieInventory(), 'kafka', 3);
    const second = search(tieInventory(), 'kafka', 3);

    expect(first.map((h) => h.id)).toEqual(['projects:0', 'projects:1', 'projects:2']);
    expect(first).toEqual(second);
    expect(new Set(first.map((h) => h.score)).size).toBe(1);
  });

  it('restricts results to the requested sections', () => {
    const hits = search(validInventory(), 'redis', 8, ['skills']);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.section === 'skills')).toBe(true);
  });

  it('hard-caps the snippet length', () => {
    const data = validInventory();
    (data.projects as Record<string, unknown>[])[0].raw_achievements = [`Redis ${'x'.repeat(2000)}`];

    const [hit] = search(data, 'redis', 1);

    expect(hit.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
  });

  it('returns nothing when the query has only stopwords or no match', () => {
    expect(search(validInventory(), 'the and of')).toEqual([]);
    expect(search(validInventory(), 'zzqxunmatchable')).toEqual([]);
  });

  it('matches a query word to its inflected form in the inventory', () => {
    const data = validInventory();
    (data.projects as Record<string, unknown>[])[1].technologies_used = ['Caching'];

    const hits = search(data, 'cache');

    expect(hits.map((h) => h.title)).toContain('Notes App');
  });
});
