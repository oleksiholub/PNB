/**
 * Environment variable loading and validation - fail-fast on missing
 * required config.
 *
 * Sub-step C.2 addition: SERVICE_AUDIENCE and TRUSTED_SERVICE_ACCOUNTS
 * were OPTIONAL at introduction time (default to empty), because
 * requireGoogleServiceAuth was not yet mounted on any route.
 *
 * Sub-step G.1 UPDATE: requireGoogleServiceAuth is now mounted on
 * POST /ci-callback (backend/src/index.ts), so both variables are
 * effectively REQUIRED in any real deployment from this sub-step
 * onward - Cloud Build's service account email must be present in
 * TRUSTED_SERVICE_ACCOUNTS, and SERVICE_AUDIENCE must match the
 * audience Cloud Build requests via `gcloud auth print-identity-token
 * --audiences=<backend URL>` in cloudbuild.yaml. They remain z.string()
 * .optional() in the schema itself (not upgraded to required) because
 * requireGoogleServiceAuth already fails closed with an explicit 500 if
 * SERVICE_AUDIENCE is unset (see serviceAuth.ts) - duplicating that
 * enforcement at the env-schema level would just move the same failure
 * from request-time to boot-time without adding a new safety guarantee,
 * and would also block Iteration A-F deployments that legitimately don't
 * need this middleware yet.
 *
 * Sub-step F.1 addition: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY,
 * GITHUB_APP_INSTALLATION_ID are also OPTIONAL at this sub-step, for the
 * exact same "model exists before consumer" reason - githubAppAuth.ts
 * (F.1) can mint installation tokens once these are set, but no route
 * calls it until Sub-step F.3 (POST /push). Per TZ section 5 bootstrap
 * step 8 ("GitHub App private key stored in Secret Manager"),
 * GITHUB_APP_PRIVATE_KEY is expected to be injected as a Secret Manager
 * secret mounted as an env var on Cloud Run, never committed to the
 * repository or baked into the Docker image - see .env.example for the
 * placeholder and explicit warning.
 *
 * Sub-step F.2 addition: GITHUB_REPO_OWNER / GITHUB_REPO_NAME identify
 * the target repository for branch creation (githubBranchService.ts).
 * Also optional at introduction time, consumed from F.3 onward.
 *
 * Sub-step H.1 addition: GCP_PROJECT_ID, RETRY_QUEUE_NAME,
 * RETRY_QUEUE_LOCATION, RETRY_CALLBACK_BASE_URL, RETRY_QUEUE_INVOKER_SA,
 * RETRY_MAX_ATTEMPTS configure the Cloud Tasks-backed retry queue
 * (retryQueueService.ts / routes/retryTask.ts). RETRY_MAX_ATTEMPTS
 * defaults to 5, matching the illustrative queue config in
 * infra/create_retry_queue.sh - the two values must be kept in sync
 * manually, since Cloud Tasks queue-level maxAttempts and this env var
 * are two independent configuration surfaces (one infra-level, one
 * application-level for the exhaustion check in retryTask.ts) with no
 * API to read one from the other at request time without an extra
 * network call this sub-step does not introduce. All six vars are
 * OPTIONAL in the schema for the same "model exists before every
 * caller is wired" reason as prior additions - see retryQueueService.ts
 * INTEGRATION DISCLOSURE for the explicit gap this creates.
 */
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.string().default("8080"),
  GCP_REGION: z.string().min(1, "GCP_REGION is required"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  SERVICE_AUDIENCE: z.string().optional(),
  TRUSTED_SERVICE_ACCOUNTS: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_REPO_OWNER: z.string().optional(),
  GITHUB_REPO_NAME: z.string().optional(),
  GITHUB_DEFAULT_BRANCH: z.string().default("main"),
  GCP_PROJECT_ID: z.string().optional(),
  RETRY_QUEUE_NAME: z.string().optional(),
  RETRY_QUEUE_LOCATION: z.string().optional(),
  RETRY_CALLBACK_BASE_URL: z.string().optional(),
  RETRY_QUEUE_INVOKER_SA: z.string().optional(),
  RETRY_MAX_ATTEMPTS: z.coerce.number().default(5),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.message}`
    );
  }
  return parsed.data;
}