# PNB Backend — L2 Orchestrator (Iteration A complete; Iteration B: B.1 done; Iteration C: C.1 done)

Scaffold for the Cloud Run backend service defined in tz-handoff_v4.md §3.2.

## Structure
- `src/config.ts` — centralized, secret-free runtime configuration + region budget guard.
- `src/server.ts` — Express app assembly: helmet, cors, traceId + request logging middleware, route mounting; `buildApp(config, firebaseApp?)` wires Firebase ID token auth onto `/capture` when a Firebase App is supplied (always true in production via `main()`).
- `src/lib/auth.ts` — **NEW (C.1)**: Firebase ID token verification middleware; binds `req.ownerUid` to a cryptographically verified identity, never trusting a client-supplied `owner_uid`.
- `src/routes/healthz.ts` — `GET /healthz` health-check (unauthenticated by design; Cloud Run/monitoring must reach it without a token).
- `src/routes/capture.ts` — `POST /capture` HTTP entrypoint; **updated (C.1)** to require `req.ownerUid` set by the auth middleware, overriding any client-supplied `owner_uid` in the body.
- `src/services/captureService.ts` — core `/capture` business logic: qa_status normalization, QA-gate push_status, idempotency dedup key, trace_id propagation.
- `src/repositories/contextRepository.ts` — persistence contract + in-memory reference implementation (still wired in `server.ts`; Firestore DI swap remains a follow-up).
- `src/repositories/firestoreContextRepository.ts` — Firestore-backed implementation using a transactional dedup-key document as a unique-constraint substitute.
- `src/lib/firestoreAdmin.ts` — Firebase Admin SDK bootstrap via Application Default Credentials.
- `src/lib/tracing.ts` — `traceIdMiddleware` + `getOrCreateTraceId`, one trace_id per request.
- `src/validation/captureValidation.ts` — structural validation of `POST /capture` against TZ §4.
- `src/types.ts` — shared TypeScript types mirroring TZ §4 exactly.
- `src/lib/logger.ts` — structured JSON logger (session_id, chat_id, trace_id, operation_type, result_status, retry_count).
- `src/lib/requestLogging.ts` — request logging middleware using the shared trace_id.
- `src/__tests__/` — Jest unit tests: `captureService.test.ts`, `healthz.test.ts`, `tracing.test.ts`, `auth.test.ts` (**NEW, C.1**; mocks Firebase Admin's `getAuth` to test middleware wiring without a live project).
- `firestore/firestore.rules` — Security Rules enforcing `request.auth.uid == owner_uid` on `contexts`; `code_artifacts`/`dead_letter` backend-only; `configs/selectors` read-only for authenticated clients.
- `firestore/firestore.indexes.json` — composite indexes for owner-scoped queries.
- `firebase.json` — points Firebase CLI at the rules/indexes files.
- `Dockerfile` — multi-stage build, non-root runtime user, no baked-in secrets.
- `cloudbuild.yaml` — CI/CD pipeline targeting `us-east1`.
- `.env.example` — required environment variable NAMES only.

## Iteration A — Summary (complete, consolidated)
A.1: project skeleton and deploy tooling. A.2: `POST /capture` with QA-gate push_status
and idempotent dedup keys. A.3: `GET /healthz` and structured request logging.

## Iteration B — Sub-step B.1 (complete)
Defined the Firestore schema surface (`contexts`, `code_artifacts`, `dead_letter`,
`configs/selectors`), implemented owner-scoped Security Rules per TZ §5, implemented
`FirestoreContextRepository` with transactional idempotency (closing CALIBRATION_DB
Iteration 1.6's gap at the real-database level), and fixed a latent Iteration A gap
where a single request could log two different `trace_id` values.

## Iteration C — Sub-step C.1: Firebase ID token verification (complete)
Implemented `createAuthMiddleware`, which verifies the `Authorization: Bearer <idToken>`
header via Firebase Admin SDK and sets `req.ownerUid` to the cryptographically verified
uid. `POST /capture` now derives its authoritative `owner_uid` EXCLUSIVELY from
`req.ownerUid`, discarding any `owner_uid` supplied in the request body. This closes a
security gap identified while building on top of B.1: without server-side token
verification, the Firestore Security Rules' `request.auth.uid == owner_uid` check would
have been meaningless for any write routed through this backend, since a client could
otherwise claim an arbitrary `owner_uid` directly in the JSON payload.
`buildApp(config, firebaseApp?)` makes the Firebase App an explicit, optional dependency:
when omitted, `/capture` runs unauthenticated (used only by Iteration A/B's existing unit
tests for backward compatibility); `main()` — the actual production entrypoint — always
initializes and passes a real Firebase App, so the deployed service is always
auth-enforced. IAM service-to-service auth for internal calls remains a follow-up item.

## Region constraint
`GCP_REGION` defaults to and is validated against `us-east1`. `assertBudgetRegion()`
throws at startup if misconfigured.

## Testing
`npm test` runs `captureService.test.ts`, `healthz.test.ts`, `tracing.test.ts`, and
`auth.test.ts` (the latter mocks `firebase-admin/auth` to test the middleware's
401/pass-through logic without a live Firebase project). Suite is authored and reviewed;
first real CI execution is scheduled for Iteration G.

## Open uncertainties
- Firestore Always Free quota behavior under real load: designed for, not yet measured.
- `github.com/oleksiholub/PNB` content: unverifiable at time of writing (fetch + search failed).
- Test suite: not yet executed in a real CI runner.
- `FirestoreContextRepository`: unit-testable in isolation; behavior against a live
  Firestore emulator/instance not yet exercised.
- IAM service-to-service auth (backend-internal calls) not yet implemented.

## Not yet implemented
- DI swap from `InMemoryContextRepository` to `FirestoreContextRepository` in `server.ts`.
- IAM service-to-service auth for internal calls.
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
├── firebase.json
├── firestore/
│   ├── firestore.indexes.json
│   └── firestore.rules
├── jest.config.js
├── package.json
├── tsconfig.json
└── src/
├── server.ts
├── types.ts
├── config.ts
├── tests/
│   ├── auth.test.ts
│   ├── captureService.test.ts
│   ├── healthz.test.ts
│   └── tracing.test.ts
├── lib/
│   ├── auth.ts
│   ├── firestoreAdmin.ts
│   ├── logger.ts
│   ├── requestLogging.ts
│   └── tracing.ts
├── repositories/
│   ├── contextRepository.ts
│   └── firestoreContextRepository.ts
├── routes/
│   ├── capture.ts
│   └── healthz.ts
├── services/
│   └── captureService.ts
└── validation/
└── captureValidation.ts
```