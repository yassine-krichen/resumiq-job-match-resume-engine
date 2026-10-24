// Self-check for the deterministic grounding checker (no LLM calls).
// 1. False-positive probe: every raw_achievement / quantifiable_metric in the
//    inventory, used verbatim as a bullet under its own entry, must not be flagged.
// 2. Planted-fabrication probe: a clean selection with 3 fake numbers, 2 injected
//    technologies and 1 fake employer must be flagged exactly as planted.
// Usage (from apps/api): npx ts-node --transpile-only eval/sanity-check.ts
import type { AISelection } from '@resumiq/ai-bridge';

import { extractClaims } from './grounding/extract-claims';
import { groundClaim } from './grounding/ground';
import { buildIndex } from './grounding/inventory-index';
import { loadInventory } from './inventory';

const emptySkills = { languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] };

function selection(partial: Partial<AISelection>): AISelection {
  return {
    reasoning: '',
    section_order: ['experience', 'projects', 'skills'],
    experience: [],
    projects: [],
    skills: emptySkills,
    certifications: [],
    awards: [],
    ...partial,
  };
}

function ground(sel: AISelection, index: ReturnType<typeof buildIndex>) {
  return extractClaims(sel, index).map((c) => ({ claim: c, g: groundClaim(c, index) }));
}

function main(): void {
  const { db } = loadInventory();
  const index = buildIndex(db, ['Kafka', 'Terraform', 'Snowflake']);

  // 1. false-positive probe
  const verbatim = selection({
    summary: db.summaries[0]?.content,
    experience: db.experience.map((e) => ({
      company: e.company,
      role: e.role,
      bullets: [...e.raw_achievements, ...e.quantifiable_metrics],
    })),
    projects: db.projects.map((p) => ({
      name: p.name,
      bullets: [...p.raw_achievements, ...p.quantifiable_metrics],
    })),
    skills: {
      languages: db.skills.programming_languages,
      frameworks_and_libraries: db.skills.frameworks_and_libraries,
      infrastructure_and_tools: db.skills.infrastructure_and_tools,
      databases: db.skills.databases,
    },
    certifications: db.certifications.map((c) => c.name),
    awards: db.awards_and_honors.map((a) => a.title),
  });
  const probe = ground(verbatim, index);
  const falsePositives = probe.filter((x) => x.g.strictFabricated);
  const derived = probe.filter((x) => x.g.derivedNumbers.length > 0);
  console.log(`verbatim probe: ${probe.length} claims, ${falsePositives.length} flagged, ${derived.length} with derived-number candidates`);
  for (const x of falsePositives.slice(0, 25)) {
    console.log(`  FLAG ${x.claim.id}: ${x.g.flags.map((f) => `${f.type}(${f.detail})`).join('; ')} | ${x.claim.text.slice(0, 90)}`);
  }

  // 2. planted probe
  const e0 = db.experience[0];
  const p0 = db.projects[0];
  const planted = selection({
    experience: [
      { company: e0.company, role: e0.role, bullets: [e0.raw_achievements[0], `Cut deployment time by 87.3% across ${e0.company} services`] },
      { company: 'Globex Corporation', role: 'Staff Engineer', bullets: ['Led the platform team'] },
    ],
    projects: [
      { name: p0.name, bullets: [p0.raw_achievements[0], 'Served 4,321,000 requests per day', 'Streamed events through Kafka and orchestrated with Terraform'] },
    ],
  });
  const flagged = ground(planted, index).filter((x) => x.g.strictFabricated);
  for (const x of flagged) {
    console.log(`  planted flag ${x.claim.id}: ${x.g.flags.map((f) => `${f.type}(${f.detail})`).join('; ')}`);
  }
  const byType: Record<string, number> = {};
  for (const x of flagged) for (const f of x.g.flags) byType[f.type] = (byType[f.type] ?? 0) + 1;
  console.log('planted flags by type:', JSON.stringify(byType));
  // expected: number x2 (87.3, 4321000), tech x2 (Kafka, Terraform), entry x2 (header + bullet)
  const ok = byType.number === 2 && byType.tech === 2 && byType.entry === 2 && flagged.reduce((s, x) => s + x.g.flags.length, 0) === 6;
  console.log(ok ? 'PLANTED PROBE OK' : 'PLANTED PROBE MISMATCH');
  if (!ok || falsePositives.length > 0) process.exitCode = 1;
}

main();
