import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { InventorySnapshot, createInventoryStore } from '../inventory/inventory-store';

/** Planted values that must never appear in any tool result. */
export const SENTINELS = {
  phone: '+216 55 123 987',
  email: 'sentinel.person@example.com',
  key: 'sk-SENTINELKEY0123456789abcdef',
  credentialId: 'CRED-SENTINEL-4242',
  name: 'Sentinel Personfield',
} as const;

type Json = Record<string, unknown>;

function project(name: string, extra: Json = {}): Json {
  return {
    name,
    context: '',
    links: [],
    startDate: '2025-01',
    endDate: 'Present',
    technologies_used: ['TypeScript'],
    raw_achievements: [`Shipped ${name} to production`],
    quantifiable_metrics: ['120 ms p95'],
    sources: [`git log in ${name}`],
    ...extra,
  };
}

/** A fixture that passes MasterDBSchema and has no inventory-quality gaps. */
export function validInventory(): Json {
  return {
    personal_info: {
      name: SENTINELS.name,
      location: 'Nowhere',
      phone: SENTINELS.phone,
      email: SENTINELS.email,
      work_authorization: [],
      clearances: [],
      links: [{ platform: 'GitHub', url: `https://example.com/sentinel?token=${SENTINELS.key}` }],
    },
    summaries: [{ target_role: 'Backend Engineer', content: 'Builds reliable services.' }],
    experience: [
      {
        company: 'Acme Corp',
        company_industry: 'Software',
        role: 'Backend Engineer',
        location: 'Remote',
        location_type: 'Remote',
        startDate: 'March 2024',
        endDate: 'Present',
        isCurrent: true,
        core_competencies: ['API design'],
        technologies_used: ['Node.js', 'PostgreSQL'],
        raw_achievements: ['Cut report generation time with a nightly job'],
        quantifiable_metrics: ['40% faster reports'],
      },
    ],
    education: [
      {
        institution: 'Example University',
        degree_type: 'BSc',
        major: 'Computer Science',
        minor: '',
        location: 'Tunis',
        startDate: '2020-09',
        endDate: '2024-06',
        gpa: '3.5',
        honors: [],
        relevant_coursework: ['Distributed Systems'],
        thesis_or_capstone: '',
        extracurriculars: [],
        description: '',
      },
    ],
    projects: [
      project('Cache Service', {
        technologies_used: ['Redis', 'NestJS'],
        raw_achievements: ['Built a read-through layer for hot endpoints'],
      }),
      project('Notes App', {
        technologies_used: ['React'],
        raw_achievements: ['Moved session storage from Redis to cookies after an outage'],
      }),
      project('Dup Project', { technologies_used: ['Go'] }),
      project('dup project', { technologies_used: ['Rust'] }),
    ],
    skills: {
      programming_languages: ['TypeScript', 'Go'],
      frameworks_and_libraries: ['NestJS'],
      infrastructure_and_tools: ['Docker'],
      databases: ['PostgreSQL', 'Redis'],
      spoken_languages: [{ language: 'English', fluency: 'Fluent' }],
      soft_skills: ['Communication'],
    },
    certifications: [
      {
        name: 'Cloud Practitioner',
        issuer: 'ExampleCloud',
        date: '2025-02',
        expiration_date: '',
        credential_id: SENTINELS.credentialId,
        link: `https://example.com/verify/${SENTINELS.credentialId}`,
        description: '',
      },
    ],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
  };
}

/** Three projects that tie on every ranked field when the query is "kafka". */
export function tieInventory(): Json {
  const base = validInventory();
  base.projects = ['Alpha Service', 'Beta Service', 'Gamma Service'].map((name) =>
    project(name, { technologies_used: ['Kafka'], raw_achievements: ['Did work'] }),
  );
  return base;
}

export interface TempInventory {
  dir: string;
  path: string;
  write(data: unknown, options?: { bom?: boolean }): void;
  touch(secondsAhead: number): void;
  cleanup(): void;
}

export function tempInventory(data: unknown = validInventory(), options: { bom?: boolean } = {}): TempInventory {
  const dir = mkdtempSync(join(tmpdir(), 'resumiq-mcp-'));
  const path = join(dir, 'inventory.json');
  const write = (next: unknown, opts: { bom?: boolean } = {}): void => {
    writeFileSync(path, `${opts.bom ? '﻿' : ''}${JSON.stringify(next, null, 2)}`, 'utf-8');
  };
  write(data, options);
  return {
    dir,
    path,
    write,
    // Filesystem mtime granularity can hide a rewrite, so tests move the clock explicitly.
    touch(secondsAhead) {
      const when = new Date(Date.now() + secondsAhead * 1000);
      utimesSync(path, when, when);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Loads a fixture through the real store and returns the snapshot. */
export function loadSnapshot(data: unknown): InventorySnapshot {
  const file = tempInventory(data);
  try {
    const result = createInventoryStore(file.path).load();
    if (!result.ok) throw new Error(`fixture failed to load: ${result.error}`);
    return result.snapshot;
  } finally {
    file.cleanup();
  }
}
