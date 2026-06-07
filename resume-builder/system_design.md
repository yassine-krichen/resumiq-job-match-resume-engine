# System Design & Tech Stack Proposal

To bring the AI Career Copilot out of the IDE and into a blazing-fast, clean web application, we need a tech stack that handles real-time UI updates (while LLM streams data) and robust AI orchestration on the backend.

## 1. The Stack Overview

### Frontend (User Interface)

- **Framework:** Next.js (React) - Server-side rendering, great SEO, and easy API route mapping.
- **Styling & UI:** Tailwind CSS combined with `shadcn/ui` for a highly polished, accessible, and minimalist interface (crucial for a "resume" tool to feel professional).
- **State Management:** Zustand (lightweight) for managing the user's master DB state locally before sync.
- **LaTeX Preview:** `react-pdf` or a lightweight WASM-based LaTeX compiler in the browser (like `tectonic`) if we want to show a live preview before they go to Overleaf.

### Backend (Orchestration & AI)

- **Framework:** FastAPI (Python) - Python is the undisputed king of AI orchestration. FastAPI is incredibly fast, auto-generates Swagger docs, and handles asynchronous LLM calls gracefully.
- **LLM Integration:**
    - _Option A (LangChain/LangGraph):_ Good for complex, multi-agent looping workflows.
    - _Option B (PydanticAI / Instructor):_ **(Highly Recommended)** Instead of heavy LangChain bloat, we use raw LLM SDKs (OpenAI/Gemini) mapped through `Pydantic`. This guarantees the LLM returns our exact JSON structures for Agent 1 and Agent 2 without parsing errors.
- **Database:** PostgreSQL (via Supabase or Neon). We will rely heavily on Postgres's `JSONB` columns to store the user's unstructured/structured database (`db.json`) flexibly.
- **ORM:** SQLAlchemy or SQLModel (FastAPI native).
- **Authentication:** Clerk or NextAuth (seamless integration with Next.js).

## 2. Infrastructure & Deployment

- **Frontend Hosting:** Vercel (native for Next.js, zero-config).
- **Backend Hosting:** Render or Railway (for serverless Python/Postgres) or an AWS EC2/ECS instance if we want more control.
- **Cost Management:** We will implement strict chunking and token limits on the Backend, storing user credit limits in Postgres.

## 3. High-Level Web App Flow

1. User logs in (Clerk) -> Redirected to `/dashboard`.
2. App fetches their `Master DB` from Postgres (JSONB) -> User edits info via slick React forms (Auto-saves to Backend).
3. User goes to `/generate` -> Pastes Job Description -> Hits "Analyze".
4. Next.js triggers a Server-Sent Event (SSE) to FastAPI.
5. FastAPI runs **Agent 1** -> **Agent 2** -> **Agent 3** sequentially, streaming progress updates ("Analyzing Job...", "Finding Best Experience...", "Drafting Bullet Points...") back to the UI.
6. User is presented with the generated `.tex` code and a one-click "Copy to Overleaf" button.
