import { RawEntry, Section } from './sections';

type FieldKind = 'text' | 'list' | 'flag' | 'links';

/**
 * Allow-list projection: only fields named here can leave the server.
 * Anything new in the inventory stays hidden until it is added on purpose.
 * Deliberately absent: personal_info (not a section at all) and
 * certifications.credential_id.
 */
const ALLOWED_FIELDS: Record<Section, Record<string, FieldKind>> = {
  summary: { target_role: 'text', content: 'text' },
  experience: {
    company: 'text',
    company_industry: 'text',
    role: 'text',
    location: 'text',
    location_type: 'text',
    startDate: 'text',
    endDate: 'text',
    isCurrent: 'flag',
    description: 'text',
    core_competencies: 'list',
    technologies_used: 'list',
    raw_achievements: 'list',
    quantifiable_metrics: 'list',
    sources: 'list',
    live_urls: 'list',
  },
  education: {
    institution: 'text',
    degree_type: 'text',
    major: 'text',
    minor: 'text',
    location: 'text',
    startDate: 'text',
    endDate: 'text',
    gpa: 'text',
    thesis_or_capstone: 'text',
    description: 'text',
    honors: 'list',
    relevant_coursework: 'list',
    extracurriculars: 'list',
  },
  projects: {
    name: 'text',
    tagline: 'text',
    status: 'text',
    context: 'text',
    startDate: 'text',
    endDate: 'text',
    technologies_used: 'list',
    core_competencies: 'list',
    raw_achievements: 'list',
    quantifiable_metrics: 'list',
    sources: 'list',
    links: 'links',
  },
  certifications: {
    name: 'text',
    issuer: 'text',
    date: 'text',
    expiration_date: 'text',
    link: 'text',
    description: 'text',
    source: 'text',
    cluster: 'text',
    skills_validated: 'list',
  },
  awards: {
    title: 'text',
    issuer: 'text',
    date: 'text',
    description: 'text',
    related_skills: 'list',
    sources: 'list',
  },
  volunteering: {
    organization: 'text',
    role: 'text',
    location: 'text',
    startDate: 'text',
    endDate: 'text',
    isCurrent: 'flag',
    description: 'text',
    core_competencies: 'list',
    technologies_used: 'list',
    raw_achievements: 'list',
    sources: 'list',
  },
  skills: { name: 'text', items: 'list' },
};

function project(kind: FieldKind, value: unknown): unknown {
  switch (kind) {
    case 'text':
      return typeof value === 'string' && value.trim() !== '' ? value : undefined;
    case 'flag':
      return typeof value === 'boolean' ? value : undefined;
    case 'list': {
      if (!Array.isArray(value)) return undefined;
      const items = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
      return items.length > 0 ? items : undefined;
    }
    case 'links': {
      if (!Array.isArray(value)) return undefined;
      const links = value.flatMap((v) => {
        if (v === null || typeof v !== 'object') return [];
        const { type, url } = v as Record<string, unknown>;
        return typeof url === 'string' ? [{ type: typeof type === 'string' ? type : '', url }] : [];
      });
      return links.length > 0 ? links : undefined;
    }
  }
}

const MIN_CREDENTIAL_ID_LENGTH = 4;

function mentions(value: unknown, needle: string): boolean {
  return JSON.stringify(value).includes(needle);
}

/** Returns a new object holding only allow-listed, well-typed, non-empty fields. */
export function projectEntry(section: Section, raw: RawEntry): RawEntry {
  // Verification links usually embed the credential id, which would undo stripping it.
  const credentialId =
    section === 'certifications' && typeof raw.credential_id === 'string' ? raw.credential_id.trim() : '';
  const out: RawEntry = {};
  for (const [field, kind] of Object.entries(ALLOWED_FIELDS[section])) {
    const value = project(kind, raw[field]);
    if (value === undefined) continue;
    if (credentialId.length >= MIN_CREDENTIAL_ID_LENGTH && mentions(value, credentialId)) continue;
    out[field] = value;
  }
  return out;
}
