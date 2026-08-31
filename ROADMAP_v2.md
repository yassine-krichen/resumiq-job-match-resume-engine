# ROADMAP — ApplyIQ (working title)
> AI-powered job application platform: profile → match → tailored resume → outreach.
> Built with Next.js · NestJS · PostgreSQL · Better-Auth · LaTeX.
> Designed for personal use first, SaaS-ready from day one.

---

## Note to Claude Code (Plan Mode)

Before implementing anything, you must:

1. **Inspect the existing CLI project** — read all existing modules, especially:
   - `ai-bridge` module (multi-provider AI fallback: Claude → GPT → Gemini → Groq → Ollama)
   - Career profile / data-inventory schema (we already have something close to `career_profiles` — do not duplicate it, extend it)
   - Existing LaTeX template pipeline and resume generation logic
   - Any existing DB migrations or Prisma schema

2. **Ask clarifying questions** about anything ambiguous before writing code.

3. **Do not assume** the schema sections in this document are final — they are directional. The source of truth is the existing codebase.

---

## Vision

A personal career engine that knows everything about you, finds relevant jobs, scores your fit, generates a perfectly tailored LaTeX PDF resume and cold email per job, and fires them off — all from a single swipe. Ship fast for personal use, architect cleanly for future SaaS.

---

## Tech Stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 15 (App Router) | |
| Backend | NestJS (modular monolith) | |
| Database | PostgreSQL + Prisma ORM | |
| Auth | better-auth (NestJS adapter) | GitHub + LinkedIn OAuth |
| AI | **ai-bridge** (existing module) | Claude → GPT → Gemini → Groq → Ollama fallback chain. Claude API key wired in when going SaaS. |
| Resume compile | **Dual engine: LaTeX (Tectonic) + Typst** | Both implement `RenderEngine` interface, selected via `RESUME_RENDER_ENGINE=latex\|typst` env var. See [Resume Render Engine](#resume-render-engine-dual-latex--typst) below. |
| Job scraping | Vendored career-ops `providers/*.mjs` (~90 ATS/board sources) + Playwright/JSON-LD fallback | `packages/job-scanner`. See [Scraping Sources](#scraping-sources--vendored-from-career-ops-decided-2026-08-31) below. |
| Queue | BullMQ + Redis | Scraping, resume gen, email gen |
| File storage | **Local filesystem for now** | Abstract behind a `StorageService` interface so swapping to S3/Cloudflare R2/Supabase Storage later is a one-file change |
| Frontend UI | shadcn/ui + Tailwind CSS + Framer Motion | |
| Data fetching | TanStack Query (React Query v5) | Client-side server state, cache, optimistic updates |
| HTTP client | Axios (with interceptors for auth headers) | |
| Validation | Zod — shared schemas in `/packages/schemas` (Turborepo) | Single source of truth for FE + BE types |
| Forms | React Hook Form + Zod resolver | |
| Logging | Pino (NestJS) + pino-pretty (dev) | Structured JSON logs, request IDs |
| Security | Helmet (NestJS) · CORS config · rate limiting (`@nestjs/throttler`) · httpOnly cookies | |
| Monorepo | Turborepo | `/apps/web`, `/apps/api`, `/packages/schemas`, `/packages/ai-bridge` |

### StorageService Interface (abstraction layer)
```typescript
interface StorageService {
  save(key: string, buffer: Buffer, mime: string): Promise<string>; // returns URL/path
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

// Implementations:
class LocalStorageService implements StorageService { ... }   // now
class S3StorageService implements StorageService { ... }      // later, same interface
```

---

## Phase 0 — Foundations (Infrastructure & Auth)

### Goal
Skeleton monorepo, DB connection, auth working, dashboard shell rendered.

### Auth — `better-auth`
- Email/password signup + login
- OAuth: **GitHub** (primary), **LinkedIn** (OpenID Connect)
- JWT sessions in httpOnly cookies
- `role` column on `users`: `'user' | 'admin'` — admin bypass for credit checks later

### DB Schema — Phase 0
```sql
users
  id            uuid PK
  email         text UNIQUE
  name          text
  avatar_url    text
  role          text DEFAULT 'user'
  settings      jsonb DEFAULT '{}'
  created_at    timestamptz
  updated_at    timestamptz

accounts  -- better-auth OAuth link table
  id            uuid PK
  user_id       uuid FK → users.id
  provider      text        -- 'github' | 'linkedin' | 'email'
  provider_id   text
  access_token  text
  refresh_token text
  expires_at    timestamptz
```

---

## Phase 1 — Onboarding & Career Inventory

### Goal
New user → guided onboarding → AI parses all their data → **Career Inventory** built → user reviews, edits, confirms.

> ⚠️ Claude Code: inspect the existing career profile / data-inventory schema before touching this. Extend what exists, do not replace it.

### Onboarding Flow (`/onboarding`)

**Step 1 — Input sources** (user picks one or more, combined into one AI parse pass):
- Upload resume (PDF or DOCX) → text extracted server-side
- LinkedIn dump: user copy-pastes the full page content. Show tip: *"Go to your LinkedIn profile → press Ctrl+A then Ctrl+C. Make sure all sections (Experience, Education, Skills) are expanded first."*
- Raw freeform text (any format)
- GitHub username → platform fetches repos, pinned projects, READMEs via GitHub API
- Manual structured form (fallback)

**Step 2 — AI parse pipeline** (SSE progress stream in UI):
```
Extracting resume content...
Reading LinkedIn dump...
Fetching GitHub repos...
Normalizing all sources...
Building your Career Inventory...
Done ✓
```
All raw inputs sent to `ai-bridge` in one prompt → structured JSON output matching career profile schema → saved to DB.

**Step 3 — Review & Confirm** (`/onboarding/review`):
- Editable card grid per section: Personal Info · Skills · Experience · Projects · Education · Certifications · Languages · Achievements · Links
- Inline editing per field, drag to reorder entries, delete, add manually
- `strength_score` (0–100) shown live as user fills out sections
- "Confirm → Go to Dashboard" saves everything

### DB — Phase 1
> Inspect existing schema. At minimum ensure these fields exist on the career profile entity:
> `personal · skills · experience · projects · education · certifications · languages · achievements · raw_sources · strength_score`
> All variable-length sections stored as JSONB. Extend with migrations, don't rewrite.

---

## Phase 2 — Manual Job Application Flow

### Goal
User pastes a job URL or raw JD → match score → gap report or full apply pipeline.

### Page: `/apply/manual`

**Input:**
- Job URL (Greenhouse, Lever, LinkedIn, Indeed) → scraped on-demand
- Or raw JD text pasted directly

**Pipeline (SSE streamed to user):**
```
Extracting job details...
Extracting company info & values...
Analyzing required skills & keywords...
Comparing against your Career Inventory...
Computing match score...
```

**Match Score display:**
- `XX / 100` with breakdown: skills fit · experience fit · seniority fit
- Color ring: 🟢 ≥ 70 · 🟡 50–69 · 🔴 < 50
- Threshold configurable in settings (default: 50)
- **Explainability (decided 2026-08-30)**: `checkCompatibility()` returns a structured `reasons: string[]` array alongside the score (matched skills, gaps, seniority fit detail) — shown as an expandable "why this score" on the card/result. Same LLM call also seeds the gap report, no duplicate call.

**Outcome A — GAP REPORT** (below threshold):
- Actionable checklist per gap: missing skill → suggested project / course / cert / book
- Each item: title · why it matters for this role · concrete action with resource link
- Saveable, pinnable to dashboard, checkboxes persist

**Outcome B — APPLY PIPELINE** (at or above threshold):
```
Selecting best content from your Inventory for this role...
Drafting tailored resume bullets...
[REVIEW & EDIT GATE — see below]
Rendering PDF (LaTeX or Typst per RESUME_RENDER_ENGINE)...
Drafting cold email in company's tone & values...
[REVIEW & EDIT GATE — email]
Done ✓
```

**Review & Edit Gate (decided 2026-08-30)** — solves both "can't tweak the resume" and "silent overflow" problems:
1. `selectAndDraft()` outputs structured `AISelection` JSON — bullets, skills, summary — not a PDF
2. User edits this JSON in a resume editor UI: edit bullet text, reorder, toggle sections on/off
3. Live preview recompiles on edit (debounced) — cheap/fast on Typst engine, on-demand on LaTeX engine
4. User confirms → final render → PDF produced
5. Email draft goes through the same pattern: AI drafts → user reviews/edits inline → confirms → ready to send
6. Nothing is finalized (queued for send, marked "ready") without this explicit user confirmation step

**Email drafting — prompt structure (decided 2026-08-30):**
- Subject line: 36–50 chars, personalized from `parsed_jd`/`company_info` (not `{first_name}` mail-merge — reference a real JD/company detail). Generic subjects ("Job Inquiry") auto-filtered by recruiters.
- Three explicit scored sections in the prompt: subject (drives open), opening line (drives continued read), value-prop/ask (drives response) — weighted roughly 30/30/50 per open-rate research
- Company-profile detail folds into the email drafter directly (pulled from `company_info` already scraped with the job) — not a separate agent/feature

**Review step (post-render):**
- Left: PDF resume preview (rendered from compiled PDF)
- Right: Email draft (editable inline)
- Buttons: "Download .tex/.typ" · "Download PDF" · "Copy email"
- If `settings.auto_send_email = true`: "Send Email" fires (Phase 4)
- If false (default): user handles sending manually

### DB — Phase 2
```sql
jobs
  id              uuid PK
  source          text        -- 'manual' | 'scraper'
  source_url      text
  title           text
  company_name    text
  company_info    jsonb       -- values, tone, culture signals, tech stack
  raw_jd          text
  parsed_jd       jsonb       -- { required_skills[], nice_to_have[], seniority, keywords[] }
  location        text
  remote          boolean
  salary_range    text
  scraped_at      timestamptz
  created_at      timestamptz

applications
  id              uuid PK
  user_id         uuid FK → users.id
  job_id          uuid FK → jobs.id
  match_score     int
  status          text        -- 'gap_reported' | 'resume_drafted' | 'email_drafted' | 'ready' | 'sent' | 'archived'
  gap_report      jsonb       -- null if matched
  resume_tex      text        -- raw .tex source
  resume_pdf_path text        -- local path (later: S3 URL, same field)
  email_draft     text
  interview_prep  jsonb       -- null until user requests it (Phase 2b)
  sent_at         timestamptz
  created_at      timestamptz
  updated_at      timestamptz
```

---

## Phase 2b — Interview Prep (on-demand, per application)

### Goal
After landing an interview, user comes back to `/applications/[id]` and requests an AI-generated interview prep brief for that specific role and company.

This is **never automatic** — always user-initiated.

### Trigger
Button on `/applications/[id]` detail page: **"Prepare for Interview"** (visible once status ≠ `gap_reported`).

### What the AI generates
Given: `parsed_jd` + `company_info` + user's `career_profile` + the tailored resume used for this application:

1. **Likely technical topics** — ranked by probability of being asked, based on the JD keywords, company tech stack, and role seniority. e.g.:
   - "System design: rate limiting (high probability — distributed systems listed 3× in JD)"
   - "React performance optimization (medium — frontend-heavy role)"

2. **Likely behavioral questions** — mapped to company values extracted from job page / Glassdoor signals:
   - "Tell me about a time you disagreed with a teammate" (company emphasizes psychological safety)

3. **Your strongest talking points** — pulled from your resume and career profile, matched to what this company cares about

4. **Gaps to address proactively** — things on the JD you don't have strong signals for, with suggested framing

### UI
- Rendered as a structured prep sheet on `/applications/[id]`
- Collapsible sections per category
- Printable / copy-to-clipboard
- Stored in `applications.interview_prep` JSONB so it persists

---

## Phase 3 — Job Discovery (Swipe Feed)

### Goal
Platform scrapes jobs daily into the DB → user opens `/discover` → Tinder-style card feed → swipe right → full pipeline fires in background.

### Scraping Sources — vendored from career-ops (decided 2026-08-31)

**Strategy superseded.** Rather than hand-building ~4 ATS providers, vendor the provider layer from [santifer/career-ops](https://github.com/santifer/career-ops) (MIT licensed, 69k+ stars, actively maintained) — specifically its `providers/` directory, not its AI-CLI agent framework.

career-ops splits cleanly into two layers: an agentic eval layer (`modes/*.md`, meant to be run interactively inside an AI coding CLI — Claude Code, Codex, etc.) and a **"zero-token scanner"** — `scan.mjs` + `providers/*.mjs` — that is pure deterministic HTTP+JSON, zero LLM calls, zero AI-CLI dependency. Only the second layer is relevant to us; we already have our own eval layer (`checkCompatibility`/`selectAndDraft`/etc. in `ai-bridge`).

**What we're vendoring:**
- `providers/*.mjs` — ~90 modules, one per ATS/job board (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Personio, Teamtailor, Recruitee, Workable, BambooHR, iCIMS, + dozens more incl. remote boards: WeWorkRemotely, RemoteOK, Himalayas, Remotive). Each exports `{id, detect(entry), fetch(entry, ctx) → [{title, url, company, location, description, postedAt}]}`. Confirmed by reading source: Greenhouse (`content=true` param) and Lever (`descriptionPlain` field) both return **full job description text** in the same request, not just listing metadata — no separate per-job detail fetch needed for those two.
- Shared helpers: `_http.mjs`, `_registry.mjs`, `_trust-validator.mjs`, `_ip-guard.mjs` — includes real SSRF hardening (hostname allowlisting per provider, `redirect:'error'`, HTTPS-only) worth keeping as-is rather than re-deriving.
- Do **not** vendor: `modes/`, the markdown tracker (`data/applications.md`, `tracker.mjs`), `scan.mjs` itself (their orchestrator is built around their own file-based tracker/dedup — we write our own thin orchestrator against Postgres instead), any of the eval/scoring/PDF-generation scripts (`generate-pdf.mjs`, `openai-eval.mjs`, etc. — redundant with `ai-bridge`/`resume-renderer`).
- Provider `fetch()` output maps ~1:1 onto `CreateJobSchema`: `title`→title, `company`→company_name, `location`→location, `description`→raw_jd, `url`→source_url.
- License compliance: MIT requires preserving copyright/license notice in vendored files — keep their `LICENSE` header intact in whichever files get copied in, and note the origin in a `NOTICE`/README comment in the vendor directory.

This drops LinkedIn/Indeed bulk-scraping entirely (never had a provider covering them anyway — their own README lists them among the highest-friction sources); those stay manual-paste-only per `/apply/manual`, which was already the plan.

Applies when no career-ops provider matches a target company/board (decided 2026-08-30, kept as fallback 2026-08-31):

- **Structured data first**: check for `<script type="application/ld+json">` (`schema.org/JobPosting`) on every job page before touching the DOM — most job pages embed it, gives clean structured description/salary/location with no truncation or "read more" issues at all.
- **DOM fallback** (when no JSON-LD): Playwright, reuse the same page object across pagination (don't respawn browser per page), wait `networkidle` after actions that fetch, loop "next"/"load more" until it disappears.
- **Expandable content**: `locator.scroll_into_view_if_needed()` + click any "..."/"read more" toggle *before* extracting `.inner_text()` — collapsed text isn't in the DOM tree until expanded.
- **Background API interception**: when a site loads job data via XHR/fetch, listen on `page.on('response', ...)` and grab the JSON directly — faster and less fragile than parsing rendered DOM.
- **Do not scrape Google search results directly** (ToS-heavy, CAPTCHA-prone). If company-site resolution is needed for enrichment, use a proper search API (Serper, Brave Search API) — or skip it entirely, since the enrichment vendors below already resolve company domain → data internally.
- **LinkedIn/Indeed**: no bulk crawling. User pastes URL or raw JD manually (`/apply/manual`); if scraping a single pasted URL server-side, treat as one-off fetch, not a crawl.

### Email & Company Enrichment (decided 2026-08-30)

Needed for: cold email recipient discovery + company profile detail (folded into email drafter, not a separate agent).

| Need | Primary | Fallback | Why |
|---|---|---|---|
| Recruiter/contact email | **Hunter.io** | RocketReach | Hunter: every result has confidence score + verification, best API for automation. RocketReach covers personal-domain emails better (small companies, non-corporate addresses). |
| Company profile enrichment | **People Data Labs** | Apollo.io | PDL: highest measured accuracy (89% correct field yield), fastest (274ms median). Clearbit's free tier is dead (HubSpot-only, no new API keys) — do not build against it. Apollo as single-vendor fallback if bundling contact+company data is preferred. |

Compliance: bulk personal-email lookup for cold outreach touches GDPR/CAN-SPAM — drafted emails must include an opt-out/unsubscribe path; don't retain scraped personal emails indefinitely without basis.

### Discover Feed Filters (decided 2026-08-30)

Pre-swipe filter bar on `/discover`: category/field (AI, DevOps, SWE, etc.), work mode (remote/hybrid/onsite), location (abroad/local), seniority. Stored per-user in `SettingsModule` (`preferred_locations`/`target_roles`/`seniority` already in `users.settings` — extend with `category_tags: string[]` and `work_mode: string[]`). Filters narrow the `job_match_previews` query *and* feed into `checkCompatibility()` scoring weight (e.g. filtering "DevOps" boosts DevOps-relevant skill matches in the score).

### Scraping Infrastructure

- **`packages/job-scanner`** (new) — vendored career-ops `providers/*.mjs` + shared helpers, plus our own thin orchestrator (much smaller than career-ops's `scan.mjs`: no markdown tracker, no dedup-tracker/pipeline-lock — we dedupe/persist straight to Postgres). Reads our own tracked-companies config (start with a curated portals list, not all ~90 providers), calls `provider.fetch()` per company, maps results into `Job` row shape.
- For any URL/board not covered by a career-ops provider: fall back to the JSON-LD-first / Playwright-DOM strategy below (still relevant — kept as the generic-site fallback, not replaced).
- **BullMQ** `job-scraper` queue, CRON-triggered daily via `@nestjs/schedule`, calls into `packages/job-scanner`.
- **Deduplication**: unique index on `(company_name, title, location)` in `jobs` table.
- **Enrichment pipeline** after each scrape:
  ```
  Provider fetch() already returns clean {title, url, company, location, description} for ~90 sources
  → ai-bridge → parsed_jd JSONB (skip re-scraping description where the provider already supplied it)
  Sources with no provider coverage → JSON-LD if present, else Playwright DOM (fallback strategy below)
  Company name/domain → People Data Labs → company_info JSONB
  Hiring contact → Hunter.io (fallback RocketReach) → stored for email draft, not persisted long-term
  ```
- Failed jobs → exponential backoff retry (BullMQ native)

### Generic-Site Fallback Strategy (for sources with no career-ops provider)

### Page: `/discover`

**Card UI:**
- Stack of cards (top card active): job title · company · location/remote · salary · top 5 skills · match score ring
- Swipe right (✓) or keyboard `→` → pipeline queued
- Swipe left (✗) or keyboard `←` → `dismissed_jobs` record inserted, never shown again
- Loading next card is instant — match scores pre-computed on login

**Pre-computation:**
- On login: background job scores top N scraped jobs against user's career profile
- Stored in `job_match_previews`, TTL-refreshed daily
- Feed query: `WHERE score >= settings.match_threshold AND NOT dismissed ORDER BY score DESC`

**Swipe right → BullMQ `resume-gen` queue:**
```
Select best Career Inventory content for this job
→ Draft tailored resume bullets (ai-bridge)
→ Compile .tex → PDF (Tectonic sidecar)
→ Draft cold email (ai-bridge)
→ Store in applications table
→ Send in-app notification to user ("Your resume for Stripe is ready")
```
User never blocked — keeps swiping while pipeline runs in background.

### DB — Phase 3
```sql
job_match_previews
  id            uuid PK
  user_id       uuid FK → users.id
  job_id        uuid FK → jobs.id
  match_score   int
  computed_at   timestamptz

dismissed_jobs
  user_id       uuid FK → users.id
  job_id        uuid FK → jobs.id
  dismissed_at  timestamptz
  PRIMARY KEY (user_id, job_id)
```

---

## Phase 4 — Dashboard, Profile Management & Settings

### Page: `/dashboard`
- Stats strip: total applications · avg match score · resumes generated · gap reports saved · interview preps done
- Recent activity feed with timestamps
- Saved gap reports with per-item checkboxes (progress tracking)
- Quick actions: "Add achievement" · "Browse jobs" · "Paste a job"

### Page: `/profile`
- Full Career Inventory editor (same UI as onboarding review, persistent)
- Per-section strength indicators → feed into `strength_score`
- "Add Achievement" quick modal: title · description · date · related skills
- "Re-sync GitHub" → re-fetches, merges new repos into projects
- Last 5 profile snapshots, rollback supported

### Page: `/applications`
Must have:
- Filterable table: job title · company · date · match score badge · status badge
- Filters: status · date range · match score range · company
- Click row → `/applications/[id]` detail view
- Detail view: PDF preview · email draft · gap report (if any) · "Prepare for Interview" button · re-generate button · download .tex / PDF

### Page: `/settings`

Stored in `users.settings` JSONB:
```json
{
  "auto_send_email": false,
  "match_threshold": 50,
  "preferred_locations": ["Remote"],
  "target_roles": ["Software Engineer", "Full Stack Developer"],
  "seniority": "junior",
  "notify_on_new_jobs": true,
  "resume_template": "default",
  "ai_provider_override": null
}
```

---

## Phase 5 — Payments & Monetization (Future, architected now)

No UI yet. Schema and guard pattern ready from day one so activation is a config flag, not a refactor.

```sql
credits
  id          uuid PK
  user_id     uuid FK → users.id
  balance     int DEFAULT 0
  updated_at  timestamptz

credit_transactions
  id          uuid PK
  user_id     uuid FK → users.id
  amount      int       -- positive = added, negative = spent
  reason      text      -- 'purchase' | 'resume_gen' | 'referral' | 'free_tier'
  ref_id      uuid      -- FK to applications.id or payment session id
  created_at  timestamptz

subscriptions
  id                  uuid PK
  user_id             uuid FK → users.id
  plan                text    -- 'free' | 'pro'
  status              text    -- 'active' | 'cancelled' | 'past_due'
  stripe_sub_id       text
  current_period_end  timestamptz
  created_at          timestamptz
```

**Guard pattern (NestJS):**
```typescript
@RequiresCredit(1)   // decorator on resume gen endpoints
// Guard checks: plan === 'pro' OR credits.balance >= cost
// For now: FEATURE_FLAG_BILLING=false → guard always passes
// Flip flag → billing enforced, zero code changes
```

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Next.js (Vercel / self-hosted)         │
│  /onboarding  /discover  /apply  /dashboard              │
│  /applications  /profile  /settings                      │
│                                                          │
│  TanStack Query · React Hook Form · Zod · Framer Motion  │
│  shadcn/ui · Tailwind CSS · Axios                        │
└──────────────────────────┬───────────────────────────────┘
                           │ REST + SSE
┌──────────────────────────▼───────────────────────────────┐
│                     NestJS API                           │
│                                                          │
│  AuthModule       ProfileModule    OnboardingModule      │
│  JobsModule       ApplicationsModule  AIModule           │
│  ResumeModule     QueueModule      NotificationsModule   │
│  SettingsModule   ScraperModule                          │
│                                                          │
│  Helmet · Throttler · Pino logging · Zod pipes           │
└───┬─────────────────┬──────────────┬─────────────────────┘
    │                 │              │
PostgreSQL          Redis          Local FS
(Prisma)          (BullMQ)     (./storage/*)
    │                 │         (later: S3/R2 via StorageService)
    │            ┌────┘
    │            │
ai-bridge    Tectonic sidecar
(Claude →    (Docker: POST /compile
 GPT →        tex → pdf bytes)
 Gemini →
 Groq →
 Ollama)
```

### NestJS Module Responsibilities

| Module | Responsibility |
|---|---|
| `AuthModule` | better-auth adapter, JWT guards, `@CurrentUser()` decorator |
| `ProfileModule` | Career Inventory CRUD, GitHub sync, strength score computation |
| `OnboardingModule` | Multi-source parse pipeline, SSE progress stream |
| `JobsModule` | Job CRUD, scraper orchestration, feed queries, dedup |
| `ApplicationsModule` | Match scoring, gap report generation, application CRUD, interview prep |
| `AIModule` | Wraps `ai-bridge`, exposes typed methods: `parseProfile()`, `scoreMatch()`, `generateResume()`, `generateEmail()`, `generateInterviewPrep()` |
| `ResumeModule` | LaTeX template fill, Tectonic compile call, StorageService write |
| `QueueModule` | BullMQ setup, worker registration, retry/backoff config |
| `NotificationsModule` | Per-user SSE channel, in-app notification CRUD |
| `SettingsModule` | `users.settings` JSONB CRUD with Zod schema validation |
| `ScraperModule` | Per-source Playwright scrapers, enrichment pipeline |

---

## Page Map

| Route | Description |
|---|---|
| `/` | Landing page (logged-out) |
| `/login` | Login — email + GitHub + LinkedIn |
| `/signup` | Signup |
| `/onboarding` | Step-by-step input collection |
| `/onboarding/review` | Review & confirm parsed Career Inventory |
| `/dashboard` | Home after login — stats, recent activity, saved gap reports |
| `/profile` | Full Career Inventory editor |
| `/discover` | Tinder swipe feed |
| `/apply/manual` | Paste job URL or raw JD |
| `/applications` | All applications — filterable table |
| `/applications/[id]` | Application detail — resume, email, gap report, interview prep |
| `/settings` | App settings |

---

## Resume Render Engine (dual: LaTeX + Typst)

> Decided 2026-08-30. LaTeX was picked originally for visual quality (Jake Gutierrez / Awesome-CV-tier templates, cleaner than most). Two known bugs: (1) no page-count feedback — generated resume can silently overflow to page 2, (2) text sometimes fails to wrap, spills off the line, looks sloppy. Typst fixes both structurally (fast recompiles enable a fit-check loop, real scripting for auto-shrink) but must not be a visual downgrade — confirmed it isn't: `modern-cv` on Typst Universe is a direct port of Awesome-CV, plus `impressive-impression`, `brilliant-cv`, `neat-cv` are same tier. Both engines ship from day one, switchable per-request/per-env, no business-logic change either way.

### Shared interface
```typescript
interface RenderEngine {
  render(selection: AISelection, db: CareerProfile, templateId: string): Promise<{ pdf: Buffer; pageCount: number }>;
}
```

```
packages/resume-renderer/
  render-engine.interface.ts
  latex/latex-renderer.ts     // wraps Tectonic sidecar
  typst/typst-renderer.ts     // wraps typst-cli or typst.ts (wasm) — no sidecar needed, compiles in-process
  index.ts                    // resolves impl from RESUME_RENDER_ENGINE env var
```

### LaTeX path (existing, patched — no compile-loop yet)
Since LaTeX has no cheap way to detect/retry overflow yet, mitigate at the prompt layer in `selectAndDraft()` / `critiqueAndRevise()`:
- Hard cap: max 3 experience entries, max N bullets/entry, char-length cap per bullet
- Tighten template spacing/margins slightly (same visual family, more headroom before overflow)
- Real overflow-detection loop (compile → count pages → ask LLM to trim → recompile) is a Typst-only feature for now; can be backported to LaTeX later if still needed

### Typst path (new, preferred going forward)
- Port winning template to `modern-cv` (or closest Awesome-CV-tier package) — zero visual downgrade
- Cheap compiles (200-500ms) enable a real fit loop: compile → read page count → if >1 page, auto-shrink (font/spacing step-down first, then ask LLM to trim content) → recompile → repeat until 1 page or shrink budget exhausted
- No LaTeX line-wrap bug class — Typst's layout engine handles text flow correctly

### Shared pipeline (both engines)
1. **Content selection**: `AIModule.generateResume(careerProfile, parsedJD)` → structured `AISelection` JSON (bullets, ranked skills, tailored summary) — **not a PDF yet**
2. **Review & Edit Gate** (see Phase 2 below): user reviews/edits the structured JSON in-app before any compile happens
3. **Render**: `RenderEngine.render(selection, db, templateId)` → PDF bytes + page count, engine picked via env var
4. **Store**: `StorageService.save()` → local path today, S3 URL tomorrow, same field in DB
5. **Serve**: file endpoint returns PDF bytes with `Content-Type: application/pdf`

**Tectonic sidecar** (LaTeX path only, minimal Dockerfile):
```
POST /compile
Body:     { tex: string }
Response: { pdf: string }  // base64
Timeout:  30s
```

---

## Explicitly Out of Scope (for now)

- Auto-submit to ATS portals (Workday, Greenhouse apply buttons)
- Voice mock interview
- Gmail/Outlook OAuth for sending email
- Mobile app
- Team / multi-user workspace features
- LinkedIn API (too fragile — user copy-paste is sufficient at launch)

---

## Resume / Portfolio Metrics — What to Track & How to Present This

This section is for tracking meaningful numbers to put on your resume once the app ships. Focus on metrics that signal scale, AI depth, and engineering quality.

### Metrics to instrument from day one

| Metric | Where to track | Why it's impressive |
|---|---|---|
| Total resumes generated | `applications` table COUNT | Raw output volume |
| Avg match score across all applications | `applications.match_score` AVG | Shows scoring system is non-trivial |
| Gap report → application conversion rate | Users who got a gap report and came back to apply after closing gaps | Shows the coaching loop works |
| Resume generation latency (p50, p95) | Pino logs + a `perf_log` table | Shows you care about performance |
| Scraper uptime / jobs ingested per day | BullMQ job metrics | Shows infra scale |
| Interview prep requests per user | `applications.interview_prep` non-null COUNT | Shows feature adoption |
| ai-bridge provider distribution | Log which provider handled each call | Shows resilience design |

### Suggested resume bullet framing

Once you have real numbers, frame them like:

- "Engineered a multi-provider AI fallback pipeline (Claude → GPT → Gemini → Groq → Ollama) achieving 99.X% AI availability across X,000 requests"
- "Built automated resume generation system producing tailored LaTeX PDFs in under Xs (p95), processing X applications across X users"
- "Designed job matching engine scoring candidates against scraped JDs across X tech roles, with gap analysis reducing time-to-qualified-application by X%"
- "Architected async pipeline (BullMQ + Redis) handling X concurrent resume generation jobs with zero user-blocking"
- "Implemented Tectonic LaTeX microservice compiling PDFs in Xms average, isolated from main API process"

### Killer feature to add for resume credibility

**Semantic skill gap vector** — instead of simple keyword matching for the match score, embed both the job's required skills and the user's profile into a vector space (use an embedding model via ai-bridge) and compute cosine similarity per skill cluster. This turns a naive "keyword found / not found" into a nuanced semantic match ("NestJS" recognizes that "Express.js + Node.js" is a partial match, not a zero). 

It's one extra AI call per match computation, gives much better scores, and on your resume becomes: *"Replaced keyword-matching with semantic vector similarity scoring using embedding models, improving match relevance by X%"*. That's a line that gets read.
