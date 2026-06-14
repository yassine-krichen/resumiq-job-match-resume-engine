# AI Resume Generator

Local CLI that generates tailored, ATS-optimized LaTeX resumes from a career database and a job description.

Paste a job posting → 3-agent AI pipeline analyzes, selects, and critiques content from your DB → outputs a compiled PDF.

---

## How It Works

```
input/job.txt + data_inventory.json
        ↓
Agent 1: Analyze job → JobDNA (title, seniority, ATS keywords, culture)
        ↓
Compatibility check → blocks if mandatory tech has zero DB coverage
        ↓
Agent 2: Select content + draft bullets (respects DB facts, no invented metrics)
        ↓
Agent 3: Critique + revise (so-what test, metric tracing, verb quality)
        ↓
output/resume.json  →  output/resume.tex  →  output/resume.pdf
```

Every run saves a versioned copy under `output/versions/`.

---

## Prerequisites

- **Node.js 18+**
- **[claude-web-bridge](https://github.com/yassine-kr/claude-web-bridge)** running locally (provides Claude + ChatGPT via browser automation — no API key needed)
- **LaTeX compiler** (optional): [tectonic](https://tectonic-typesetting.github.io) or pdflatex. If neither is present, the CLI prints Overleaf upload instructions.

---

## Setup

```bash
cd resume-builder
cp .env.example .env          # edit BRIDGE_URL if bridge runs on a different port
npm install
```

Start `claude-web-bridge` in a separate terminal:

```bash
cd <bridge-dir>
npm run dev
```

---

## Usage

### Generate a resume

1. Edit `data_inventory.json` with your career data (run `npm run validate-db` to check it).
2. Paste the job description into `input/job.txt`.
3. Optionally paste company context into `input/company.txt`.

```bash
npm run generate
```

Flags:
| Flag | Effect |
|------|--------|
| `--verbose` | Show ATS keywords, section order, match reasoning, DB suggestions |
| `--no-critique` | Skip Agent 3 (faster, lower quality) |
| `--pages 1` | 1-page mode: tighter bullet limits, no optional sections |
| `--pages 2` | Default — targets two pages |

After generation, the CLI prompts to open `output/resume.json` for manual bullet edits before rendering.

### Re-render after manual edits

```bash
npm run render
```

Reads `output/resume.json`, re-renders LaTeX, recompiles PDF. No AI calls.

### Validate your career database

```bash
npm run validate-db
```

Checks required fields, date formats, and that `technologies_used` / `raw_achievements` are populated (agents depend on these).

### Add new data to the database

```bash
npm run ingest
```

Paste raw career text (job recap, project notes, LinkedIn export snippet) → AI parses into a structured entry → confirms before merging into `data_inventory.json`.

---

## Configuration (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_URL` | `http://127.0.0.1:3000` | claude-web-bridge server URL |
| `LLM_PREFERRED` | `claude` | First provider to try (`claude` or `chatgpt`) |
| `LLM_FALLBACK` | `chatgpt` | Fallback provider (`claude`, `chatgpt`, or `none`) |
| `EDITOR` | `notepad` / `vi` | Editor opened for post-generate bullet review |

---

## Career Database Schema

`data_inventory.json` at the project root. Full TypeScript interfaces in `resume-builder/src/types.ts`.

Key fields agents rely on:
- `experience[].technologies_used` — verified against bullet tech claims
- `experience[].raw_achievements` — source of truth for bullet content
- `experience[].quantifiable_metrics` — only numbers that appear here can appear in bullets
- `projects[].technologies_used` — same verification

---

## Output

| File | Description |
|------|-------------|
| `output/resume.json` | AI selection (editable before re-render) |
| `output/resume.tex` | LaTeX source |
| `output/resume.pdf` | Compiled PDF (if compiler present) |
| `output/versions/<date>_<time>_<role>/` | Versioned copy of each generation |

---

## Project Structure

```
resume-builder/
  src/
    cli.ts           — orchestrator: flags, pipeline, versioning
    agents.ts        — 3 AI agents + compatibility check
    llm.ts           — bridge HTTP client, provider fallback, JSON extraction
    renderer.ts      — LaTeX section builders
    types.ts         — TypeScript interfaces (MasterDB, AISelection, JobDNA...)
    validate-db.ts   — DB validator script
    ingest.ts        — AI-powered DB ingestion script
  templates/
    skeleton.tex     — LaTeX preamble + macros
  input/
    job.txt          — paste job description here
    company.txt      — optional company context
  output/            — generated files (gitignored)
```

See `ROADMAP.md` for V2 (web app), V3 (gap analysis), V4 (job scraping), V5 (auto-apply).
