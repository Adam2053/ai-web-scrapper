# Architecture: AI-powered Website Analyzer

Version: 1.0
Date: 2026-02-25

This document describes the architecture and design rationale for the AI-powered Website Analyzer application. It is written for a technical reviewer (hiring manager or engineering lead) and documents system components, data flow, resilience, scaling, and production considerations.

## 1. High-Level System Overview

The application enables users to submit a website URL and a natural-language question about that site. The system performs asynchronous processing to scrape the site, extract and normalize content, send the content (with the user question) to Google Gemini, and returns an answer to the user once processing completes.

Key characteristics:

- Asynchronous task-based processing using BullMQ (Redis-backed queue).
- Headless browser scraping using Playwright to capture page content reliably.
- Generative AI (Google Gemini) constrained to the provided content by prompt engineering and token trimming.
- Persistent task state and results stored in PostgreSQL using Drizzle ORM.
- Frontend uses TanStack Query to submit tasks and poll for completion, enabling optimistic UI and progressive feedback.

Primary non-functional goals:

- Reliability: tasks must not be lost; failures should be observable.
- Scalability: workers must scale independently of the web/API layer.
- Cost control: avoid sending unnecessary tokens to the AI service.
- Security: prevent SSRF and minimize the blast radius of scraping.

## 2. Architecture Diagram (Mermaid)

```mermaid
flowchart LR
  subgraph User
    U[User (browser)]
  end

  subgraph Frontend
    W[Next.js (App Router) + TanStack Query]
  end

  subgraph API
    S[Express API Server]
  end

  subgraph Infra
    R[Redis (BullMQ)]
    P[PostgreSQL (Drizzle ORM)]
    Q[Worker(s) (Playwright + Gemini)]
  end

  U -->|POST /tasks| W
  W -->|POST /tasks| S
  S -->|writes task & enqueues| P
  S -->|enqueue job| R
  Q -->|dequeue & process| R
  Q -->|scrape (Playwright)| Web
  Q -->|call Gemini| Gemini((Google Gemini))
  Q -->|persist results| P
  W -->|GET /tasks/:id (poll)| S
  S -->|read status| P

  style Gemini fill:#f9f,stroke:#333,stroke-width:1px
  style Web fill:#eef,stroke:#333,stroke-width:1px
```

## 3. Monorepo Structure

- `apps/web` — Next.js frontend using the App Router, TypeScript, Tailwind CSS, and `@tanstack/react-query` for mutation/polling patterns.
- `apps/server` — Express REST API, job enqueueing (BullMQ), job producer and lightweight orchestration; separate worker process(s) that consume jobs using Playwright and the Gemini client.
- `packages/db` — Drizzle ORM schema definitions and migrations. Shared by `apps/server` and worker processes.
- Root-level `docker-compose.yaml` — local development stack (Postgres + Redis).
- Root-level `pnpm` workspace configuration and Turbo for cross-package tasks.

File-level responsibilities:

- `apps/server/src/routes/task.routes.ts` — request validation and DB + queue orchestration for `POST /tasks` and `GET /tasks/:id`.
- `apps/server/src/queue/task.queue.ts` — BullMQ queue and job configuration (retry/backoff defaults, rate-limited job handling).
- `apps/server/src/worker/task.worker.ts` — worker process using Playwright to scrape, then calling the AI layer and persisting results.

## 4. Request Flow (step-by-step lifecycle)

1. Client (Next.js) submits `POST /tasks` with `{ url, question }`.
2. Express validates the URL and input; creates a DB row in `tasks` with state `queued` and a UUID primary key.
3. Express enqueues a BullMQ job with the `taskId` and metadata. Enqueue options include job attempts and deterministic backoff strategy.
4. A worker picks up the job from Redis. Worker updates `tasks.status` to `processing` and writes `updated_at`.
5. Worker executes Playwright to load the URL with `domcontentloaded` strategy, a controlled user-agent, and a per-page timeout.
6. Worker extracts and normalizes page content (trim, remove noisy sections, chunk into token-aware segments), then runs token-trimming logic to ensure the sent prompt fits Gemini limits.
7. Worker constructs a grounded prompt with explicit instructions to only use the provided content and to avoid hallucination.
8. Worker calls Gemini (with retries, exponential backoff, and rate-limit detection). On transient errors, it retries according to backoff policy.
9. On success, the worker persists the generated answer into `tasks.answer`, sets `tasks.status = completed`, and updates timestamps.
10. If the job fails irrecoverably, the worker writes the `error` field on the `tasks` record and sets `status = failed`.
11. Client polls `GET /tasks/:id` using TanStack Query (with a stop condition when `status` ∈ {completed, failed}).

## 5. Database Design

Using PostgreSQL and Drizzle ORM. Table `tasks` captures the lifecycle and result.

DDL (illustrative):

```sql
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  question text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
  answer text NULL,
  error text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_created_at ON tasks (created_at);
```

Drizzle: schema uses a `enum` mapping for `status` and typed columns. Keep the answer as `text` (or `jsonb` if returning structured metadata). For large answers, consider `text` with truncation policy and a `result_meta` jsonb column for auxiliary metadata (e.g., token usage, prompt summary).

## 6. Queue & Worker Architecture

- BullMQ + Redis for job scheduling and visibility. Redis acts as broker and state store for job attempts, backoff, and delayed retries.
- Job payload: minimal — `taskId`, source `url`, internal `scrapeOptions`. Keep payload small to avoid Redis memory pressure.
- Worker process responsibilities:
  - Update DB status to `processing` when a job is acquired.
  - Run scraping step (Playwright) in a sandboxed environment.
  - Normalize and trim content.
  - Submit to AI layer and persist results.
  - Emit metrics and logs for failures / latency.

Concurrency and scaling:

- Worker concurrency is configured via BullMQ `concurrency` parameter. For IO-heavy tasks (network + API calls), pick a concurrency that balances Playwright browser instances and CPU.
- Horizontal scaling: run multiple worker instances (stateless), each connecting to the same Redis. Use Docker + orchestrator (K8s) to scale workers based on queue length or custom metrics.

Retry/backoff strategy:

- Use exponential backoff with jitter for transient failures (Playwright navigation timeouts, Gemini rate limits, network hiccups).
- Example backoff: base 2s, factor 2, max 30s, full jitter. Track attempt count; escalate to `failed` after N attempts (e.g., 5).

Rate-limit handling for AI calls:

- Detect rate-limited responses using the Gemini SDK or HTTP status codes and headers.
- Use a dedicated per-worker backoff and global rate-limiting token bucket (optional) to reduce coordinated retries across many workers.

## 7. Scraping Strategy

- Playwright (Chromium headless) with `domcontentloaded` navigation strategy to minimize waiting for long-running resources while still obtaining meaningful DOM content.
- Browser options:
  - Launch with a minimal profile and sandboxing where supported.
  - Supply a realistic `User-Agent` header and common viewport size.
  - Disable images / heavy subresources when possible to reduce bandwidth/time.

- Scrape safeguards:
  - Per-page timeout (e.g., 15–30s) to prevent worker starvation.
  - Maximum content size cap (character/byte limit) before trimming.
  - Respect `robots.txt` and optionally a domain allowlist for production deployments.

- Content processing:
  - Extract main article/body using heuristics (e.g., DOM density, main element selectors) and fall back to full HTML text when extraction fails.
  - Normalize whitespace, remove script/style tags, and strip navigation/ads if detectable.
  - Chunk content into token-bound segments with overlap to preserve context while keeping token counts bounded.

## 8. AI Integration Strategy

Model: Google Gemini (`gemini-1.5-flash` in production plan; local code references use `gemini-3-flash-preview` where applicable in development).

Prompt Engineering:

- Compose a strict system prompt that instructs the model to only use the provided content and to explicitly respond with a phrase when the answer is not available in the content.
- Provide context delimiters and explicit question restatement to reduce hallucination.

Token & content management:

- Token trimming pipeline:
  1. Precompute approximate tokens for content chunks (simple heuristic: characters/4 or use a tokenizer library).
  2. If token budget exceeded, prioritize sections (e.g., page title, headings, paragraphs with the question keywords).
  3. Assemble a prompt that includes a short summary and the most relevant content chunks.

Rate limiting, retries, and observability:

- Retries use exponential backoff with full jitter.
- For transient 429-like responses, increase backoff and optionally re-queue the job with a delay.
- Record token usage and latency in `result_meta` for cost attribution.

Security & data handling:

- Don’t send any user PII to the AI service unless explicitly required and consented.
- Treat all scraped content as potentially sensitive and store it only when necessary; set retention policy.

## 9. Error Handling & Resilience

Error propagation model:

- Workers catch exceptions at each stage (scrape, process, AI call). Transient errors trigger retries; terminal errors set `tasks.status = failed` and store a concise `error` message.
- Use structured logging (JSON) with correlation IDs (taskId) to trace across API, queue, and worker logs.

Failure scenarios and handling:

- Playwright navigation timeout:
  - Retry navigation up to a limited number of times.
  - If consistently failing, mark task failed and surface a human-readable message.
- AI rate limits:
  - Detect rate-limited responses and apply exponential backoff; if exhausted, set `error` with rate-limit hint and requeue with delay.
- Worker crashes:
  - Use process managers (systemd, Docker restart policy, or K8s pod restarts). BullMQ ensures the job is re-claimed or re-run according to job semantics.

Observability:

- Metrics: job queue length, job processing latency, Gemini latency and error rate, tokens consumed, scraped page sizes, worker CPU/memory.
- Tracing: use correlation IDs and attach them to logs and DB writes.

## 10. Scalability Considerations

Horizontal scaling:

- API tier: stateless — scale behind a load balancer.
- Worker tier: horizontally scale worker replicas based on queue length and custom indicators (e.g., number of delayed jobs, average job wait time).

Redis and BullMQ:

- Redis can be scaled with clustering for large deployments. Monitor memory usage and use small job payloads to reduce memory pressure.

Database:

- Postgres should be sized for write workloads and concurrency. Use connection pooling (PgBouncer) when multiple workers are employed.
- For higher scale, consider read replicas for query-heavy workloads (e.g., dashboards). Partition or archive older `tasks` rows to reduce table bloat.

Playwright scaling:

- Launch browser instances conservatively; consider a Puppeteer/Playwright pool or a headless-browser-as-a-service.
- Run Playwright in containerized environments tuned for CPU and memory; consider using a separate fleet for scraping to improve isolation.

Cost & throughput trade-offs:

- Token trimming reduces AI cost but risks losing context. Implement scoring for chunk relevance to minimize this risk.

## 11. Production Improvements (future enhancements)

- Vector store + embeddings (e.g., Pinecone, Milvus) to support retrieval-augmented generation and avoid full-page token sends.
- Incremental scraping and caching of extracted content with change detection.
- Fine-grained job prioritization and SLA tiers.
- Advanced observability: distributed tracing (OpenTelemetry) and SLO dashboards.
- Add a content moderation pipeline to detect policy-sensitive content before sending to Gemini.

## 12. Trade-offs & Design Decisions

- Asynchronous vs synchronous: chosen asynchronous (queue + worker) to avoid request timeouts and to decouple scraping/AI costs from frontend responsiveness.
- Playwright vs simple HTTP scraping: Playwright enables JS-heavy pages to be scraped reliably at higher cost; acceptable for feature completeness.
- Drizzle ORM: typed migrations and close-to-SQL control, chosen for developer ergonomics and TypeScript-first approach.
- Single table `tasks` vs multi-table results: single table is simpler and adequate for the internship scope; for larger scale, move answers to separate `task_results` with sharding/partitioning.

## 13. Security Considerations

Input validation and SSRF mitigations:

- Validate submitted `url` format and restrict to allowed protocols (`https` recommended). Implement an allowlist for production or sanitize internal hostnames to avoid intranet SSRF.
- Use a URL fetch proxy that enforces timeouts and IP blacklists/whitelists when executing Playwright.

Secrets and credentials:

- Never commit API keys. Use environment variables or a secrets manager (AWS Secrets Manager, GCP Secret Manager, or Vault).
- Limit Gemini API key scope and rotate periodically.

Playwright isolation:

- Run Playwright in isolated containers with limited network privileges and CPU/memory constraints. Use ephemeral storage and drop unnecessary capabilities.

Data governance:

- Scraped content may contain copyrighted or sensitive data. Publish a data retention policy and add controls to delete task records on user request.

Network security:

- Use TLS for all external communications. Restrict access to backend admin endpoints via firewall rules and IAM.

## 14. Deployment Strategy Overview

Local development:

- `docker-compose.yaml` runs Postgres and Redis locally. Run `pnpm install` then `pnpm --filter server dev` and `pnpm --filter web dev`.

Production deployment recommendations:

- Containerize components: API, worker(s), and optionally a Playwright worker image.
- Use Kubernetes (or serverless containers) with autoscaling: HPA for API/worker replicas based on CPU or custom metrics (queue length).
- Managed services: use managed Redis (Amazon ElastiCache / Azure Cache / Memorystore) and managed Postgres (RDS, Cloud SQL) for operational simplification.
- CI/CD: build images per commit, run integration tests that exercise end-to-end with a staging Gemini key, and deploy via canary or blue/green strategy.

Operational concerns:

- Secrets via Vault/Secret Manager; connection pooling for DB; monitoring (Prometheus + Grafana) for queue and AI metrics; alerting for abnormal error rates or queue growth.

## 15. Why This Architecture Is Scalable

- Clear separation of concerns: API, queue, and worker layers can be scaled independently.
- Stateless API tier: simple horizontal scaling for request volume.
- Worker autoscaling: queue-driven scaling aligns compute with demand and worker types can be specialized (scrapers vs AI callers).
- Cost containment: token trimming and chunking limit AI usage; observability enables cost attribution.

This design balances developer productivity and operational robustness appropriate for a production internship project while providing clear paths to scale and harden for real-world traffic.

---

If desired, follow-up artifacts that add value:

- `architecture/infra.md` with example Terraform snippets for managed Redis/Postgres.
- `architecture/observability.md` describing metric names, Prometheus rules, and dashboards.
- `architecture/sequence-diagrams.md` with more granular sequence diagrams for error cases.
