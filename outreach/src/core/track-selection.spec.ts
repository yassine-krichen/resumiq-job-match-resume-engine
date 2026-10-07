import { loadExampleConfig, loadExampleInventory } from '../testing/test-env';

import { guardTailoring } from './bullet-guard';
import { buildTrackTailoring, rankProjects } from './track-selection';

const config = loadExampleConfig();
const db = loadExampleInventory();

describe('buildTrackTailoring', () => {
  it.each(['ai', 'swe', 'fullstack'] as const)('builds a guard-clean tailoring for the %s track', (track) => {
    const tailoring = buildTrackTailoring(db, config.tracks[track]);
    expect(guardTailoring(tailoring, db).pass).toBe(true);
    expect(tailoring.entries.length).toBeGreaterThanOrEqual(2);
    expect(tailoring.entries.length).toBeLessThanOrEqual(4);
  });

  it('picks the entries that match the track keywords', () => {
    const ai = buildTrackTailoring(db, config.tracks.ai).entries.map((entry) => entry.name);
    expect(ai).toContain('Helios Data Labs');
    expect(ai).toContain('DocuAsk');

    const fullstack = buildTrackTailoring(db, config.tracks.fullstack).entries.map((entry) => entry.name);
    expect(fullstack).toContain('Brightline Systems');
    expect(fullstack).toContain('TrailTrack');
  });

  it('uses the inventory achievements verbatim as bullets', () => {
    const tailoring = buildTrackTailoring(db, config.tracks.ai);
    const known = new Set([...db.experience, ...db.projects].flatMap((entry) => entry.raw_achievements));
    for (const entry of tailoring.entries) {
      for (const bullet of entry.bullets) expect(known.has(bullet.text)).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(buildTrackTailoring(db, config.tracks.swe)).toEqual(buildTrackTailoring(db, config.tracks.swe));
  });

  it('respects the bullet and entry limits from the rules', () => {
    const tailoring = buildTrackTailoring(db, { ...config.tracks.ai, max_projects: 1, bullets_per_entry: 1 });
    expect(tailoring.entries).toHaveLength(2);
    for (const entry of tailoring.entries) expect(entry.bullets).toHaveLength(1);
  });

  it('puts skills that match the keywords first and never shows a skill the profile lacks', () => {
    const { skills } = buildTrackTailoring(db, { ...config.tracks.ai, skills_per_category: 3 });
    expect(skills.programming_languages[0]).toBe('Python');
    const all = Object.values(db.skills).filter((value): value is string[] => Array.isArray(value) && typeof value[0] === 'string').flat();
    for (const skill of Object.values(skills).flat()) expect(all).toContain(skill);
  });

  it('drops a bullet that names a technology the entry does not list instead of failing the resume', () => {
    const tampered = structuredClone(db);
    tampered.projects[0].raw_achievements = [
      'Built a RAG assistant that answers questions over PDF collections with Kubernetes',
      'Chunked and embedded 3,500 pages of documentation into a pgvector index',
    ];
    const bullets = buildTrackTailoring(tampered, config.tracks.ai).entries.find((entry) => entry.name === 'DocuAsk')?.bullets;
    expect(bullets?.map((bullet) => bullet.text)).toEqual(['Chunked and embedded 3,500 pages of documentation into a pgvector index']);
  });

  it('throws when the configured summary names a technology the profile does not have', () => {
    expect(() =>
      buildTrackTailoring(db, { ...config.tracks.ai, summary: 'Student who deploys everything on Kubernetes clusters daily.' }),
    ).toThrow(/bullet guard/);
  });

  it('throws when the inventory cannot fill two entries', () => {
    const tiny = structuredClone(db);
    tiny.experience = [];
    tiny.projects = tiny.projects.slice(0, 1);
    expect(() => buildTrackTailoring(tiny, config.tracks.ai)).toThrow();
  });
});

describe('rankProjects', () => {
  it('orders projects by keyword fit and keeps inventory order for ties', () => {
    const names = rankProjects(db, ['go', 'grpc']).map((project) => project.name);
    expect(names[0]).toBe('MiniKV');
    expect(names.slice(1)).toEqual(db.projects.map((project) => project.name).filter((name) => name !== 'MiniKV'));
  });
});
