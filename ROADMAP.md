# Roadmap — AI Resume Generator

V1 is a local CLI: paste job offer → AI selects + tailors content from your DB → fills LaTeX template → PDF.

---

## V2: Web App

**Stack (decided):** Next.js (frontend) · NestJS (backend) · PostgreSQL w/ JSONB (user DBs) · Clerk (auth)
**Hosting:** Vercel (frontend) · Render/Railway (backend)

**Core features:**
- User accounts + persisted career DB (JSONB columns)
- `/dashboard` — view/edit DB via form UI, auto-saves to backend
- `/generate` — paste JD, see SSE stream progress ("Analyzing job…", "Selecting content…", "Drafting bullets…")
- Live `.tex` preview (WASM tectonic in browser or tectonic microservice)
- One-click PDF download
- Resume versioning — store past generations with their job target

**Business model (freemium / credit-based):**
- Free tier: DB management + gap analysis + 1–2 free generations
- Pay-as-you-go: $10 / 10 resumes
- Pro: $15/month, unlimited generations + priority AI

---

## V3: Intelligent Matching & Career Coaching

- Match score (job DNA vs DB) with gap analysis
- "Underqualified" flow: halt generation, prescribe concrete steps ("Build a React project", "Get AWS cert")
- "Dream Job" mode: user inputs target role → AI gives a 30/60/90-day roadmap to close the gap
- DB strength score: how complete/strong is your data per section

---

## V4: Application Ecosystem

- **Job fetching:** paste a URL → scrape JD + company info automatically (Greenhouse, Lever, LinkedIn)
- **LinkedIn sync:** ingest new roles/skills from LinkedIn data export into DB
- **Holistic readiness check:** review GitHub, portfolio, LinkedIn presence; flag what's missing before applying
- **Cold outreach templates:** email + LinkedIn message generators per job

---

## V5: Interview & Analytics

- **Mock interview simulator:** voice or text, tailored to the generated resume + company interview style (FAANG behavioral, technical, etc.)
- **Application tracker:** log applied jobs, store resume version used
- **Analytics:** resume score vs interview rate, section performance insights
- **Auto-apply agent:** navigate ATS portals (Workday, Lever) and submit on the user's behalf

---

## Files to delete once V2 scaffolding starts

- `ai_features_bulletpoints.txt` — brain dump, superseded by this file
- `resume-builder/product_specification.md` — superseded by this file
- `resume-builder/system_design.md` — superseded by this file (stack decided above)
- `resume_template.tex` (root) — Jake placeholder, not used
- `resume-builder/resume_template.tex` — same, not used; `templates/skeleton.tex` is canonical
- `README.md` — roadmap section superseded here; keep or rewrite as project overview
