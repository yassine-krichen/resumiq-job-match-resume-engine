# AI Career Copilot & Resume Database

Welcome to the **AI Career Copilot** project. This platform shifts the paradigm of job hunting from reactively writing one-off resumes to proactively managing a centralized "Career Database." By maintaining a comprehensive JSON database of your skills, achievements, and metrics, you can leverage advanced AI to instantly generate highly tailored, ATS-optimized, and pristine LaTeX resumes for any job application.

## 🚀 The Core Concept

Instead of tweaking a Word document every time you apply for a job, you maintain a "Master Database" (JSON). When you find a job you want, the AI evaluates your database against the job description. If you're a match, it generates a perfectly crafted LaTeX resume. If there's a gap, the AI acts as your career coach, telling you exactly what to learn or build to become a top candidate.

## 📂 Project Structure

- `product_specification.md`: The detailed product spec, outlining the MVP features, user flows, and technical architecture.
- `resume-builder/`: The development directory for the new system.
    - `db.json`: The standard schema template for the master career database.
- `data_inventory.json`: Legacy/Personal baseline database (Do not modify).
- `resume_template.tex`: The base LaTeX template used for rendering the output.

## 💡 Upcoming Features & Roadmap (Post-MVP)

While the MVP focuses on manual job entry and user-side LaTeX compilation (via Overleaf), here is the vision for the future of the product:

1. **Automated Job & Profile Fetching:**
    - Integrating web scrapers or official APIs (e.g., LinkedIn, Indeed, Greenhouse) so users can just paste a URL, and the system fetches the job description, company tech stack, and company values automatically.
    - "Sync with LinkedIn" feature to automatically ingest new roles/skills into the Master Database.
2. **Integrated Web-based LaTeX Compilation:**
    - Moving away from the Overleaf handoff. Integrating a LaTeX compiler (like TeX Live via a Dockerized microservice or a WASM-based compiler like tectonic) directly into the app so users can see a live PDF preview and download it in one click.
3. **The "Holistic Application" Checker:**
    - The AI will review the user's online presence (GitHub, Personal Website, LinkedIn) as part of the readiness score and provide tips on networking (e.g., "Message an Engineering Manager before applying").
    - Email template generation for cold outreach and referrals.
4. **Interactive AI Interview Simulator:**
    - Voice or text-based mock interviews using LLM agents tailored to the generated resume, the company's specific interview style (e.g., FAANG behavioral, technical trivia), and the job description.
5. **Analytics & Auto-Apply:**
    - Tracking application success rates (Resume Score vs. Interview Rate).
    - Exploring auto-apply agents that navigate ATS portals (e.g., Workday, Lever) on behalf of the user.
