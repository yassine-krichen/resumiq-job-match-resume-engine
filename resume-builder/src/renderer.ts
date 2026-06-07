import { readFileSync } from 'fs';
import type { AISelection, MasterDB } from './types';

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

  for (const edu of db.education) {
    let degreeStr = `${edu.degree_type} in ${edu.major}`;
    if (edu.gpa) degreeStr += `, GPA: ${edu.gpa}`;
    if (edu.honors.length > 0) degreeStr += ` -- ${edu.honors.join(', ')}`;

    // Education: {Institution}{Location} / {Degree + GPA}{Start -- End}
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

  for (const exp of selection.experience) {
    const dbExp = db.experience.find(
      (e) => e.company.toLowerCase() === exp.company.toLowerCase(),
    );
    if (!dbExp) {
      throw new Error(
        `Experience "${exp.company}" in AI selection not found in database.\n` +
          `Available: ${db.experience.map((e) => e.company).join(', ')}`,
      );
    }

    const dateRange = dbExp.isCurrent
      ? `${tex(dbExp.startDate)} -- Present`
      : `${tex(dbExp.startDate)} -- ${tex(dbExp.endDate)}`;

    // Experience: {Company}{Start -- End} / {Role}{Location}
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
      (p) => p.name.toLowerCase() === proj.name.toLowerCase(),
    );
    if (!dbProj) {
      throw new Error(
        `Project "${proj.name}" in AI selection not found in database.\n` +
          `Available: ${db.projects.map((p) => p.name).join(', ')}`,
      );
    }

    const techList = tex(dbProj.technologies_used.join(', '));
    const dateRange = `${tex(dbProj.startDate)} -- ${tex(dbProj.endDate)}`;

    const repoLink = dbProj.links.find(
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
    if (!dbCert) continue; // AI hallucinated cert name — skip silently

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
    if (!dbAward) continue;

    lines.push('    \\resumeSubheading');
    lines.push(`      {${tex(dbAward.title)}}{${tex(dbAward.date)}}`);
    lines.push(`      {${tex(dbAward.issuer)}}{}`);
  }

  lines.push('  \\resumeSubHeadingListEnd');
  return lines.join('\n');
}

// ── Main Render ─────────────────────────────────────────────────────────────

function buildContent(selection: AISelection, db: MasterDB): string {
  const sections: string[] = [];

  sections.push(renderHeader(db));
  sections.push('');

  if (selection.summary) {
    sections.push(renderSummary(selection.summary));
  }

  // Ensure education always appears even if AI forgot it in section_order
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
      case 'summary':
        break; // already rendered above if present
    }
    if (rendered) sections.push(rendered);
  }

  return sections.join('\n\n');
}

export function render(
  selection: AISelection,
  db: MasterDB,
  skeletonPath: string,
): string {
  const skeleton = readFileSync(skeletonPath, 'utf-8');
  if (!skeleton.includes('%%CONTENT%%')) {
    throw new Error(`skeleton.tex missing %%CONTENT%% placeholder at ${skeletonPath}`);
  }
  const content = buildContent(selection, db);
  return skeleton.replace('%%CONTENT%%', content);
}
