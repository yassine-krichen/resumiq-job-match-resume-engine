import { projectEntry } from './redact';
import { InventoryView, RawEntry, SECTIONS, Section } from './sections';

export interface IndexField {
  name: string;
  items: string[];
}

export interface IndexedEntry {
  section: Section;
  index: number;
  /** `<section>:<index>`; stable only while the inventory file is unchanged. */
  id: string;
  /** Primary name (project name, company, institution, ...), used for exact lookup. */
  name: string;
  /** Human label, e.g. "Backend Engineer at Acme". */
  title: string;
  fields: IndexField[];
  sources: string[];
  /** Allow-listed projection, safe to return to the caller. */
  entry: RawEntry;
}

const NOT_SEARCHABLE = new Set([
  'startDate',
  'endDate',
  'isCurrent',
  'links',
  'live_urls',
  'link',
  'source',
  'sources',
  'gpa',
  'status',
]);

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function join(parts: unknown[], separator: string): string {
  return parts.map(str).filter(Boolean).join(separator);
}

function nameAndTitle(section: Section, e: RawEntry): { name: string; title: string } {
  switch (section) {
    case 'summary':
      return { name: str(e.target_role), title: str(e.target_role) };
    case 'experience':
      return { name: str(e.company), title: join([e.role, e.company], ' at ') };
    case 'education':
      return {
        name: str(e.institution),
        title: join([join([e.degree_type, e.major], ' '), e.institution], ' at '),
      };
    case 'projects':
      return { name: str(e.name), title: str(e.name) };
    case 'certifications':
      return { name: str(e.name), title: str(e.name) };
    case 'awards':
      return { name: str(e.title), title: str(e.title) };
    case 'volunteering':
      return { name: str(e.organization), title: join([e.role, e.organization], ' at ') };
    case 'skills':
      return { name: str(e.name), title: str(e.name) };
  }
}

function toField(name: string, value: unknown): IndexField | undefined {
  if (typeof value === 'string') return { name, items: [value] };
  if (Array.isArray(value)) return { name, items: value.filter((v): v is string => typeof v === 'string') };
  return undefined;
}

function buildEntry(section: Section, index: number, raw: RawEntry): IndexedEntry {
  const projected = projectEntry(section, raw);
  const labels = nameAndTitle(section, projected);
  const name = labels.name || `${section} ${index}`;
  const title = labels.title || name;
  const id = `${section}:${index}`;

  const fields: IndexField[] = [{ name: 'title', items: [...new Set([name, title])] }];
  for (const [key, value] of Object.entries(projected)) {
    if (NOT_SEARCHABLE.has(key)) continue;
    // Skill lists rank like technologies_used; the category name is already the title.
    const fieldName = section === 'skills' && key === 'items' ? 'technologies_used' : key;
    const field = toField(fieldName, value);
    if (field && field.items.length > 0) fields.push(field);
  }

  const sources = [
    ...((projected.sources as string[] | undefined) ?? []),
    ...(typeof projected.source === 'string' ? [projected.source] : []),
  ];

  return { section, index, id, name, title, fields, sources, entry: { id, section, name, ...projected } };
}

const cache = new WeakMap<InventoryView, IndexedEntry[]>();

/** Flat index of every exposed entry; memoised per loaded inventory snapshot. */
export function buildIndex(view: InventoryView): IndexedEntry[] {
  const cached = cache.get(view);
  if (cached) return cached;
  const index = SECTIONS.flatMap((section) => view[section].map((raw, i) => buildEntry(section, i, raw)));
  cache.set(view, index);
  return index;
}
