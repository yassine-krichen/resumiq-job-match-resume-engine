# Product Specification Document: AI-Powered "Resume Database" & Career Copilot

## 1. Product Vision

The traditional resume-building process is broken, manual, and reactive. Our product shifts the paradigm from "writing a resume" to **"maintaining a career database."** By centralizing a user's professional history, skills, and achievements into a structured data format, we leverage advanced AI (via sequential agentic pipelines) to automatically generate highly tailored, ATS-optimized, and psychologically compelling resumes for specific job applications.

Beyond document generation, the platform serves as a proactive career compass—analyzing gaps between the user's current database and their dream roles, prescribing actionable steps to become a top-tier candidate, and simulating the interview process once they land one.

## 2. Core Features (MVP & Future Scope)

### 2.1 The Master Career Database (MVP)

- **Centralized Repository:** A single source of truth (JSON schema) containing every project, certification, soft skill, metric, and work experience the user has ever had.
- **Onboarding / Bootstrapping:**
    - **Automated Ingestion:** Users can upload an old PDF/Word resume or paste their LinkedIn profile data export. The AI parses this into the master JSON schema.
    - **Manual Entry:** Users can start from scratch and manually type in their experiences.
    - **Skip Option:** Users with no prior experience (e.g., career switchers or fresh graduates) can skip initial population and build it as they go based on AI recommendations.

### 2.2 Dynamic Resume Generation Engine (MVP)

- **Context-Aware Tailoring:** Generates a custom resume based on a Target Job Description and Company Data pasted by the user.
- **ATS & Human Optimization:** Ensures the output aligns with ATS parsers while utilizing psychological triggers for human recruiters.
- **Format Constraints (LaTeX):** The generation strictly outputs raw `.tex` (LaTeX) code based on a provided template (e.g., Jake Gutierrez template) to ensure 1-2 page limits and pristine formatting.
- **Compiler Handoff:** To save compute, the user is provided with the final LaTeX code and instructions to compile it themselves (e.g., via Overleaf).

### 2.3 Intelligent Matching & Gap Analysis (MVP)

- **Compatibility Check:** Before generating a resume, the system evaluates the database against the user-pasted job offer.
- **The "Underqualified" Flow:** If the match score is too low, the AI intervenes. It warns the user they are underqualified and suggests concrete, actionable steps to bridge the gap (e.g., "Build a full-stack React project," "Get the AWS Cloud Practitioner certificate").

### 2.4 Proactive Career Roadmapping ("Dream Job" Mode) (Post-MVP)

- **Future-Proofing:** Users input a "Dream Role." The AI provides concrete goals to upgrade their database over time.
- **Execution Planning:** Users can prompt the AI to break down these goals into actionable execution plans.

### 2.5 Application Ecosystem & AI Interview Simulator (Post-MVP)

- **Job Fetching Integrations:** Scraping or API fetching of job boards to remove the need for manual copy-pasting.
- **Holistic Checks:** Alerting users to missing external factors (portfolio, networking).
- **Interview Roleplay:** Interactive AI simulations (HR, Technical, Behavioral) based on the generated resume and job description.

## 3. User Flows (MVP)

### Flow A: Onboarding

1. User signs up.
2. Prompted to bootstrap database: Upload old resume, paste LinkedIn data, OR enter manually.
3. User can skip if they have a "blank slate."
4. AI parses input into the master JSON schema (`data_inventory.json`).
5. User reviews and approves the data.

### Flow B: Applying for a Job

1. User finds a job externally and pastes the Job Description + Company details into the app.
2. System evaluates match against the Master Database.
    - **Scenario 1 (Mismatch / Underqualified):** AI warns the user, halts generation (saving credits), and provides a roadmap of missing skills/projects to acquire.
    - **Scenario 2 (Strong Match):** Agentic pipeline kicks in.
3. Sequential agents extract requirements, filter the best user data, and draft tailored bullet points.
4. System maps content into the `.tex` template.
5. User receives the raw `.tex` code with a button to easily copy it and compile it on Overleaf.

## 4. Technical Architecture

### 4.1 Data Layer

- **User Schema:** A flexible JSON document (`data_inventory.json`) standardizing `personal_info`, `education`, `experiences`, `projects`, `skills`, and `certifications`.
- **Template Engine:** Heavy reliance on LaTeX (`resume_template.tex`) for output.

### 4.2 AI & Logic Layer (Sequential Pipeline vs. MapReduce)

- **Architecture Evaluation:** While a MapReduce approach was initially considered (mapping over requirements and reducing to bullet points), it is generally over-engineered and costly for this task. The combined context of a typical resume and job description (approx. 5k-10k tokens) easily fits into modern large context windows (like Gemini 1.5 Pro). Therefore, a faster, cheaper, and often more coherent approach for the MVP is a **Single-Pass Sequential Pipeline** leveraging Agentic "Chain of Thought".
- **The Sequential Agent Pipeline:**
    1.  **Extraction & Analysis (Agent 1):** Analyzes the Job Description and mathematically extracts core technical and soft skill requirements.
    2.  **Filtering & Matching (Agent 2):** Scans the Master JSON Database (user's `db.json`) for the most relevant facts, experiences, and metrics matching the analysis.
    3.  **Drafting & Formatting (Agent 3):** Synthesizes the filtered facts into concise, quantifiable, psychologically optimized LaTeX bullet points and outputs the final `.tex` code.
- **Prompt Architecture:** Employs "Amnesia mental model," strict XML tagging (`<job_context>`, `<user_db>`), role prompting, and tone control to mitigate hallucinations.

## 5. Pricing & Business Model

- **Freemium / Credit-Based System:**
    - **Free Tier:** Free database storage/management, free Gap Analysis (keeps users engaged even when they aren't applying), and 1-2 free generations to prove value.
    - **Pay-as-you-go (Credit Packs):** E.g., $10 for 10 tailored resumes. Direct margin on LLM API costs.
    - **Pro Subscription:** E.g., $15/month for active job seekers needing unlimited resumes and priority AI coaching.
