# Ai-Web-Scrapper

This repository is a Turborepo monorepo that implements a small AI-assisted web app:

- **apps/web**: a Next.js frontend (React) that provides the user interface.
- **apps/server**: an Express-based backend that scrapes websites, enqueues tasks, processes them with Playwright and BullMQ, stores data in PostgreSQL, and queries Google Generative AI (Gemini) to answer user questions using only scraped content.
- **packages/db**: shared Drizzle ORM schema and DB helpers used by the server.

Core services used by the project: PostgreSQL (data), Redis (queues), and Google Generative AI (Gemini) for LLM responses.

**Primary purpose:** demonstrate an end-to-end pipeline for scraping web content, persisting it, running background processing, and answering questions using a generative AI constrained to the provided content.

## Local setup

Prerequisites:

- Node.js >= 18
- pnpm (used as package manager)
- Docker and docker-compose (for local Postgres and Redis)
- (Optional) Google Gemini API key

1. Clone the repo and enter it:

```bash
git clone (https://github.com/Adam2053/ai-web-scrapper.git)
cd ai-web-scrapper
```

2. Create a `.env` file at the repository root with at least the following values (adjust as needed):

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_tasks
GEMINI_API_KEY=your_gemini_api_key_here
```

Notes:

- The project reads `DATABASE_URL` from the root `.env` (used by `packages/db/drizzle.config.ts`). `apps/server` will also read `GEMINI_API_KEY` from the environment (you may place it in `apps/server/.env` if you prefer).

3. Start local infra (Postgres + Redis):

```bash
docker-compose up -d
```

4. Install workspace dependencies (from the repo root):

```bash
pnpm install
```

5. Run the apps in development:

- Run everything via Turborepo:

```bash
pnpm dev
```

- Or run apps individually from the workspace:

```bash
pnpm --filter server dev   # runs the Express backend (ts-node-dev)
pnpm --filter web dev      # runs the Next.js frontend on :3000
```

6. Build for production:

```bash
pnpm build
# start the web app
pnpm --filter web start
```

Environment variables used by the project (non-exhaustive):

- `DATABASE_URL` — Postgres connection string
- `GEMINI_API_KEY` — API key for Google Generative AI

Project layout (important folders):

- `apps/server` — backend code (Express, BullMQ, Playwright, workers)
- `apps/web` — Next.js frontend
- `packages/db` — Drizzle schema and DB helpers

If you want, I can also:

- add a sample `.env.example` file
- add a `Makefile` or npm script to simplify local setup
- document any additional environment variables or DB migration steps

---

Updated README to describe project function and local setup.
