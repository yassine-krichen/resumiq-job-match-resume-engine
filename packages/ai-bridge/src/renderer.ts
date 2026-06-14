import type { AISelection, MasterDB } from './types';

// ── Date Utilities ──────────────────────────────────────────────────────────

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

// ── LaTeX Escaping ──────────────────────────────────────────────────────────

function tex(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function urlDisplay(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// ── Section Renderers ───────────────────────────────────────────────────────

function renderHeader(db: MasterDB): string {
  const p = db.personal_info;

  const linkParts = p.links.map(
    (l) => `\\href{${l.url}}{\\underline{${tex(urlDisplay(l.url))}}}`,
  );

  const contactLine = [
    tex(p.location),
    tex(p.phone),
    `\\href{mailto:${p.email}}{\\underline{${tex(p.email)}}}`,
    ...linkParts,
  ].join(' $|$ ');

  return [
    '\\begin{center}',
    `    \\textbf{\\Huge \\scshape ${tex(p.name)}} \\\\ \\vspace{1pt}`,
    `    \\small ${contactLine}`,
    '\\end{center}',
  ].join('\n');
}

function renderSummary(summary: string): string {
  return [
    '%-----------SUMMARY-----------',
    '\\section{Summary}',
    ' \\begin{itemize}[leftmargin=0.15in, label={}]',
    '    \\small{\\item{',
    `     ${tex(summary)}`,
    '    }}',
    ' \\end{itemize}',
  ].join('\n');
}

function renderEducation(db: MasterDB): string {
  const lines: string[] = [
    '%-----------EDUCATION-----------',
    '\\section{Education}',
    '  \\resumeSubHeadingListStart',
  ];

  const sortedEdu = [...db.education].sort(
    (a, b) => parseDateToSortKey(b.startDate) - parseDateToSortKey(a.startDate),
  );

  for (const edu of sortedEdu) {
    let degreeStr = `${edu.degree_type} in ${edu.major}`;
    if (edu.gpa) degreeStr += `, GPA: ${edu.gpa}`;
    const honors = edu.honors ?? [];
    if (honors.length > 0) degreeStr += ` -- ${honors.slice(0, 2).join(', ')}`;

    lines.push('    \\resumeSubheading');
    lines.push(`      {${tex(edu.institution)}}{${tex(edu.location)}}`);
    lines.push(`      {${tex(degreeStr)}}{${tex(edu.startDate)} -- ${tex(edu.endDate)}}`);
  }

  lines.push('  \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

function renderExperience(selection: AISelection, db: MasterDB): string {
  if (selection.experience.length === 0) return '';

  const lines: string[] = [
    '%-----------EXPERIENCE-----------',
    '\\section{Experience}',
    '  \\resumeSubHeadingListStart',
  ];

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
      ? `${tex(dbExp.startDate)} -- Present`
      : `${tex(dbExp.startDate)} -- ${tex(dbExp.endDate)}`;

    lines.push('');
    lines.push('    \\resumeSubheading');
    lines.push(`      {${tex(dbExp.company)}}{${dateRange}}`);
    lines.push(`      {${tex(dbExp.role)}}{${tex(dbExp.location)}}`);
    lines.push('      \\resumeItemListStart');

    for (const bullet of exp.bullets.slice(0, 4)) {
      lines.push(`        \\resumeItem{${tex(bullet)}}`);
    }

    lines.push('      \\resumeItemListEnd');
  }

  lines.push('');
  lines.push('  \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

function renderProjects(selection: AISelection, db: MasterDB): string {
  if (selection.projects.length === 0) return '';

  const lines: string[] = [
    '%-----------PROJECTS-----------',
    '\\section{Projects}',
    '    \\resumeSubHeadingListStart',
  ];

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

    const techList = tex(dbProj.technologies_used.slice(0, 6).join(', '));
    const dateRange = `${tex(dbProj.startDate)} -- ${tex(dbProj.endDate)}`;

    const repoLink = dbProj.links?.find(
      (l) => l.type === 'Repository' || l.type === 'GitHub' || l.type === 'Pull Request',
    );
    const nameLatex = repoLink
      ? `\\href{${repoLink.url}}{\\textbf{${tex(dbProj.name)}}}`
      : `\\textbf{${tex(dbProj.name)}}`;

    lines.push('      \\resumeProjectHeading');
    lines.push(`          {${nameLatex} $|$ \\emph{${techList}}}{${dateRange}}`);
    lines.push('          \\resumeItemListStart');

    for (const bullet of proj.bullets.slice(0, 3)) {
      lines.push(`            \\resumeItem{${tex(bullet)}}`);
    }

    lines.push('          \\resumeItemListEnd');
  }

  lines.push('    \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

function renderSkills(selection: AISelection): string {
  const s = selection.skills;
  const rows: string[] = [];

  if (s.languages?.length) {
    rows.push(`     \\textbf{Languages}{: ${tex(s.languages.join(', '))}}`);
  }
  if (s.frameworks_and_libraries?.length) {
    rows.push(`     \\textbf{Frameworks}{: ${tex(s.frameworks_and_libraries.join(', '))}}`);
  }
  if (s.infrastructure_and_tools?.length) {
    rows.push(`     \\textbf{Tools}{: ${tex(s.infrastructure_and_tools.join(', '))}}`);
  }
  if (s.databases?.length) {
    rows.push(`     \\textbf{Databases}{: ${tex(s.databases.join(', '))}}`);
  }

  return [
    '%-----------TECHNICAL SKILLS-----------',
    '\\section{Technical Skills}',
    ' \\begin{itemize}[leftmargin=0.15in, label={}]',
    '    \\small{\\item{',
    rows.join(' \\\\\n'),
    '    }}',
    ' \\end{itemize}',
  ].join('\n');
}

function renderCertifications(selection: AISelection, db: MasterDB): string {
  if (selection.certifications.length === 0) return '';

  const lines: string[] = [
    '%-----------CERTIFICATIONS-----------',
    '\\section{Certifications}',
    '  \\resumeSubHeadingListStart',
  ];

  for (const certName of selection.certifications) {
    const dbCert = db.certifications.find(
      (c) => c.name.toLowerCase() === certName.toLowerCase(),
    );
    if (!dbCert) {
      console.warn(`Cert "${certName}" in AI selection not found in DB — skipping`);
      continue;
    }
    lines.push('    \\resumeSubheading');
    lines.push(`      {${tex(dbCert.name)}}{${tex(dbCert.date)}}`);
    lines.push(`      {${tex(dbCert.issuer)}}{}`);
  }

  lines.push('  \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

function renderAwards(selection: AISelection, db: MasterDB): string {
  if (selection.awards.length === 0) return '';

  const lines: string[] = [
    '%-----------AWARDS-----------',
    '\\section{Awards}',
    '  \\resumeSubHeadingListStart',
  ];

  for (const awardTitle of selection.awards) {
    const dbAward = db.awards_and_honors.find(
      (a) => a.title.toLowerCase() === awardTitle.toLowerCase(),
    );
    if (!dbAward) {
      console.warn(`Award "${awardTitle}" in AI selection not found in DB — skipping`);
      continue;
    }
    lines.push('    \\resumeSubheading');
    lines.push(`      {${tex(dbAward.title)}}{${tex(dbAward.date)}}`);
    lines.push(`      {${tex(dbAward.issuer)}}{}`);
  }

  lines.push('  \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

function renderSpokenLanguages(db: MasterDB): string {
  const langs = db.skills.spoken_languages;
  if (!langs?.length) return '';

  const langStr = langs
    .map((l) => `${l.language} (${l.fluency}${l.note ? `, ${l.note}` : ''})`)
    .join(', ');

  return [
    '%-----------LANGUAGES-----------',
    '\\section{Languages}',
    ' \\begin{itemize}[leftmargin=0.15in, label={}]',
    '    \\small{\\item{',
    `     ${tex(langStr)}`,
    '    }}',
    ' \\end{itemize}',
  ].join('\n');
}

function renderVolunteering(selection: AISelection, db: MasterDB): string {
  if (!selection.volunteering?.length) return '';

  const lines: string[] = [
    '%-----------VOLUNTEERING-----------',
    '\\section{Volunteering \\& Leadership}',
    '  \\resumeSubHeadingListStart',
  ];

  for (const orgName of selection.volunteering) {
    const entry = db.volunteering_and_leadership.find(
      (v) => v.organization.toLowerCase() === orgName.toLowerCase(),
    );
    if (!entry) {
      console.warn(`Volunteering "${orgName}" in AI selection not found in DB — skipping`);
      continue;
    }

    const dateRange = entry.isCurrent
      ? `${tex(entry.startDate)} -- Present`
      : `${tex(entry.startDate)} -- ${tex(entry.endDate ?? '')}`;

    lines.push('    \\resumeSubheading');
    lines.push(`      {${tex(entry.organization)}}{${dateRange}}`);
    lines.push(`      {${tex(entry.role)}}{${tex(entry.location ?? '')}}`);

    if (entry.description) {
      lines.push('      \\resumeItemListStart');
      lines.push(`        \\resumeItem{${tex(entry.description)}}`);
      lines.push('      \\resumeItemListEnd');
    }
  }

  lines.push('  \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

function renderPublications(selection: AISelection, db: MasterDB): string {
  if (!selection.publications?.length) return '';

  const lines: string[] = [
    '%-----------PUBLICATIONS-----------',
    '\\section{Publications \\& Speaking}',
    '  \\resumeSubHeadingListStart',
  ];

  for (const title of selection.publications) {
    const entry = db.publications_and_speaking.find(
      (p) => p.title.toLowerCase() === title.toLowerCase(),
    );
    if (!entry) {
      console.warn(`Publication "${title}" in AI selection not found in DB — skipping`);
      continue;
    }

    const nameLatex = entry.url
      ? `\\href{${entry.url}}{\\underline{${tex(entry.title)}}}`
      : tex(entry.title);

    lines.push('    \\resumeSubheading');
    lines.push(`      {${nameLatex}}{${tex(entry.date)}}`);
    lines.push(`      {${tex(entry.venue ?? '')}}{}`);
  }

  lines.push('  \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

function renderInterests(db: MasterDB): string {
  if (!db.interests?.length) return '';

  return [
    '%-----------INTERESTS-----------',
    '\\section{Interests}',
    ' \\begin{itemize}[leftmargin=0.15in, label={}]',
    '    \\small{\\item{',
    `     ${tex(db.interests.join(', '))}`,
    '    }}',
    ' \\end{itemize}',
  ].join('\n');
}

// ── Main Render ─────────────────────────────────────────────────────────────

function buildContent(selection: AISelection, db: MasterDB): string {
  const sections: string[] = [];

  sections.push(renderHeader(db));
  sections.push('');

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
 * Renders an AISelection + MasterDB into a complete LaTeX document string.
 * Pass the skeleton template content (not a path) — load it once at service startup.
 */
export function render(selection: AISelection, db: MasterDB, skeletonContent: string): string {
  if (!skeletonContent.includes('%%CONTENT%%')) {
    throw new Error('skeleton.tex missing %%CONTENT%% placeholder');
  }
  const content = buildContent(selection, db);
  return skeletonContent.replace('%%CONTENT%%', content);
}
