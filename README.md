# Agent Suite

Three multi-tenant RAG products in one deployable repo. The frontend is React 19 + TypeScript + Tailwind v4 and the backend is FastAPI + Pydantic v2. Everything runs on free tiers and deploys to Vercel as a single project.

| App | What it does | Frontend | Backend |
|---|---|---|---|
| **Questionnaire Autopilot** | Drafts security questionnaire / RFP answers from your policy library, with confidence tags and verifiable citations | `frontend/src/apps/questionnaire-autopilot/` | `backend/app/apps/questionnaire/` |
| **Site Support Agent** | Whitelabel chat widget builder: URL crawl, Slack escalation, brand styling, agency mode, live preview | `frontend/src/apps/site-support-agent/` | `backend/app/apps/support/` |
| **Study Copilot** | Course tutor with slide-cited answers, 3D flashcards, quizzes and per-topic mastery tracking | `frontend/src/apps/study-copilot/` | `backend/app/apps/study/` |

Shared code lives in:

- `frontend/src/shared/`: the `useAgentAPI` hooks, UI primitives and inline SVG icons.
- `backend/app/core/`: tenancy, streaming uploads, the job queue, the vector store and the LLM client.

## Run locally

Requirements: Node 20+ and Python 3.12–3.14. Python 3.15 is not supported yet because some dependencies don't publish wheels for it.

```bash
npm install
```

```bash
py -3.14 -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -r requirements.txt
```

Start the API on port 8000 and the web app on port 5173 in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev
```

Optionally load demo data for all three apps:

```bash
.venv/Scripts/python scripts/seed_demo.py
```

Open http://localhost:5173. Use **Alt+1/2/3** to switch apps, and set the **Workspace** field in the header to change tenant.

### Extractive mode vs LLM mode

With no API key the suite runs in **extractive mode**:

- Embeddings come from a local hashing vectorizer.
- Answers are the best-matching quoted passages.
- Quizzes and flashcards are cloze (fill-in-the-blank) items.

This is useful for development and costs nothing. To get real generated answers, copy `.env.example` to `.env` and set:

```
LLM_API_KEY=<free Gemini key from https://aistudio.google.com/apikey>
LLM_FALLBACK_API_KEY=<optional free Groq key>
```

The LLM client is the official `AsyncOpenAI` SDK pointed at any OpenAI-compatible endpoint. It works like this:

- It requests strict `json_schema` structured output generated from the Pydantic models.
- If a provider rejects `json_schema`, it falls back to `json_object` mode.
- It validates every response with Pydantic.
- It drops any citation whose chunk id was not actually retrieved.

The header's status dot shows which mode the API is in.

If you change embedding providers, re-upload your documents, because vectors from different models aren't comparable.

## Deploy to Vercel (free)

1. Create a free **Supabase** (or Neon) Postgres project and copy its connection string. The `vector` extension and tables are created automatically on first boot.
2. Import the repo into Vercel. `vercel.json` already does three things:
   - builds the Vite app to `dist/`,
   - serves FastAPI from `api/index.py`,
   - rewrites `/api/*` to that function.
3. Set these environment variables: `DATABASE_URL`, `LLM_API_KEY`, `API_KEYS` (for example `{"sk_acme_xxx":"acme"}`), and optionally `LLM_FALLBACK_API_KEY`.

**`DATABASE_URL` is required on Vercel.** Serverless instances don't share a disk, so without Postgres, data written by one request is invisible to the next. Uploaded files are written to `/tmp` only long enough to extract their text; the text and vectors are kept in Postgres.

### Free-tier caveats

- **Vercel Hobby is for non-commercial use.** Upgrade to Pro before you charge customers.
- **Gemini's free tier may use prompts to improve Google's products.** Don't send confidential customer documents through it. This matters most for Questionnaire Autopilot; switch to a paid tier first.
- **Background jobs run inside the request's function invocation** (FastAPI `BackgroundTasks`), with `maxDuration` set to 60s. That's enough for typical documents. For very large files or crawls, move indexing to a queue such as Inngest or Upstash QStash.
- **The public chat rate limiter is per instance.** For a global limit, use Upstash Redis.

## API overview

All endpoints except `/api/v1/support/public/*` require `Authorization: Bearer <api-key>`. In development you can send `X-Tenant-ID: <tenant>` instead. Every store query filters by tenant.

Interactive docs: http://localhost:8000/api/docs

| Area | Endpoints |
|---|---|
| Ingestion | `POST /api/v1/artifacts/upload?app=&scope=` (raw body streamed in 1 MB blocks, `X-Filename` header) · `GET /api/v1/artifacts` · `GET /api/v1/artifacts/chunks?ids=` · `DELETE /api/v1/artifacts/{id}` · `GET /api/v1/jobs/{id}` |
| Questionnaire | `…/questionnaires` CRUD · `…/import` (XLSX/CSV/DOCX) · `…/{id}/autofill` (job) · `PATCH …/rows/{row}` · `…/rows/{row}/regenerate` · `…/export.csv` |
| Support | `…/widgets` CRUD · `…/sources/url` (SSRF-safe crawl job) · `…/slack/test` · `…/tickets` · public `config`, `chat` and `escalate` |
| Study | `…/courses` CRUD · topics · `…/syllabus/generate` · `…/chat` · `…/flashcards/generate` · `/flashcards/{id}/review` · `…/quizzes/generate` · `/quizzes/{id}/answer` |

## Tests

```bash
cd backend && ../.venv/Scripts/python -m pytest -q
```

The end-to-end tests run in extractive mode and cover, for all three apps:

- upload → index → answer,
- tenant isolation,
- SSRF blocking,
- quiz answer hiding,
- mastery updates.
