# Test Guide — AI Resume Generator CLI

Run these tests in order. Each builds on the previous. All commands from `resume-builder/` directory.

---

## 0. Prerequisites

```bash
node --version     # must be 18+
npm install        # install deps if not done
cp .env.example .env
```

Start `claude-web-bridge` in a separate terminal (keep it running for all tests):
```bash
# in your claude-web-bridge directory
npm run dev
```

Verify bridge responds before running anything:
```bash
# PowerShell
Invoke-WebRequest http://127.0.0.1:3000/health
# or
curl http://127.0.0.1:3000/health
```

Expected: `{"status":"ok"}` or similar 200 response.

---

## 1. Validate DB

Tests: `validate-db.ts`, required fields, date formats, populated arrays.

```bash
npm run validate-db
```

**Expected output:**
```
✓ data_inventory.json valid — 3 role(s), N project(s), 2 degree(s)
```

If issues: fix `data_inventory.json` before continuing.

---

## 2. Happy Path — Full Pipeline

Tests: all 4 agents (analyze, compat check, select, critique), LaTeX render, versioning.

**Step 1 — Write mock job description to `input/job.txt`:**

```
Senior Full-Stack Engineer — FinTech Startup

We're building next-generation payment infrastructure and need a Senior Full-Stack Engineer
for our core platform team.

Responsibilities:
- Design and implement RESTful APIs using TypeScript and NestJS
- Build web interfaces with Next.js and React
- Own the deployment pipeline with Docker and Kubernetes
- Design and optimize PostgreSQL schemas for high-throughput workloads
- Lead code reviews and mentor junior engineers

Requirements:
- 3+ years professional software engineering experience
- Strong TypeScript and Node.js proficiency
- NestJS or similar backend framework experience
- React/Next.js frontend experience
- Docker and container orchestration experience
- PostgreSQL or similar relational database experience
- CI/CD pipeline experience

Nice to have:
- Kubernetes experience
- Go experience
- Background in high-availability systems
- Redis or message queue experience
```

**Step 2 — Write mock company info to `input/company.txt`:**

```
TechPay is a Series B FinTech startup (80 engineers) building real-time payment processing
infrastructure. Remote-first, async culture. Strong ownership model — engineers own their
services end-to-end. Tech stack: TypeScript, NestJS, Next.js, Kubernetes, PostgreSQL.
Known for strong onboarding and clear engineering career ladder.
```

**Step 3 — Run:**
```bash
npm run generate
```

**Expected output (abridged):**
```
✓ Bridge running at http://127.0.0.1:3000
Agent 1: Analyzing job description...
✓ Job: Senior Full-Stack Engineer (Senior)

Compatibility check...
  Score: 85/100 [█████████░]
  (warnings if any)

Agent 2: Selecting content and drafting bullets...
✓ Draft: 3 role(s), 2 project(s)

Critique pass: Auditing bullet quality...
✓ Self-critique complete
  Final match score: 88/100 [█████████░]

✓ Saved: output/resume.json
  Edit bullets before rendering? [y/N]

Rendering LaTeX...
✓ Saved: output/resume.tex
Compiling PDF...
  (✓ Compiled: output/resume.pdf  OR  Overleaf instructions)
```

**Verify files created:**
```bash
ls output/
# should see: resume.json, resume.tex, (resume.pdf)
ls output/versions/
# should see: 2026-06-09_HHMM_senior-full-stack-engineer/
```

**Inspect selection:**
```bash
# PowerShell
Get-Content output/resume.json | ConvertFrom-Json | Select-Object reasoning, match_score, section_order
```

---

## 3. Verbose Mode

Tests: ATS keyword output, section order log, match reasoning, DB suggestions.

```bash
npm run generate -- --verbose
```

**Extra lines expected (on top of Test 2):**
```
  ATS keywords: TypeScript, NestJS, Next.js, Docker, Kubernetes, PostgreSQL, CI/CD, ...
  Sections: education → experience → projects → skills → ...
  [match reasoning sentence]
  DB improvements: (if any suggestions)
```

---

## 4. 1-Page Mode

Tests: Agent 2 page constraint (max 2 entries, max 2 bullets each), no optional sections.

```bash
npm run generate -- --pages 1
```

**Expected:** fewer bullets in `output/resume.json` vs Test 2. Check:
```bash
# PowerShell — count bullets per experience entry
(Get-Content output/resume.json | ConvertFrom-Json).experience | ForEach-Object { "$($_.company): $($_.bullets.Count) bullets" }
```

Each entry should show ≤ 2 bullets.

---

## 5. Fast Draft — No Critique

Tests: `--no-critique` skips Agent 3 (only 2 LLM calls instead of 4).

```bash
npm run generate -- --no-critique
```

**Expected:**
```
Agent 2: Selecting content and drafting bullets...
✓ Draft: N role(s), N project(s)
  (critique skipped — --no-critique)

✓ Saved: output/resume.json
```

No "Critique pass" line. No `match_score` in output. Faster run.

---

## 6. Render-Only (Edit Cycle)

Tests: `--render-only` reads saved JSON, re-renders without any AI calls.

**Step 1 — Make a manual edit to `output/resume.json`:**
Open the file, find any bullet string in `experience[0].bullets`, change one word.

**Step 2 — Re-render:**
```bash
npm run render
```

**Expected:**
```
Render-only: loaded selection from output/resume.json
Rendering LaTeX...
✓ Saved: output/resume.tex
```

No bridge calls. Verify the edited bullet appears in `output/resume.tex`.

---

## 7. Compatibility Block

Tests: compatibility gate blocks generation when mandatory tech absent from DB.

**Write a role requiring a tech stack not in your DB to `input/job.txt`:**

```
Backend Engineer — Elixir/Phoenix

We need an experienced Elixir developer for our distributed systems team.

Requirements (all mandatory):
- 2+ years Elixir programming experience
- Phoenix framework and LiveView
- OTP / GenServers for fault-tolerant systems
- BEAM VM internals understanding
- Erlang experience

Nice to have:
- Distributed Elixir cluster experience
- Kafka integration
```

Clear company.txt:
```bash
# PowerShell
Set-Content input/company.txt ""
```

Run:
```bash
npm run generate
```

**Expected output:**
```
✓ Job: Backend Engineer (Mid)

Compatibility check...
  Score: 5/100 [░░░░░░░░░░]

✗ Incompatible — mandatory skills with no DB coverage:
    ✗ Elixir
    ✗ Phoenix framework
    ✗ OTP / GenServers
    ✗ BEAM VM

Suggested DB additions:
    → Add an Elixir project to projects section
    → Add Elixir to programming_languages if you have any experience

Add these to data_inventory.json and re-run.
```

Process exits with code 1. No resume generated.

---

## 8. Ingest — Add New Data to DB

Tests: `npm run ingest`, AI parsing of raw text, DB merge.

**Run:**
```bash
npm run ingest
```

**When prompted, paste this text (then press Enter twice):**

```
I built a project called InfraBot from January 2026 to May 2026. It's a Python CLI tool
that automates Kubernetes cluster provisioning using Terraform and Helm charts. The tool
reduced team deployment setup time by 60% and was used to provision 20+ production clusters.
Tech stack: Python, Terraform, Helm, Kubernetes, GitLab CI/CD. GitHub: https://github.com/yassine-kr/infrabot
```

**Expected parsed output:**
```json
{
  "type": "project",
  "entry": {
    "name": "InfraBot",
    "context": "CLI tool for Kubernetes cluster provisioning automation",
    "links": [{ "type": "GitHub", "url": "https://github.com/yassine-kr/infrabot" }],
    "startDate": "Jan 2026",
    "endDate": "May 2026",
    "technologies_used": ["Python", "Terraform", "Helm", "Kubernetes", "GitLab CI/CD"],
    "raw_achievements": [
      "Automated Kubernetes cluster provisioning using Terraform and Helm charts",
      "Provisioned 20+ production clusters"
    ],
    "quantifiable_metrics": [
      "Reduced team deployment setup time by 60%",
      "Provisioned 20+ production clusters"
    ]
  }
}
```

When prompted `Merge into data_inventory.json? [y/N]` → type `y`.

**Verify:**
```bash
npm run validate-db
# PowerShell — confirm project exists
(Get-Content ../data_inventory.json | ConvertFrom-Json).projects | Select-Object name
```

---

## 9. Ingest Skills Addition

Tests: skills merge deduplication.

```bash
npm run ingest
```

**Paste:**
```
Recently learned Bun runtime, Drizzle ORM, and tRPC. Also been using Turbo monorepo tooling.
```

**Expected:**
```json
{
  "type": "skills",
  "entry": {
    "frameworks_and_libraries": ["Bun", "Drizzle ORM", "tRPC", "Turbo"]
  }
}
```

After merge, verify no duplicates:
```bash
# PowerShell
(Get-Content ../data_inventory.json | ConvertFrom-Json).skills.frameworks_and_libraries
```

---

## 10. Error Cases

### Bridge not running
Stop claude-web-bridge, then:
```bash
npm run generate
```
Expected: `Error: claude-web-bridge not reachable at http://127.0.0.1:3000`

### Placeholder not replaced
```bash
# PowerShell
Set-Content input/job.txt "Paste the job description here"
npm run generate
```
Expected: `Error: Replace the placeholder in input/job.txt with the actual job description`

### render-only with no JSON
```bash
# PowerShell — delete or rename output/resume.json first
Rename-Item output/resume.json output/resume.json.bak
npm run render
```
Expected: `Error: output/resume.json not found — run npm run generate first`

Restore:
```bash
Rename-Item output/resume.json.bak output/resume.json
```

---

## Pass / Fail Checklist

| Test | Check |
|------|-------|
| 1 validate-db | `✓ data_inventory.json valid` printed, exit 0 |
| 2 generate | `output/resume.json`, `output/resume.tex` created; versioned dir in `output/versions/` |
| 3 verbose | ATS keywords + section order visible in output |
| 4 pages 1 | Each experience entry has ≤ 2 bullets in resume.json |
| 5 no-critique | No "Critique pass" line; faster completion |
| 6 render-only | Manual edit appears in resume.tex; no bridge call |
| 7 compat block | Exit code 1; blockers printed; no resume.json overwrite |
| 8 ingest project | New project appears in data_inventory.json |
| 9 ingest skills | Skills added without duplicates |
| 10 error cases | Correct error messages; process exits non-zero |
