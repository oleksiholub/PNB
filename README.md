# PNB Backend — L2 Orchestrator (Iteration A, Sub-step A.1)

Scaffold for the Cloud Run backend service defined in tz-handoff_v4.md §3.2.

## Structure
- `src/config.ts` — centralized, secret-free runtime configuration + region budget guard.
- `Dockerfile` — multi-stage build, non-root runtime user, no baked-in secrets.
- `cloudbuild.yaml` — CI/CD pipeline targeting `us-east1` (Cloud Run Always Free budget constraint).
- `.env.example` — documents required environment variable NAMES only (no values, no secrets).

## Scope of this sub-step (A.1)
This sub-step delivers ONLY the project skeleton, build/deploy tooling, and region-locked
configuration loader. It does NOT implement `/capture`, `/healthz`, or any business logic —
those are Sub-steps A.2 and A.3 of Iteration A, per the binding plan.

## Region constraint
`GCP_REGION` defaults to and is validated against `us-east1`, per the TZ's Always Free
budget requirement. `assertBudgetRegion()` throws at startup if misconfigured, preventing
silent drift into a billed region.

## Complete tree of PNB files and folders
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
    ├── __tests__/
    │   └── captureService.test.ts
    ├── lib/
    │   └── logger.ts
    ├── repositories/
    │   └── contextRepository.ts
    ├── routes/
    │   └── capture.ts
    ├── services/
    │   └── captureService.ts
    └── validation/
        └── captureValidation.ts
