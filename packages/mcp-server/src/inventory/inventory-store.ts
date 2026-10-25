import { readFileSync, statSync } from 'fs';

import { ZodIssue } from 'zod';
import { MasterDBSchema } from '@resumiq/schemas';

import { sanitizeMessage } from '../sanitize';

import { Gap } from './gaps';
import { InventoryReadSchema, InventoryView, RawEntry } from './sections';

const MAX_SCHEMA_ISSUES = 200;
/** A career inventory is a few hundred KB; anything near this is the wrong file. */
export const MAX_INVENTORY_BYTES = 5 * 1024 * 1024;
const MAX_SHAPE_ISSUES_IN_ERROR = 5;

export interface InventorySnapshot {
  view: InventoryView;
  /** MasterDBSchema failures as {path, message}; the file is still served. */
  schemaIssues: Gap[];
  /** Oddities noticed while reading (e.g. a skills list that is a string split into characters). */
  readWarnings: Gap[];
  mtimeMs: number;
}

export type LoadResult = { ok: true; snapshot: InventorySnapshot } | { ok: false; error: string };

export interface InventoryStore {
  load(): LoadResult;
}

export interface StoreDeps {
  readFile?: (path: string) => string;
  stat?: (path: string) => { mtimeMs: number; size: number };
}

function pathToString(path: (string | number)[]): string {
  return path.reduce<string>((acc, seg, i) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    return i === 0 ? seg : `${acc}.${seg}`;
  }, '');
}

// Zod messages for enum/literal mismatches echo the received value, so only
// value-free message kinds are passed through.
function issueMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? 'missing' : `expected ${issue.expected}, received ${issue.received}`;
    case 'too_small':
    case 'too_big':
    case 'invalid_string':
      return issue.message;
    default:
      return `invalid value (${issue.code})`;
  }
}

function toGaps(issues: ZodIssue[]): Gap[] {
  return issues.slice(0, MAX_SCHEMA_ISSUES).map((issue) => {
    const path = pathToString(issue.path);
    // personal_info never leaves the server, not even in a validation message.
    const message = issue.path[0] === 'personal_info' ? 'invalid or missing' : issueMessage(issue);
    return { path, message };
  });
}

/** Skills become one entry per category; spoken_languages objects are flattened to text. */
function skillEntries(skills: Record<string, unknown>, warnings: Gap[]): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const [category, value] of Object.entries(skills)) {
    if (!Array.isArray(value)) continue;
    const items = value.flatMap((v) => {
      if (typeof v === 'string') return [v];
      if (v !== null && typeof v === 'object') {
        const { language, fluency } = v as Record<string, unknown>;
        if (typeof language === 'string') return [typeof fluency === 'string' ? `${language} (${fluency})` : language];
      }
      return [];
    });
    if (items.length > 3 && items.every((s) => s.length === 1)) {
      warnings.push({
        path: `skills.${category}`,
        message: 'looks like a string split into single characters — expected a list of skills; hidden from search',
      });
      continue;
    }
    entries.push({ name: category, items });
  }
  return entries;
}

export function createInventoryStore(path: string, deps: StoreDeps = {}): InventoryStore {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf-8'));
  const stat = deps.stat ?? ((p: string) => statSync(p));
  let cached: { mtimeMs: number; size: number; snapshot: InventorySnapshot } | undefined;

  function parse(raw: string, mtimeMs: number): LoadResult {
    // Windows editors and PowerShell often write a UTF-8 BOM, which JSON.parse rejects.
    const text = raw.replace(/^﻿/, '').trim();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // The native message can quote file content, so it is not forwarded.
      return { ok: false, error: 'Inventory file is not valid JSON' };
    }

    const read = InventoryReadSchema.safeParse(json);
    if (!read.success) {
      const detail = read.error.issues
        .slice(0, MAX_SHAPE_ISSUES_IN_ERROR)
        .map((i) => `${pathToString(i.path) || 'root'}: ${issueMessage(i)}`)
        .join('; ');
      return { ok: false, error: sanitizeMessage(`Inventory file has an unexpected shape: ${detail}`) };
    }

    const readWarnings: Gap[] = [];
    const data = read.data;
    const view: InventoryView = {
      summary: data.summaries,
      experience: data.experience,
      education: data.education,
      projects: data.projects,
      certifications: data.certifications,
      awards: data.awards_and_honors,
      volunteering: data.volunteering_and_leadership,
      skills: skillEntries(data.skills, readWarnings),
    };

    const strict = MasterDBSchema.safeParse(json);
    const schemaIssues = strict.success ? [] : toGaps(strict.error.issues);
    return { ok: true, snapshot: { view, schemaIssues, readWarnings, mtimeMs } };
  }

  return {
    load(): LoadResult {
      let info: { mtimeMs: number; size: number };
      try {
        info = stat(path);
      } catch {
        cached = undefined;
        return { ok: false, error: 'Inventory file not found or unreadable (check RESUMIQ_INVENTORY_PATH)' };
      }
      if (info.size > MAX_INVENTORY_BYTES) {
        cached = undefined;
        return { ok: false, error: 'Inventory file is too large (limit 5 MB)' };
      }
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        return { ok: true, snapshot: cached.snapshot };
      }
      let raw: string;
      try {
        raw = readFile(path);
      } catch {
        return { ok: false, error: 'Inventory file not found or unreadable (check RESUMIQ_INVENTORY_PATH)' };
      }
      const result = parse(raw, info.mtimeMs);
      if (result.ok) cached = { mtimeMs: info.mtimeMs, size: info.size, snapshot: result.snapshot };
      return result;
    },
  };
}
