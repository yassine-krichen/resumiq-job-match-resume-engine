# Pipeline Diagrams — AI Resume Generator

---

## 1. Main CLI Pipeline

Full flow from `npm run generate` to PDF output, including `--render-only` mode and all error paths.

```mermaid
flowchart TD
    START([npm run generate / render]) --> RFLAG{--render-only?}

    RFLAG -->|yes| RO_LOAD[read output/resume.json]
    RO_LOAD --> RO_EXISTS{file exists?}
    RO_EXISTS -->|no| ERR_RO([Error: run npm run generate first])
    RO_EXISTS -->|yes| RENDER_STEP

    RFLAG -->|no| BRIDGE[checkBridge GET /health 5s timeout]
    BRIDGE -->|timeout or non-200| ERR_BRIDGE([Error: bridge not reachable\nprint start instructions])
    BRIDGE -->|200 OK| READ_DB[read data_inventory.json]
    READ_DB --> READ_JD[read input/job.txt required]
    READ_JD --> JD_PLACEHOLDER{starts with placeholder text?}
    JD_PLACEHOLDER -->|yes| ERR_JD([Error: replace placeholder in job.txt])
    JD_PLACEHOLDER -->|no| READ_CO[read input/company.txt optional]
    READ_CO --> CO_CHECK{file exists AND not placeholder?}
    CO_CHECK -->|yes| WITH_CO[companyInfo = file contents]
    CO_CHECK -->|no| NO_CO[companyInfo = empty string]

    WITH_CO --> AGT1
    NO_CO --> AGT1

    AGT1[Agent 1: analyzeJob] --> AGT1_OUT{success?}
    AGT1_OUT -->|fail| ERR_LLM([throw LLM error])
    AGT1_OUT -->|ok| JDNA[JobDNA]
    JDNA --> LOG1[log: title + seniority + ATS keywords]

    LOG1 --> AGT2[Agent 2: selectAndDraft]
    AGT2 --> AGT2_OUT{success?}
    AGT2_OUT -->|fail| ERR_LLM
    AGT2_OUT -->|ok| DRAFT[AISelection draft]
    DRAFT --> LOG2[log: experience count + project count + section order]

    LOG2 --> AGT3[Agent 3: critiqueAndRevise]
    AGT3 --> AGT3_OUT{success?}
    AGT3_OUT -->|fail| ERR_LLM
    AGT3_OUT -->|ok| FINAL[final AISelection]

    FINAL --> SAVE_JSON[write output/resume.json]
    SAVE_JSON --> LOG3[log: review + edit suggestion]
    LOG3 --> RENDER_STEP

    RENDER_STEP[render: build LaTeX from selection + DB] --> RVAL{renderer validation}
    RVAL -->|company name not found in DB| ERR_CO([throw: company not in DB])
    RVAL -->|project name not found in DB| ERR_PR([throw: project not in DB])
    RVAL -->|skeleton missing %%CONTENT%%| ERR_SK([throw: invalid skeleton])
    RVAL -->|cert or award name not in DB| WARN[console.warn + skip entry]
    WARN --> WRITE_TEX
    RVAL -->|all OK| WRITE_TEX[write output/resume.tex]

    WRITE_TEX --> COMPILE[tryCompile]
    COMPILE --> TEC{tectonic in PATH?}
    TEC -->|yes| TEC_RUN[tectonic compile]
    TEC_RUN -->|success| PDF([output/resume.pdf])
    TEC_RUN -->|fail| PDFL
    TEC -->|no| PDFL{pdflatex in PATH?}
    PDFL -->|yes| PDF_RUN[pdflatex -interaction=nonstopmode]
    PDF_RUN -->|success| PDF
    PDF_RUN -->|fail| OVERLEAF
    PDFL -->|no| OVERLEAF([print Overleaf instructions\ntectonic install links])
```

---

## 2. LLM Bridge Client

How `generateJSON<T>` calls the bridge, falls back to ChatGPT, and extracts JSON from unpredictable LLM output.

```mermaid
flowchart TD
    GJ["generateJSON&lt;T&gt;(system, user)"] --> CONCAT["concat: system + '---' + user → prompt"]
    CONCAT --> LOOP["iterate providers: [claude, chatgpt]"]

    LOOP --> CB["callBridge(prompt, provider)"]
    CB --> HTTP["POST BRIDGE_URL/chat\nbody: {prompt, provider, stream:false}\ntimeout: AbortSignal.timeout(300_000)"]

    HTTP -->|network error or timeout| CBFAIL{last provider?}
    HTTP -->|HTTP non-200| CBFAIL
    CBFAIL -->|no — try next| WARN["console.warn: claude failed, trying chatgpt..."]
    WARN --> LOOP
    CBFAIL -->|yes — chatgpt also failed| THROW_ALL([throw: All providers failed])

    HTTP -->|200 OK| RAW["raw response text from data.response"]
    RAW --> EJ["extractJSON&lt;T&gt;(text)"]

    EJ --> TRY1["attempt 1: JSON.parse(trimmed)"]
    TRY1 -->|success| RETURN(["return T"])
    TRY1 -->|SyntaxError| TRY2["attempt 2: regex match ``` ```json ... ``` ```"]
    TRY2 -->|fence found| TRY2P["JSON.parse(inner content)"]
    TRY2P -->|success| RETURN
    TRY2P -->|fail| TRY3
    TRY2 -->|no fence| TRY3["attempt 3: find outermost { ... } block\nindexOf '{' + lastIndexOf '}'"]
    TRY3 -->|found| TRY3P["JSON.parse(slice)"]
    TRY3P -->|success| RETURN
    TRY3P -->|fail| THROW_JSON(["throw: Could not parse JSON from LLM response\nfirst 600 chars logged"])
    TRY3 -->|not found| THROW_JSON
```

---

## 3. Agent 1 — Job Analyzer

Extracts structured job requirements (JobDNA) from raw job description text.

```mermaid
flowchart LR
    IN["analyzeJob(jd, companyInfo)"] --> SYS["system prompt:\nsenior technical recruiter\n+ ATS expert role\n+ read between the lines rule\n+ Return ONLY valid JSON"]

    SYS --> USER["user prompt:\n&lt;job_description&gt; block\n&lt;company_info&gt; block\nexact schema definition"]

    USER --> LLM["generateJSON&lt;JobDNA&gt;(system, user)"]
    LLM -->|parse error| ERR(["throw"])
    LLM -->|ok| OUT

    subgraph OUT [JobDNA Output Schema]
        F1["job_title: string"]
        F2["seniority: Junior | Mid | Senior | Lead"]
        F3["mandatory_technical_skills: string[]"]
        F4["mandatory_soft_skills: string[]"]
        F5["nice_to_have_skills: string[]"]
        F6["ats_keywords: 5–10 exact ATS phrases"]
        F7["company_culture_and_values: string[]"]
        F8["primary_responsibilities_summary: 2 sentences max"]
        F9["tone_recommendation: e.g. impact-driven, metric-focused"]
    end
```

---

## 4. Agent 2 — Content Selector & Drafter

Filters career DB against JobDNA, selects relevant content, writes targeted bullets.

```mermaid
flowchart TD
    IN["selectAndDraft(jobDNA, db)"] --> SYS["system prompt:\nelite resume strategist role\n+ 7 hard rules (see below)"]
    SYS --> USER["user prompt:\n&lt;job_dna&gt; JSON\n&lt;candidate_database&gt; full DB JSON\n+ exact AISelection schema"]
    USER --> LLM["generateJSON&lt;AISelection&gt;"]
    LLM -->|parse error| ERR(["throw"])
    LLM -->|ok| DRAFT["AISelection draft"]

    subgraph RULES [Hard Rules enforced in system prompt]
        R1["1. Never invent numbers — only verbatim figures from\n   raw_achievements or quantifiable_metrics"]
        R2["2. Tech in bullets MUST appear in technologies_used\n   for that specific role/project"]
        R3["3. Skills MUST exist in candidate's skills section\n   — no injecting from job description"]
        R4["4. Max 4 bullets per experience, max 3 per project"]
        R5["5. Bullet formula: Action Verb + Context + Result + Tech\n   No 'was responsible for' / 'helped with' / 'participated in'"]
        R6["6. Show soft skills via behavior — never state them directly\n   e.g. 'Spearheaded alignment...' not 'demonstrated communication'"]
        R7["7. Omit irrelevant experiences entirely\n   (gap better than weak unrelated entry)"]
    end

    subgraph SCHEMA [AISelection Output Schema]
        S1["reasoning: selection + ordering rationale"]
        S2["section_order: ordered SectionType[]"]
        S3["summary: string | null"]
        S4["experience: [{company, role, bullets[]}]"]
        S5["projects: [{name, bullets[]}]"]
        S6["skills: {languages, frameworks_and_libraries,\n  infrastructure_and_tools, databases}"]
        S7["certifications: string[]"]
        S8["awards: string[]"]
    end
```

---

## 5. Agent 3 — Critique & Revise

Audits every bullet in the draft against a strict checklist and returns a revised selection.

```mermaid
flowchart TD
    IN["critiqueAndRevise(draft, jobDNA, db)"] --> SYS["system prompt:\nruthless resume editor role\n+ 5-point per-bullet audit\n+ Return complete revised AISelection JSON"]
    SYS --> USER["user prompt:\n&lt;job_dna&gt;\n&lt;candidate_database&gt;\n&lt;draft_selection&gt;"]
    USER --> LLM["generateJSON&lt;AISelection&gt;"]
    LLM -->|parse error| ERR(["throw"])
    LLM -->|ok| REVISED["final AISelection"]

    subgraph AUDIT [Per-Bullet Audit Checklist]
        C1["1. 'So what?' test — clear scope, outcome, or impact?\n   Not just describing what was done"]
        C2["2. Every number/metric traceable to raw_achievements\n   or quantifiable_metrics in DB — else rewrite without it"]
        C3["3. Strong specific action verb opener\n   Reject: Worked on / Helped / Assisted / Was responsible for\n   / Participated in / Contributed to"]
        C4["4. Every tech mentioned in technologies_used\n   for that specific role/project in DB"]
        C5["5. Fits within 2 rendered lines at 11pt — cut ruthlessly"]
    end

    subgraph ALSO [Also Checked]
        A1["All skills exist in candidate DB"]
        A2["Section order strategically correct for this role"]
        A3["Summary (if present) is targeted, not generic"]
    end
```

---

## 6. LaTeX Renderer

Builds resume content from AISelection, injects into skeleton, validates against DB, compiles PDF.

```mermaid
flowchart TD
    IN["render(selection, db, skeletonPath)"] --> READ["read skeleton.tex"]
    READ --> CHK_SKEL{contains %%CONTENT%%?}
    CHK_SKEL -->|no| ERR_SK(["throw: skeleton missing %%CONTENT%% placeholder"])
    CHK_SKEL -->|yes| HEADER["renderHeader(db.personal_info)\nname, location, phone, email, links\nURLs strip protocol for display"]

    HEADER --> ORDER["buildContent: iterate section_order\nnote: education FORCED first\nregardless of AI ordering"]

    ORDER --> SEC{section type}

    SEC -->|education| EDU["renderEducation\ninstitution, degree + GPA + honors\ndate range — always included"]

    SEC -->|experience| EXP["for each experience in selection"]
    EXP --> EXP_CHK{company found in DB?}
    EXP_CHK -->|no| ERR_CO(["throw: company not in DB"])
    EXP_CHK -->|yes| EXP_DATES["get startDate + endDate from DB\nrender: company, role, location, dates\nbullets with tex() escaping"]

    SEC -->|projects| PROJ["for each project in selection"]
    PROJ --> PROJ_CHK{project found in DB?}
    PROJ_CHK -->|no| ERR_PR(["throw: project not in DB"])
    PROJ_CHK -->|yes| PROJ_LINK{GitHub link in DB?}
    PROJ_LINK -->|yes| PROJ_HREF["name rendered as hyperlink"]
    PROJ_LINK -->|no| PROJ_PLAIN["name rendered as plain text"]
    PROJ_HREF --> PROJ_BODY["tech stack inline + bullets"]
    PROJ_PLAIN --> PROJ_BODY

    SEC -->|skills| SKILLS["languages / frameworks / tools / databases\njoined with comma separators"]

    SEC -->|certifications| CERT["for each cert name in selection"]
    CERT --> CERT_CHK{name found in DB?}
    CERT_CHK -->|no| CERT_WARN["console.warn: AI hallucinated cert name — skip"]
    CERT_CHK -->|yes| CERT_RENDER["render: name, issuer, date"]

    SEC -->|awards| AWD["for each award in selection"]
    AWD --> AWD_CHK{title found in DB?}
    AWD_CHK -->|no| AWD_WARN["console.warn: AI hallucinated award title — skip"]
    AWD_CHK -->|yes| AWD_RENDER["render: title, issuer, date"]

    SEC -->|summary| SUM{"summary string\nin selection?"}
    SUM -->|yes| SUM_RENDER["render summary paragraph"]
    SUM -->|no| SUM_SKIP["skip section entirely"]

    EDU --> INJECT
    EXP_DATES --> INJECT
    PROJ_BODY --> INJECT
    SKILLS --> INJECT
    CERT_RENDER --> INJECT
    CERT_WARN --> INJECT
    AWD_RENDER --> INJECT
    AWD_WARN --> INJECT
    SUM_RENDER --> INJECT
    SUM_SKIP --> INJECT

    INJECT["replace %%CONTENT%% in skeleton\nwith assembled sections"] --> OUT["resume.tex string"]

    subgraph TEX_ESCAPE [tex() escaping — applied to all user content]
        E1["& → \\&"]
        E2["% → \\%"]
        E3["$ → \\$"]
        E4["# → \\#"]
        E5["_ → \\_"]
        E6["{ } → \\{ \\}"]
        E7["~ → \\textasciitilde{}"]
        E8["^ → \\textasciicircum{}"]
        E9["\\ → \\textbackslash{}"]
    end
```

---

## 7. Data Flow Summary

End-to-end data transformation across the pipeline.

```mermaid
flowchart LR
    JD["job.txt\n(raw job description)"] --> A1_BOX["Agent 1"]
    CO["company.txt\n(optional context)"] --> A1_BOX
    A1_BOX --> JDNA_BOX["JobDNA\n{title, seniority, skills,\nATS keywords, culture, tone}"]

    DB_BOX["data_inventory.json\n(full career database)"] --> A2_BOX
    JDNA_BOX --> A2_BOX["Agent 2"]
    A2_BOX --> DRAFT_BOX["AISelection draft\n{reasoning, section_order,\nexperience, projects, skills,\ncerts, awards, summary}"]

    DRAFT_BOX --> A3_BOX["Agent 3"]
    JDNA_BOX --> A3_BOX
    DB_BOX --> A3_BOX
    A3_BOX --> FINAL_BOX["final AISelection\n(bullets revised + verified)"]

    FINAL_BOX --> JSON_BOX["output/resume.json\n(reviewable intermediate)"]
    DB_BOX --> REND_BOX
    FINAL_BOX --> REND_BOX["Renderer\n(validates against DB\n+ builds LaTeX sections)"]
    SKEL["templates/skeleton.tex\n(LaTeX preamble + macros)"] --> REND_BOX

    REND_BOX --> TEX_BOX["output/resume.tex"]
    TEX_BOX --> COMP_BOX["tectonic / pdflatex\n(or Overleaf)"]
    COMP_BOX --> PDF_BOX["output/resume.pdf"]
```
