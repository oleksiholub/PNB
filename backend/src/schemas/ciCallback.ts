/**
 * Validation schema for POST /ci-callback (Sub-step G.1).
 *
 * Payload shape mirrors the substitutions/built-in variables Cloud
 * Build's own step script (cloudbuild.yaml) sends: branch_name,
 * build_id, commit_sha, ci_status. ci_status is constrained to exactly
 * the two outcomes Cloud Build itself can determine (SUCCESS/FAILURE) -
 * it does NOT include Firestore's PushStatus vocabulary (PUSHED,
 * CI_FAILED, etc.) because Cloud Build has no knowledge of PNB's
 * Firestore schema; the route handler (ciCallback.ts) is responsible for
 * translating this narrower CI-only signal into the broader push_status
 * state machine, not the schema itself.
 */
import { z } from "zod";

export const CiCallbackSchema = z.object({
  branch_name: z.string().min(1),
  build_id: z.string().min(1),
  commit_sha: z.string().min(1),
  ci_status: z.enum(["SUCCESS", "FAILURE"]),
});

export type CiCallbackPayload = z.infer<typeof CiCallbackSchema>;