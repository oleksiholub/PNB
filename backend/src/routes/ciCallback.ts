/**
 * POST /ci-callback route handler.
 *
 * Sub-step G.1: receives Cloud Build's SUCCESS/FAILURE report and
 * translates it into a push_status update for every code_artifact
 * currently at PUSHED_NO_CI on the reported branch_name.
 *
 * Sub-step G.2 UPDATE: on CI_STATUS=SUCCESS, this handler now ALSO
 * attempts the merge-on-green-CI step (TZ section 3.2/5) via
 * githubMergeService.mergeSessionBranchIntoDefault(), setting
 * push_status to MERGED (with merge_commit_sha) or REQUIRES_REVIEW
 * (with a conflict message) instead of stopping at plain "PUSHED". On
 * CI_STATUS=FAILURE, behavior is unchanged from G.1: push_status is set
 * to CI_FAILED and no merge is attempted, since merging a branch that
 * failed CI would violate the TZ's explicit "CI gates merge" requirement.
 *
 * SCOPE BOUNDARY (binding plan): this handler still does NOT create a
 * pull request, does NOT retry failed merges automatically, and does
 * NOT resolve REQUIRES_REVIEW automatically - REQUIRES_REVIEW is a
 * terminal state requiring manual intervention, per the explicit gap
 * noted in githubMergeService.ts. Building a webhook-driven
 * auto-recovery from REQUIRES_REVIEW is out of scope for G.2.
 *
 * AUTH: mounted behind requireGoogleServiceAuth (Sub-step C.2), NOT
 * requireFirebaseAuth - this is a service-to-service callback from Cloud
 * Build's own service account, never an end-user request.
 *
 * IDEMPOTENCY: Cloud Build may retry a failed callback POST. The
 * SUCCESS path is idempotent in the CI-recording sense (conditional
 * query on push_status == PUSHED_NO_CI, as in G.1), but the merge
 * attempt itself is NOT re-entered on a retried callback once the first
 * delivery has already moved matching artifacts off PUSHED_NO_CI -
 * exactly the same "PUSHED_NO_CI" gate that made G.1 idempotent also
 * prevents G.2 from double-merging on a redelivered callback, since a
 * second delivery finds zero PUSHED_NO_CI documents and skips the merge
 * entirely (see the `matching.empty` branch below).
 *
 * CONTRACT AMBIGUITY DISCLOSURE: see cloudbuild.yaml / G.1 header - CI
 * status (and now merge outcome) is resolved per target_branch, not per
 * artifact_id, because Cloud Build's trigger event only carries a
 * branch name. All PUSHED_NO_CI artifacts on that branch receive the
 * SAME merge outcome (MERGED or REQUIRES_REVIEW), since they share one
 * underlying Git branch and therefore one actual merge attempt.
 *
 * Sub-step H.0 FIX: the call to mergeSessionBranchIntoDefault() below now
 * passes traceId as its second argument, matching the corrected signature
 * in githubMergeService.ts (see that file's own H.0 fix note) - the
 * previous single-argument call was a genuine bug that would not have
 * compiled once the callee required traceId.
 *
 * Sub-step H.4 addition: both batch.commit() calls (CI_FAILED branch and
 * SUCCESS/merge branch) now call getQuotaGovernor().recordWrite() once
 * per document actually written in that batch (matching.size writes),
 * closing the second of the two gaps the H.3 README explicitly flagged
 * as not yet instrumented. This is purely observational bookkeeping for
 * QuotaGovernor's per-instance sliding window - it does not change
 * ci-callback's merge/CI-failure behavior in any way.
 */
import { Request, Response } from "express";
import { ZodError } from "zod";
import { CiCallbackSchema } from "../schemas/ciCallback";
import { codeArtifactsCollection } from "../models/collections";
import { withLogContext } from "../logger";
import { mergeSessionBranchIntoDefault } from "../services/githubMergeService";
import { getQuotaGovernor } from "../services/quotaGovernor";

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

    if (ci_status === "FAILURE") {
      const batch = collection.firestore.batch();
      for (const doc of matching.docs) {
        batch.set(
          doc.ref,
          {
            push_status: "CI_FAILED",
            ci_build_id: build_id,
            ci_commit_sha: commit_sha,
          },
          { merge: true }
        );
      }
      await batch.commit();
      // Sub-step H.4: this batch.commit() performs matching.size
      // individual document writes within one Firestore transaction -
      // QuotaGovernor's window counts write OPERATIONS, so this records
      // one recordWrite() call per document actually written, matching
      // how capture.ts's single-document writes are counted, rather than
      // treating a multi-document batch as a single unit of write
      // pressure it is not.
      for (let i = 0; i < matching.size; i += 1) {
        getQuotaGovernor().recordWrite();
      }

      withLogContext({
        trace_id: traceId,
        operation_type: "ci_callback",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info(
        { branch_name, build_id, ci_status, updated_count: matching.size },
        "ci-callback processed: CI failed, push_status set to CI_FAILED, no merge attempted"
      );

      res.status(200).json({
        accepted: true,
        updated_count: matching.size,
        push_status: "CI_FAILED",
        trace_id: traceId,
      });
      return;
    }

    // ci_status === "SUCCESS": attempt merge-on-green-CI (Sub-step G.2)
    // Sub-step H.0 FIX: mergeSessionBranchIntoDefault() now requires a
    // traceId parameter (see githubMergeService.ts's H.0 header) - the
    // original call site omitted it entirely, which would have failed
    // TypeScript compilation once the callee's signature was corrected.
    const mergeResult = await mergeSessionBranchIntoDefault(branch_name, traceId);
    const newPushStatus = mergeResult.outcome; // "MERGED" | "REQUIRES_REVIEW"

    const batch = collection.firestore.batch();
    for (const doc of matching.docs) {
      const updateFields: Record<string, unknown> = {
        push_status: newPushStatus,
        ci_build_id: build_id,
        ci_commit_sha: commit_sha,
      };
      if (mergeResult.outcome === "MERGED" && mergeResult.merge_commit_sha) {
        updateFields.merge_commit_sha = mergeResult.merge_commit_sha;
      }
      batch.set(doc.ref, updateFields, { merge: true });
    }
    await batch.commit();
    // Sub-step H.4: same per-document recordWrite() accounting as the
    // FAILURE branch above.
    for (let i = 0; i < matching.size; i += 1) {
      getQuotaGovernor().recordWrite();
    }

    withLogContext({
      trace_id: traceId,
      operation_type: "ci_callback",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      {
        branch_name,
        build_id,
        ci_status,
        updated_count: matching.size,
        merge_outcome: mergeResult.outcome,
        conflict_message: mergeResult.conflict_message,
      },
      mergeResult.outcome === "MERGED"
        ? "ci-callback processed: CI succeeded, branch merged into default"
        : "ci-callback processed: CI succeeded but merge conflict detected, marked REQUIRES_REVIEW"
    );

    res.status(200).json({
      accepted: true,
      updated_count: matching.size,
      push_status: newPushStatus,
      merge_commit_sha: mergeResult.merge_commit_sha,
      conflict_message: mergeResult.conflict_message,
      trace_id: traceId,
    });
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      operation_type: "ci_callback",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "failed to apply ci-callback result / merge to Firestore or GitHub");
    res.status(500).json({ error: "internal_error", trace_id: traceId });
  }
}