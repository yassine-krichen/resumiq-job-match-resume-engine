import { InventoryView, RawEntry, SECTION_KEYS, Section } from './sections';

export interface Gap {
  path: string;
  message: string;
}

const MAX_SHOWN_VALUE = 40;

function text(entry: RawEntry, key: string): string {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
}

function list(entry: RawEntry, key: string): string[] {
  const value = entry[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

// Same accepted shapes as cli/src/validate-db.ts: "March 2024", "2024-03", "2024-03-15", "Present".
function validDate(date: string): boolean {
  if (!date) return false;
  return /^\w+ \d{4}$/.test(date) || /^\d{4}-\d{2}(-\d{2})?$/.test(date) || date === 'Present';
}

function shown(value: string): string {
  return value.length > MAX_SHOWN_VALUE ? `${value.slice(0, MAX_SHOWN_VALUE)}…` : value;
}

/** Root section a strict-schema issue path (e.g. `projects[3].startDate`) belongs to. */
function sectionOfPath(path: string): Section | undefined {
  const root = path.split(/[.[]/)[0];
  if (root === 'skills') return 'skills';
  return (Object.entries(SECTION_KEYS).find(([, key]) => key === root)?.[0] as Section | undefined) ?? undefined;
}

/**
 * Inventory-quality checks (is the career data complete enough to source resume
 * bullets from?). A pure port of cli/src/validate-db.ts plus the extra checks
 * the MCP caller benefits from. It does not look at any registry or the repo.
 */
export function findGaps(
  view: InventoryView,
  schemaIssues: readonly Gap[],
  readWarnings: readonly Gap[],
  section?: Section,
): Gap[] {
  const gaps: Gap[] = [];
  const check = (sec: Section, condition: boolean, path: string, message: string, label?: string): void => {
    if (condition || (section && section !== sec)) return;
    gaps.push({ path, message: label ? `${message} (${label})` : message });
  };

  check('education', view.education.length > 0, 'education', 'empty — add at least one degree');
  view.education.forEach((edu, i) => {
    const label = text(edu, 'institution') || undefined;
    check('education', !!text(edu, 'institution'), `education[${i}].institution`, 'missing');
    check('education', !!text(edu, 'degree_type'), `education[${i}].degree_type`, 'missing', label);
    check('education', !!text(edu, 'major'), `education[${i}].major`, 'missing', label);
    for (const key of ['startDate', 'endDate']) {
      check('education', validDate(text(edu, key)), `education[${i}].${key}`, `invalid format "${shown(text(edu, key))}"`, label);
    }
  });

  check('experience', view.experience.length > 0, 'experience', 'empty — add at least one role');
  view.experience.forEach((exp, i) => {
    const label = text(exp, 'company') || undefined;
    check('experience', !!text(exp, 'company'), `experience[${i}].company`, 'missing');
    check('experience', !!text(exp, 'role'), `experience[${i}].role`, 'missing', label);
    check('experience', list(exp, 'technologies_used').length > 0, `experience[${i}].technologies_used`, 'empty — agents need this to verify bullet tech claims', label);
    check('experience', list(exp, 'raw_achievements').length > 0, `experience[${i}].raw_achievements`, 'empty — agents use this as source of truth for bullets', label);
    check('experience', list(exp, 'quantifiable_metrics').length > 0, `experience[${i}].quantifiable_metrics`, 'empty — no measurable results to cite', label);
    check('experience', validDate(text(exp, 'startDate')), `experience[${i}].startDate`, `invalid format "${shown(text(exp, 'startDate'))}"`, label);
  });

  view.projects.forEach((proj, i) => {
    const label = text(proj, 'name') || undefined;
    check('projects', !!text(proj, 'name'), `projects[${i}].name`, 'missing');
    check('projects', list(proj, 'technologies_used').length > 0, `projects[${i}].technologies_used`, 'empty — agents need this', label);
    check('projects', list(proj, 'raw_achievements').length > 0, `projects[${i}].raw_achievements`, 'empty — agents use this for bullet content', label);
    check('projects', list(proj, 'quantifiable_metrics').length > 0, `projects[${i}].quantifiable_metrics`, 'empty — no measurable results to cite', label);
    check('projects', list(proj, 'sources').length > 0, `projects[${i}].sources`, 'no sources — claims cannot be traced to evidence', label);
    // Project dates are optional in the working inventory; only a present-but-malformed value is a gap here.
    for (const key of ['startDate', 'endDate']) {
      const value = text(proj, key);
      check('projects', value === '' || validDate(value), `projects[${i}].${key}`, `invalid format "${shown(value)}"`, label);
    }
  });

  const languages = view.skills.find((s) => text(s, 'name') === 'programming_languages');
  check('skills', list(languages ?? {}, 'items').length > 0, 'skills.programming_languages', 'empty');

  const extra = [...readWarnings, ...schemaIssues].filter((g) => !section || sectionOfPath(g.path) === section);
  const seen = new Set(gaps.map((g) => `${g.path}\u0000${g.message}`));
  for (const g of extra) {
    const key = `${g.path}\u0000${g.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      gaps.push(g);
    }
  }
  return gaps;
}
