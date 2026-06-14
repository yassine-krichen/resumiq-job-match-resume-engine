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
| Resume compile | Tectonic (Rust LaTeX engine) | Docker sidecar, `POST /compile` → returns PDF bytes |
| Job scraping | Playwright + custom scrapers | Per-source workers |
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

**Outcome A — GAP REPORT** (below threshold):
- Actionable checklist per gap: missing skill → suggested project / course / cert / book
- Each item: title · why it matters for this role · concrete action with resource link
- Saveable, pinnable to dashboard, checkboxes persist

**Outcome B — APPLY PIPELINE** (at or above threshold):
```
Selecting best content from your Inventory for this role...
Drafting tailored resume bullets...
Compiling LaTeX PDF via Tectonic...
Drafting cold email in company's tone & values...
Done ✓
```

**Review step:**
- Left: PDF resume preview (rendered from compiled PDF)
- Right: Email draft (editable inline)
- Buttons: "Download .tex" · "Download PDF" · "Copy email"
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
  status          text        -- 'gap_reported' | 'resume_drafted' | 'email_drafted' | 'sent' | 'archived'
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

### Scraping Sources (priority order)

| Source | Why | Difficulty |
|---|---|---|
| Wellfound (AngelList) | Startup-heavy, structured, low bot protection | Easy |
| Greenhouse / Lever job boards | Direct company ATS, clean HTML | Easy–Medium |
| RemoteOK / We Work Remotely | Remote-first, RSS + HTML, minimal protection | Easy |
| Indeed | High volume, aggressive scraping protection | Medium |
| LinkedIn Jobs | Highest volume, hardest to scrape reliably | Hard — Phase 3b |

### Scraping Infrastructure

- **Playwright** workers, one per source, rotating user agents + delays
- **BullMQ** `job-scraper` queue, CRON-triggered daily via `@nestjs/schedule`
- **Deduplication**: unique index on `(company_name, title, location)` in `jobs` table
- **Enrichment pipeline** after each scrape:
  ```
  Raw JD text → ai-bridge → parsed_jd JSONB
  Company URL → scrape → company_info JSONB
  ```
- Failed jobs → exponential backoff retry (BullMQ native)

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

## LaTeX / Resume Pipeline Detail

1. **Template**: Jake Gutierrez base (existing in CLI), parameterized with token placeholders
2. **Content selection**: `AIModule.generateResume(careerProfile, parsedJD)` → returns structured JSON of selected bullets, ranked skills, tailored summary
3. **Template fill**: `ResumeModule` injects JSON into `.tex` template string
4. **Compile**: `POST /compile { tex: string }` to Tectonic sidecar → returns `{ pdf: base64 }`
5. **Store**: `StorageService.save()` → local path today, S3 URL tomorrow, same field in DB
6. **Serve**: file endpoint returns PDF bytes with `Content-Type: application/pdf`

**Tectonic sidecar** (minimal Dockerfile):
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
