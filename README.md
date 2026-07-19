# PNB Backend — L2 Orchestrator (Iteration A: Complete — Sub-steps A.1-A.3)

Scaffold for the Cloud Run backend service defined in tz-handoff_v4.md §3.2.
Iteration A (basic backend + POST /capture) is now fully consolidated per the
Development Thread's Code Implementation Planning Protocol.

## Structure
- `src/config.ts` — centralized, secret-free runtime configuration + region budget guard.
- `src/server.ts` — Express app assembly: helmet, cors, request logging middleware, route mounting; `buildApp(config)` takes config explicitly for testability.
- `src/routes/healthz.ts` — `GET /healthz` health-check for Cloud Run and external monitoring (unauthenticated by design).
- `src/routes/capture.ts` — `POST /capture` HTTP entrypoint: validates payload, delegates to `CaptureService`, maps errors to safe HTTP responses.
- `src/services/captureService.ts` — core `/capture` business logic: qa_status normalization, QA-gate push_status assignment, idempotency dedup key construction.
- `src/repositories/contextRepository.ts` — persistence contract (`ContextRepository`) + in-memory reference implementation; Firestore-backed implementation lands in Iteration B.
- `src/validation/captureValidation.ts` — structural validation of the `POST /capture` request body against the TZ §4 data model.
- `src/types.ts` — shared TypeScript types mirroring TZ §4 (Data Model) exactly: `ContextRecord`, `CodeArtifact`, `MemoryBlob`, etc.
- `src/lib/logger.ts` — structured JSON logger; every log line carries `session_id`, `chat_id`, `trace_id`, `operation_type`, `result_status`, `retry_count` per TZ §3.2.
- `src/lib/requestLogging.ts` — Express middleware emitting one structured log line per request/response cycle (status code, duration, trace_id).
- `src/__tests__/` — Jest unit tests (`captureService.test.ts`, `healthz.test.ts`).
- `Dockerfile` — multi-stage build, non-root runtime user, no baked-in secrets.
- `cloudbuild.yaml` — CI/CD pipeline targeting `us-east1` (Cloud Run Always Free budget constraint).
- `.env.example` — documents required environment variable NAMES only (no values, no secrets).

## Iteration A — Consolidated Summary (Sub-steps A.1 → A.3)

### A.1 — Project skeleton and deployment tooling
Delivered the project skeleton, build/deploy tooling, and region-locked configuration
loader. Did not implement `/capture`, `/healthz`, or any business logic by design —
those were explicitly deferred to A.2 and A.3.

### A.2 — `POST /capture`
Implements the full `/capture` contract from TZ §3.2 and §4: accepts either a plain
(`user_message`/`model_response`) turn or a `code_artifact` payload with `push_requested`.
Normalizes a missing `qa_status` to `FAILED` per TZ §4 and assigns `push_status`
accordingly (`REJECTED_BY_QA_GATE` vs `PENDING`) as a placeholder for the full push
pipeline (Iteration F). Idempotency is enforced via a dedup key built from
`chat_id` + `content_hash` (code artifacts) or `chat_id` + a message-signature fallback
(plain turns), so retried/duplicate captures are explicitly reported as `DEDUPLICATED`
rather than silently reprocessed or collapsed into the same boolean outcome as a fresh
capture. Persistence uses an in-memory reference repository; the Firestore-backed
implementation is Iteration B, sub-step B.1 — a named, deliberate scope boundary rather
than a silent omission.

### A.3 — `GET /healthz` and structured request logging
Adds `GET /healthz`, returning `{ status, region, uptime_seconds, timestamp }`,
intentionally left unauthenticated so Cloud Run health probes and external uptime
monitors can reach it without a Firebase ID token (auth enforcement for
`/capture`-class routes is Iteration C). Adds `requestLoggingMiddleware`, which emits
one structured JSON log line per HTTP request/response cycle — carrying `trace_id`,
`operation_type` (`METHOD path`), `result_status`, status code, and duration — so every
request is observable even before Iteration H's full error/retry telemetry lands.

## Region constraint
`GCP_REGION` defaults to and is validated against `us-east1`, per the TZ's Always Free
budget requirement. `assertBudgetRegion()` throws at startup if misconfigured, preventing
silent drift into a billed region.

## Testing
Run `npm test` to execute the Jest suite (`captureService.test.ts` covers idempotency and
the QA gate; `healthz.test.ts` covers the health endpoint's shape and its intentional lack
of auth). `supertest` is used for HTTP-level assertions against the Express app without
binding a real port. Note: as of this consolidation, the suite has been authored and
statically reviewed but not yet executed inside an actual CI runner — first real execution
is scheduled for Iteration G (Cloud Build CI/merge automation). Treat suite results as
Likely-correct-by-inspection, not yet Established-by-execution.

## Open uncertainties carried forward from Iteration A
- Firestore Always Free quota behavior under real load is designed for, not yet measured.
- The `github.com/oleksiholub/PNB` repository content could not be independently verified
  (fetch and search both failed) — treated as Unknown, not incorporated as fact.
- Test suite has not yet run in an executing environment (see Testing section above).

## Not yet implemented (tracked in the binding Development Thread plan)
- Firestore-backed persistence, Security Rules, and full trace/logging pipeline (Iteration B).
- Firebase Auth: ID token verification on `/capture`, IAM service-to-service auth (Iteration C).
- Browser extension (L1) and selector-config (Iteration D).
- LangGraph memory orchestration, `POST /handoff`, `GET /context/:chatId` (Iteration E).
- GitHub App installation-token push pipeline, `POST /push` (Iteration F).
- Cloud Build CI/merge automation (Iteration G).
- Retry queue, dead-letter, Firestore quota guardrails (Iteration H).
- Android-browser acceptance testing (Iteration I) and production hardening (Iteration J).

## Complete tree of PNB files and folders
```
pnb-backend/
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── cloudbuild.yaml
├── jest.config.js
├── package.json
├── tsconfig.json
└── src/
├── server.ts
├── types.ts
├── config.ts
├── tests/
│   ├── captureService.test.ts
│   └── healthz.test.ts
├── lib/
│   ├── logger.ts
│   └── requestLogging.ts
├── repositories/
│   └── contextRepository.ts
├── routes/
│   ├── capture.ts
│   └── healthz.ts
├── services/
│   └── captureService.ts
└── validation/
└── captureValidation.ts
```