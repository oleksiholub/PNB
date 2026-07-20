/**
 * POST /ci-callback route handler (Sub-step G.1).
 *
 * Receives the Cloud Build pipeline's SUCCESS/FAILURE report (see
 * cloudbuild.yaml) and translates it into Firestore push_status updates
 * for every code_artifact currently sitting at PUSHED_NO_CI on the
 * reported branch_name.
 *
 * SCOPE BOUNDARY (binding plan, G.1 vs G.2): this handler ONLY records
 * the CI outcome as PUSHED (on SUCCESS) or CI_FAILED (on FAILURE). It
 * does NOT merge branches to main and does NOT set REQUIRES_REVIEW -
 * those are Sub-step G.2's exclusive responsibility.
 *
 * AUTH: mounted behind requireGoogleServiceAuth (Sub-step C.2), NOT
 * requireFirebaseAuth - this is a service-to-service callback from Cloud
 * Build's own service account, never an end-user request.
 *
 * IDEMPOTENCY: Cloud Build may retry a failed callback POST. This
 * handler is naturally idempotent because it performs a conditional
 * Firestore query (push_status == PUSHED_NO_CI) rather than an
 * unconditional overwrite.
 *
 * CONTRACT AMBIGUITY DISCLOSURE: see cloudbuild.yaml header - CI status
 * is resolved per target_branch, not per artifact_id, because Cloud
 * Build's trigger event only carries a branch name.
 */
import { Request, Response } from "express";
import { ZodError } from "zod";
import { CiCallbackSchema } from "../schemas/ciCallback";
import { codeArtifactsCollection } from "../models/collections";
import { withLogContext } from "../logger";

export async function handleCiCallback(req: Request, res: Response): Promise<void> {
  const traceId = req.traceId;

  let payload;
  try {
    payload = CiCallbackSchema.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) {
      withLogContext({
        trace_id: traceId,
        operation_type: "ci_callback",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn({ issues: err.issues }, "ci-callback payload failed validation");
      res.status(400).json({ error: "invalid_payload", trace_id: traceId, details: err.issues });
      return;
    }

    withLogContext({
      trace_id: traceId,
      operation_type: "ci_callback",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "unexpected error during ci-callback validation");
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  const { branch_name, build_id, commit_sha, ci_status } = payload;
  const newPushStatus = ci_status === "SUCCESS" ? "PUSHED" : "CI_FAILED";

  try {
    const collection = codeArtifactsCollection();
    const matching = await collection
      .where("target_branch", "==", branch_name)
      .where("push_status", "==", "PUSHED_NO_CI")
      .get();

    if (matching.empty) {
      withLogContext({
        trace_id: traceId,
        operation_type: "ci_callback",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info(
        { branch_name, build_id, ci_status },
        "ci-callback received but no PUSHED_NO_CI artifacts found for this branch (already processed or none pushed)"
      );
      res.status(200).json({
        accepted: true,
        updated_count: 0,
        trace_id: traceId,
        note: "No matching PUSHED_NO_CI artifacts for this branch; likely already processed by a prior callback delivery.",
      });
      return;
    }

    const batch = collection.firestore.batch();
    for (const doc of matching.docs) {
      batch.set(
        doc.ref,
        {
          push_status: newPushStatus,
          ci_build_id: build_id,
          ci_commit_sha: commit_sha,
        },
        { merge: true }
      );
    }
    await batch.commit();

    withLogContext({
      trace_id: traceId,
      operation_type: "ci_callback",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { branch_name, build_id, ci_status, updated_count: matching.size },
      "ci-callback processed, push_status updated for matching artifacts"
    );

    res.status(200).json({
      accepted: true,
      updated_count: matching.size,
      push_status: newPushStatus,
      trace_id: traceId,
    });
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      operation_type: "ci_callback",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "failed to apply ci-callback result to Firestore");
    res.status(500).json({ error: "internal_error", trace_id: traceId });
  }
}