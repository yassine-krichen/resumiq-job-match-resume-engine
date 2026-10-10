import { buildCandidateBrief } from './candidate-brief.service';
import { loadExampleConfig, loadExampleInventory } from '../testing/test-env';

describe('buildCandidateBrief', () => {
  it('tells the writer the one-page limits its tailoring must respect', () => {
    const brief = buildCandidateBrief(loadExampleConfig(), loadExampleInventory());

    expect(brief.tailoring_limits).toEqual({
      max_entries: 3,
      max_bullets_experience: 3,
      max_bullets_project: 2,
      max_skills_per_category: 6,
    });
  });

  it('keeps phone and email out of the brief', () => {
    const text = JSON.stringify(buildCandidateBrief(loadExampleConfig(), loadExampleInventory()));

    expect(text).not.toContain('"phone"');
    expect(text).not.toContain('"email"');
  });
});
