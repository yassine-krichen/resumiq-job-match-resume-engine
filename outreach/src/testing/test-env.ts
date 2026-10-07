import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { buildTrackTailoring } from '../core/track-selection';
import { parseAppConfig } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { outreachPaths } from '../config/paths';
import type { OutreachPaths } from '../config/paths';
import { MasterDBSchema } from '../resume/master-db';
import type { MasterDB } from '../resume/master-db';
import type { RenderResult } from '../resume/latex-renderer';
import type { ResumeRenderer } from '../services/resume.service';
import { snapshotUrl } from '../services/snapshot.service';
import { RunLayout, slugForDomainKey, trackResumePath, writeJsonAtomic } from '../services/run-layout';

const PACKAGE_ROOT = resolve(__dirname, '..', '..');

export function loadExampleConfig(): AppConfig {
  return parseAppConfig(readFileSync(join(PACKAGE_ROOT, 'outreach.config.example.json'), 'utf-8'), PACKAGE_ROOT);
}

export function loadExampleInventory(): MasterDB {
  return MasterDBSchema.parse(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'examples', 'data-inventory.example.json'), 'utf-8')));
}

/** A throwaway outreach/ root with the three track PDFs already "built". */
export function createTempPaths(): OutreachPaths {
  const root = mkdtempSync(join(tmpdir(), 'outreach-test-'));
  const paths = outreachPaths(root);
  for (const track of ['ai', 'swe', 'fullstack']) {
    const file = trackResumePath(paths, track);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `%PDF-fake ${track}`);
  }
  return paths;
}

export class FakeRenderer implements ResumeRenderer {
  calls = 0;

  constructor(
    private readonly options: { pageCount?: number; bytes?: number; fail?: string } = {},
  ) {}

  async render(): Promise<RenderResult> {
    this.calls += 1;
    if (this.options.fail) throw new Error(this.options.fail);
    return {
      pdf: Buffer.alloc(this.options.bytes ?? 2000, 'x'),
      pageCount: this.options.pageCount ?? 1,
      source: '\\documentclass{article}',
    };
  }
}

export function layoutFor(paths: OutreachPaths, runId = 'run-1'): RunLayout {
  return new RunLayout(paths, runId);
}

export function rawRow(domain: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { company: `Company ${domain}`, email: `claire@${domain}`, ...overrides };
}

export function slugFor(domain: string): string {
  return slugForDomainKey(domain);
}

export async function writeCompanyFile(layout: RunLayout, slug: string, name: 'dossier' | 'tailoring' | 'draft', value: unknown): Promise<void> {
  await writeJsonAtomic(layout.companyFile(slug, name), value);
}

export const QUOTE = 'Today we are open-sourcing the Acme fleet scheduler for warehouses.';

/** Saves a snapshot through the real snapshot service with a canned page, and returns its id. */
export async function seedSnapshot(layout: RunLayout, slug: string, url = 'https://acme.example/blog'): Promise<string> {
  const fetchFn = async (): Promise<Response> =>
    new Response(`<html><body><p>${QUOTE}</p><p>Acme builds robots for warehouses all over Europe.</p></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  const saved = await snapshotUrl(url, layout.snapshotsDir(slug), {
    fetchFn: fetchFn as unknown as typeof fetch,
    resolveHost: async () => ['93.184.216.34'],
  });
  return saved.snapshotId;
}

export function dossierFor(snapshotId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company: 'Acme Robotics',
    one_liner: 'warehouse robots',
    hq_city: 'Paris',
    contact_name: 'Claire Martin',
    tech_stack: ['Rust'],
    country: 'FR',
    language: 'en',
    timezone: 'Europe/Paris',
    claims: [
      { id: 'c1', text: 'Acme open-sources its fleet scheduler', url: 'https://acme.example/blog', snapshot_id: snapshotId, quote: QUOTE },
    ],
    fit: { score: 4, reasons: ['Python and infrastructure overlap'], track: 'ai' },
    ...overrides,
  };
}

export const WRITER_DRAFT = {
  subject: 'Your open-sourced fleet scheduler',
  body:
    'Hi Claire, I saw that Acme Robotics is open-sourcing its fleet scheduler for warehouses, and the focus on real warehouse workloads ' +
    'stood out to me. I built DocuAsk, a RAG assistant that chunked and embedded 3,500 pages of documentation, so careful data ' +
    'handling at scale matters to me. I can commit about 20 hours a week, starting October 12, or join you for a summer 2027 ' +
    'internship. My working hours overlap fully with Paris and Berlin. Would you be open to a short call this week?',
  follow_up_body:
    'Hi Claire, one more thought on the scheduler: DocuAsk had to cite the exact source page for every answer, and I would enjoy ' +
    'applying the same rigour to your tooling. I am happy to adapt to your calendar if a short call is easier next week. ' +
    'Thanks for reading.',
  cta: 'Would you be open to a short call this week?',
  hook_claim_id: 'c1',
  anchor_phrase: "open-sourcing its fleet scheduler",
  mentioned_projects: ['DocuAsk'],
  generic: false,
};

export function writerTailoring(): unknown {
  return buildTrackTailoring(loadExampleInventory(), loadExampleConfig().tracks.ai);
}
