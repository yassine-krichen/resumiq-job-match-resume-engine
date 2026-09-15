import type { AISelection, MasterDB } from '@resumiq/ai-bridge';
import { typ, typStr } from './escape';

// ── Date Utilities (mirrors ai-bridge/src/renderer.ts) ──────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDateToSortKey(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const parts = dateStr.trim().toLowerCase().split(/\s+/);
  const month = MONTHS[parts[0]?.slice(0, 3)] ?? 0;
  const year = parseInt(parts[1] ?? '0', 10);
  return year * 100 + month;
}

function urlDisplay(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// ── Section Renderers ───────────────────────────────────────────────────────

function renderHeader(db: MasterDB): string {
  const p = db.personal_info;

  const linkParts = p.links.map(
    (l) => `#link("${typStr(l.url)}")[#underline[${typ(urlDisplay(l.url))}]]`,
  );

  const contactLine = [
    typ(p.location),
    typ(p.phone),
    `#link("mailto:${typStr(p.email)}")[#underline[${typ(p.email)}]]`,
    ...linkParts,
  ].join(' | ');

  return [
    '#align(center)[',
    `  #text(size: 24pt, weight: "bold")[#smallcaps[${typ(p.name)}]] \\`,
    `  #text(size: 9.5pt)[${contactLine}]`,
    ']',
  ].join('\n');
}

function renderSummary(summary: string): string {
  return `#resume-section[Summary][\n  #text(size: 10.5pt)[${typ(summary)}]\n]`;
}

function renderEducation(db: MasterDB): string {
  const sortedEdu = [...db.education].sort(
    (a, b) => parseDateToSortKey(b.startDate) - parseDateToSortKey(a.startDate),
  );

  const entries = sortedEdu.map((edu) => {
    let degreeStr = edu.degree_type ? `${edu.degree_type} in ${edu.major}` : edu.major;
    if (edu.gpa) degreeStr += `, GPA: ${edu.gpa}`;
    const honors = edu.honors ?? [];
    if (honors.length > 0) degreeStr += ` -- ${honors.slice(0, 2).join(', ')}`;

    return [
      `  #resume-subheading(`,
      `    [${typ(edu.institution)}], [${typ(edu.startDate)} -- ${typ(edu.endDate)}],`,
      `    [${typ(degreeStr)}], [${typ(edu.location)}],`,
      `  )`,
    ].join('\n');
  });

  return `#resume-section[Education][\n${entries.join('\n')}\n]`;
}

function renderExperience(selection: AISelection, db: MasterDB): string {
  if (selection.experience.length === 0) return '';

  const sorted = [...selection.experience].sort((a, b) => {
    const dbA = db.experience.find(
      (e) =>
        e.company.toLowerCase().includes(a.company.toLowerCase()) ||
        a.company.toLowerCase().includes(e.company.toLowerCase()),
    );
    const dbB = db.experience.find(
      (e) =>
        e.company.toLowerCase().includes(b.company.toLowerCase()) ||
        b.company.toLowerCase().includes(e.company.toLowerCase()),
    );
    return parseDateToSortKey(dbB?.startDate) - parseDateToSortKey(dbA?.startDate);
  });

  const entries: string[] = [];

  for (const exp of sorted) {
    const dbExp = db.experience.find(
      (e) =>
        e.company.toLowerCase() === exp.company.toLowerCase() ||
        e.company.toLowerCase().includes(exp.company.toLowerCase()) ||
        exp.company.toLowerCase().includes(e.company.toLowerCase()),
    );
    if (!dbExp) {
      console.warn(
        `Experience "${exp.company}" in AI selection not found in DB — skipping.\n` +
          `  Available: ${db.experience.map((e) => e.company).join(', ')}`,
      );
      continue;
    }

    const dateRange = dbExp.isCurrent
      ? `${typ(dbExp.startDate)} -- Present`
      : `${typ(dbExp.startDate)} -- ${typ(dbExp.endDate)}`;

    const bullets = exp.bullets
      .slice(0, 4)
      .map((bullet) => `  - ${typ(bullet)}`)
      .join('\n');

    entries.push(
      [
        `  #resume-subheading(`,
        `    [${typ(dbExp.company)}], [${dateRange}],`,
        `    [${typ(dbExp.role)}], [${typ(dbExp.location)}],`,
        `  )`,
        `  #resume-items[`,
        bullets,
        `  ]`,
      ].join('\n'),
    );
  }

  return `#resume-section[Experience][\n${entries.join('\n')}\n]`;
}

function renderProjects(selection: AISelection, db: MasterDB): string {
  if (selection.projects.length === 0) return '';

  const entries: string[] = [];

  for (const proj of selection.projects) {
    const dbProj = db.projects.find(
      (p) =>
        p.name.toLowerCase() === proj.name.toLowerCase() ||
        p.name.toLowerCase().includes(proj.name.toLowerCase()) ||
        proj.name.toLowerCase().includes(p.name.toLowerCase()),
    );
    if (!dbProj) {
      console.warn(
        `Project "${proj.name}" in AI selection not found in DB — skipping.\n` +
          `  Available: ${db.projects.map((p) => p.name).join(', ')}`,
      );
      continue;
    }

    const techList = typ(dbProj.technologies_used.slice(0, 6).join(', '));
    const dateRange = `${typ(dbProj.startDate)} -- ${typ(dbProj.endDate)}`;

    const repoLink = dbProj.links?.find(
      (l) => l.type === 'Repository' || l.type === 'GitHub' || l.type === 'Pull Request',
    );
    const nameLine = repoLink
      ? `[#link("${typStr(repoLink.url)}")[*${typ(dbProj.name)}*] | #emph[${techList}]]`
      : `[*${typ(dbProj.name)}* | #emph[${techList}]]`;

    const bullets = proj.bullets
      .slice(0, 3)
      .map((bullet) => `  - ${typ(bullet)}`)
      .join('\n');

    entries.push(
      [
        `  #resume-project-heading(${nameLine}, [${dateRange}])`,
        `  #resume-items[`,
        bullets,
        `  ]`,
      ].join('\n'),
    );
  }

  return `#resume-section[Projects][\n${entries.join('\n')}\n]`;
}

function renderSkills(selection: AISelection): string {
  const s = selection.skills;
  const rows: string[] = [];

  if (s.languages?.length) {
    rows.push(`*Languages*: ${typ(s.languages.join(', '))}`);
  }
  if (s.frameworks_and_libraries?.length) {
    rows.push(`*Frameworks*: ${typ(s.frameworks_and_libraries.join(', '))}`);
  }
  if (s.infrastructure_and_tools?.length) {
    rows.push(`*Tools*: ${typ(s.infrastructure_and_tools.join(', '))}`);
  }
  if (s.databases?.length) {
    rows.push(`*Databases*: ${typ(s.databases.join(', '))}`);
  }

  const body = rows.map((r) => `  ${r} \\`).join('\n');
  return `#resume-section[Technical Skills][\n  #text(size: 10.5pt)[\n${body}\n  ]\n]`;
}

function renderCertifications(selection: AISelection, db: MasterDB): string {
  if (selection.certifications.length === 0) return '';

  const entries: string[] = [];

  for (const certName of selection.certifications) {
    const dbCert = db.certifications.find(
      (c) => c.name.toLowerCase() === certName.toLowerCase(),
    );
    if (!dbCert) {
      console.warn(`Cert "${certName}" in AI selection not found in DB — skipping`);
      continue;
    }
    entries.push(
      [
        `  #resume-subheading(`,
        `    [${typ(dbCert.name)}], [${typ(dbCert.date)}],`,
        `    [${typ(dbCert.issuer)}], [],`,
        `  )`,
      ].join('\n'),
    );
  }

  return `#resume-section[Certifications][\n${entries.join('\n')}\n]`;
}

function renderAwards(selection: AISelection, db: MasterDB): string {
  if (selection.awards.length === 0) return '';

  const entries: string[] = [];

  for (const awardTitle of selection.awards) {
    const dbAward = db.awards_and_honors.find(
      (a) => a.title.toLowerCase() === awardTitle.toLowerCase(),
    );
    if (!dbAward) {
      console.warn(`Award "${awardTitle}" in AI selection not found in DB — skipping`);
      continue;
    }
    entries.push(
      [
        `  #resume-subheading(`,
        `    [${typ(dbAward.title)}], [${typ(dbAward.date)}],`,
        `    [${typ(dbAward.issuer)}], [],`,
        `  )`,
      ].join('\n'),
    );
  }

  return `#resume-section[Awards][\n${entries.join('\n')}\n]`;
}

function renderSpokenLanguages(db: MasterDB): string {
  const langs = db.skills.spoken_languages;
  if (!langs?.length) return '';

  const langStr = langs
    .map((l) => `${l.language} (${l.fluency}${l.note ? `, ${l.note}` : ''})`)
    .join(', ');

  return `#resume-section[Languages][\n  #text(size: 10.5pt)[${typ(langStr)}]\n]`;
}

function renderVolunteering(selection: AISelection, db: MasterDB): string {
  if (!selection.volunteering?.length) return '';

  const entries: string[] = [];

  for (const orgName of selection.volunteering) {
    const entry = db.volunteering_and_leadership.find(
      (v) => v.organization.toLowerCase() === orgName.toLowerCase(),
    );
    if (!entry) {
      console.warn(`Volunteering "${orgName}" in AI selection not found in DB — skipping`);
      continue;
    }

    const dateRange = entry.isCurrent
      ? `${typ(entry.startDate)} -- Present`
      : `${typ(entry.startDate)} -- ${typ(entry.endDate ?? '')}`;

    const lines = [
      `  #resume-subheading(`,
      `    [${typ(entry.organization)}], [${dateRange}],`,
      `    [${typ(entry.role)}], [${typ(entry.location ?? '')}],`,
      `  )`,
    ];

    if (entry.description) {
      lines.push(`  #resume-items[\n    - ${typ(entry.description)}\n  ]`);
    }

    entries.push(lines.join('\n'));
  }

  return `#resume-section[Volunteering \\& Leadership][\n${entries.join('\n')}\n]`;
}

function renderPublications(selection: AISelection, db: MasterDB): string {
  if (!selection.publications?.length) return '';

  const entries: string[] = [];

  for (const title of selection.publications) {
    const entry = db.publications_and_speaking.find(
      (p) => p.title.toLowerCase() === title.toLowerCase(),
    );
    if (!entry) {
      console.warn(`Publication "${title}" in AI selection not found in DB — skipping`);
      continue;
    }

    const nameLine = entry.url
      ? `[#link("${typStr(entry.url)}")[#underline[${typ(entry.title)}]]]`
      : `[${typ(entry.title)}]`;

    entries.push(
      [
        `  #resume-subheading(`,
        `    ${nameLine}, [${typ(entry.date)}],`,
        `    [${typ(entry.venue ?? '')}], [],`,
        `  )`,
      ].join('\n'),
    );
  }

  return `#resume-section[Publications \\& Speaking][\n${entries.join('\n')}\n]`;
}

function renderInterests(db: MasterDB): string {
  if (!db.interests?.length) return '';

  return `#resume-section[Interests][\n  #text(size: 10.5pt)[${typ(db.interests.join(', '))}]\n]`;
}

// ── Main Build ───────────────────────────────────────────────────────────────

function buildContent(selection: AISelection, db: MasterDB): string {
  const sections: string[] = [];

  sections.push(renderHeader(db));

  if (selection.summary) {
    sections.push(renderSummary(selection.summary));
  }

  const order: typeof selection.section_order = selection.section_order.includes('education')
    ? selection.section_order
    : ['education', ...selection.section_order];

  for (const sectionType of order) {
    let rendered = '';
    switch (sectionType) {
      case 'education':
        rendered = renderEducation(db);
        break;
      case 'experience':
        rendered = renderExperience(selection, db);
        break;
      case 'projects':
        rendered = renderProjects(selection, db);
        break;
      case 'skills':
        rendered = renderSkills(selection);
        break;
      case 'certifications':
        rendered = renderCertifications(selection, db);
        break;
      case 'awards':
        rendered = renderAwards(selection, db);
        break;
      case 'spoken_languages':
        rendered = renderSpokenLanguages(db);
        break;
      case 'volunteering':
        rendered = renderVolunteering(selection, db);
        break;
      case 'publications':
        rendered = renderPublications(selection, db);
        break;
      case 'interests':
        rendered = renderInterests(db);
        break;
      case 'summary':
        break; // already rendered above if present
    }
    if (rendered) sections.push(rendered);
  }

  return sections.join('\n\n');
}

/**
 * Builds a full Typst document string from an AISelection + MasterDB, injected
 * into the %%CONTENT%% slot of the given skeleton. Font-size/spacing placeholders
 * in the skeleton are left untouched — TypstRenderer's shrink loop fills those in.
 */
export function buildTypstDocument(
  selection: AISelection,
  db: MasterDB,
  skeletonContent: string,
): string {
  if (!skeletonContent.includes('%%CONTENT%%')) {
    throw new Error('Typst skeleton missing %%CONTENT%% placeholder');
  }
  const content = buildContent(selection, db);
  return skeletonContent.replace('%%CONTENT%%', content);
}
