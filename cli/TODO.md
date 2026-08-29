# TODO — AI Resume Generator

Current state: V1 CLI complete. 3-agent pipeline working. LaTeX rendering working. Bridge integration done.

---

## V1 Polish (quick wins — do first)

- [x] **Housekeeping:** Delete legacy files listed in ROADMAP.md

- [x] **Rewrite README.md** — setup instructions, usage table, config reference, project structure

- [x] **Resume versioning** — each run saves to `output/versions/<date>_<time>_<slug>/`

- [ ] **Gap analysis output** — after Agent 1 runs, print to console which required skills are missing from `data_inventory.json`
  - Non-blocking: still generates, just warns user upfront

- [x] **Renderer warnings** — `renderCertifications()` and `renderAwards()` now `console.warn()` on hallucinated names

- [x] **Missing DB sections** — added `spoken_languages`, `volunteering`, `publications`, `interests` to `SectionType`, `AISelection`, and renderer

- [x] **Compatibility gate** — new step after Agent 1: blocks on mandatory techs with zero DB coverage, warns on missing metrics, prints suggestions

- [x] **Match score** — Agent 3 now outputs `match_score` (0–100) + `match_reasoning`; displayed in CLI after critique pass

- [x] **Model/provider config via `.env`** — `LLM_PREFERRED` + `LLM_FALLBACK` (supports `none` to disable fallback)

---

## V1.5 — CLI Enhancements

- [x] **`--verbose` flag** — ATS keywords, section order, match reasoning, DB suggestions gated behind verbose
- [x] **`--no-critique` flag** — skip Agent 3 for fast draft iterations
- [x] **Post-generate review prompt** — asks "Edit bullets before rendering? [y/N]" after saving resume.json; opens `$EDITOR`
- [x] **`npm run validate-db`** — validates required fields, date formats, populated tech/achievement arrays
- [x] **`npm run ingest`** — AI parses raw career text → structured entry → merge into data_inventory.json
- [x] **`--pages 1|2`** — 1-page tightens Agent 2 constraints; 2-page is default

- [ ] **Multi-template support** — `--template <name>` flag; second skeleton (compact 1-page variant with tighter margins)

---

## V2 — Web App

Stack (decided in ROADMAP.md): **Next.js · NestJS · PostgreSQL (JSONB) · Clerk · Vercel · Render/Railway**

### Setup

- [ ] **Monorepo scaffold** — `apps/web` (Next.js), `apps/api` (NestJS), `packages/types` (shared TS types from `types.ts`)
- [ ] **PostgreSQL schema** — users table, career_db JSONB column, resumes table (versioned generations)
- [ ] **Clerk auth** — Next.js middleware + NestJS guard

### Core Features

- [ ] **`/dashboard`** — form UI to view and edit career DB; auto-saves to backend
- [ ] **`/generate`** — paste JD → SSE stream showing agent progress → live LaTeX preview → PDF download
- [ ] **Resume versioning UI** — list past generations with job target, date, download link
- [ ] **LaTeX compilation** — tectonic WASM in browser or tectonic microservice on backend

### Business Model (freemium per ROADMAP.md)

- [ ] Free tier: DB management + gap analysis + 2 free generations
- [ ] Credit system: pay-as-you-go ($10 / 10 resumes)
- [ ] Pro tier: $15/month unlimited

---

## V3+ (future, not prioritized)

See ROADMAP.md for V3 (match scoring + gap roadmap), V4 (job URL scraping + LinkedIn sync), V5 (mock interviews + auto-apply).

**Auto-apply pipeline (V4/V5):** job URL → scrape JD + company → generate resume → generate cover email → attach PDF → send via Gmail/SMTP. Swipe-style UX in V2 web app. Tracked in ROADMAP.md V4–V5.
