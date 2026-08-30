/**
 * Typst skeleton — 1:1 port of cli/templates/skeleton.tex (Jake Gutierrez-style
 * resume). Preamble defines helper functions mirroring the LaTeX \resume* macros;
 * content-builder.ts emits calls to these, just like renderer.ts emits LaTeX macro
 * calls into the %%CONTENT%% slot of the .tex skeleton.
 *
 * %%FONT_SIZE%% / %%LEADING%% / %%ITEM_SPACING%% / %%SECTION_GAP%% are substituted
 * by TypstRenderer's auto-shrink loop before each compile attempt.
 */
export const TYPST_SKELETON = `\
#set page(paper: "us-letter", margin: (x: 0.5in, top: 0.4in, bottom: 0.4in))
#set text(font: ("Libertinus Serif", "New Computer Modern"), size: %%FONT_SIZE%%pt)
#set par(leading: %%LEADING%%em, justify: false, spacing: 0.4em)
#set list(marker: [\\u{2022}], indent: 0.15in, body-indent: 0.2in, spacing: %%ITEM_SPACING%%em)

// Section heading: small-caps title + horizontal rule, mirrors \\titleformat{\\section}.
#let resume-section(title, body) = block(above: %%SECTION_GAP%%pt, below: 6pt)[
  #text(size: 12.5pt, weight: "bold")[#smallcaps[#title]]
  #v(2pt)
  #line(length: 100%, stroke: 0.6pt + black)
  #v(4pt)
  #body
]

// Two-column row: label on the left, value flush right. Mirrors the tabular*
// row used inside \\resumeSubheading / \\resumeProjectHeading.
#let entry-row(left-content, right-content) = grid(
  columns: (1fr, auto),
  column-gutter: 6pt,
  left-content, align(right)[#right-content],
)

// Org/company + role heading (2 rows). Mirrors \\resumeSubheading{a}{b}{c}{d}:
// {a}{b} = bold org, right-aligned date range. {c}{d} = italic role, italic location.
#let resume-subheading(org, daterange, role, location) = block(above: 3pt, below: 2pt)[
  #entry-row([*#org*], [#daterange])
  #entry-row(emph[#role], emph[#location])
]

// Project heading (1 row). Mirrors \\resumeProjectHeading{name $|$ tech}{date}.
#let resume-project-heading(titleline, daterange) = block(above: 3pt, below: 2pt)[
  #entry-row(titleline, daterange)
]

// Bullet list wrapper with the tight spacing the LaTeX itemize used.
#let resume-items(body) = block(above: 2pt, below: 4pt)[#body]

%%CONTENT%%
`;
