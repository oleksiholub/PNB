/**
 * Sub-step H.3.5 addition: both capture failure branches (code artifact
 * and conversation turn) now call enqueueRetryTask() (H.1's
 * retryQueueService.ts) BEFORE falling back to a direct recordDeadLetter()
 * write. This closes a gap that was implicitly carried over, undocumented,
 * from the original implementation plan's H.2 line item "подключение
 * реальной бизнес-логики в OPERATION_HANDLERS" - that specific task was
 * never actually done in H.2 (H.2 only implemented the summarization
 * error-handling contract), leaving retryTask.ts's OPERATION_HANDLERS
 * empty AND capture.ts's failure paths still writing directly to
 * dead_letter with no enqueue step at all. Both halves of that gap are
 * fixed together in this sub-step: retryTask.ts now has real handlers
 * (services/captureRetryHandlers.ts), and capture.ts now actually calls
 * enqueueRetryTask() so those handlers have a caller. If enqueueRetryTask
 * itself throws (e.g. Cloud Tasks env vars unset per retryQueueService.ts's
 * guard clause), this file falls back to the pre-H.3.5 direct
 * recordDeadLetter() behavior rather than losing the event silently.
 */
/**
 * Sub-step H.0 FIX (applied on top of prior sub-steps): two changes in
 * this file this sub-step: (1) target_branch now uses the shared
 * buildSessionBranchName() from utils/branchNaming.ts instead of an
 * inline `auto/${session_id}` template literal duplicated with
 * githubBranchService.ts's (now-removed) private copy of the same
 * formula; (2) the conversation-capture path no longer performs an
 * extra `await docRef.get()` solely to learn raw_history_refs.length
 * after already computing that same array one line earlier - refCount
 * is now tracked locally as refCountLocal, removing one redundant
 * Firestore round-trip per conversation-turn capture.
 */
/**
 * Sub-step H.3 addition: the conversation-turn branch (NOT the
 * code_artifact branch - see captureBatchBuffer.ts SCOPE DISCLOSURE for
 * why code artifacts are excluded) now consults getQuotaGovernor() per
 * TZ 3.4's Firestore-quota-pressure clause before deciding how to
 * persist:
 *   - "normal" mode: unchanged synchronous docRef.set(), same as H.0.
 *   - "aggressive"/"deferred" mode: the update is handed to
 *     enqueueBatchedCapture() (services/captureBatchBuffer.ts) instead
 *     of being written immediately, and the HTTP response honestly
 *     reports `persisted: false, batched: true` rather than claiming
 *     synchronous persistence that did not happen.
 * Background summarization cadence is also throttled under quota
 * pressure: halved frequency under "aggressive", skipped entirely for
 * the current turn under "deferred" - see the inline comment at the
 * summarization-trigger block below for the exact TZ 3.4 mapping.
 */
/**
 * POST /capture route handler.
 *
 * Sub-step C.1 change: owner_uid is now sourced exclusively from
 * `req.auth.uid`, populated by requireFirebaseAuth (verified Firebase ID
 * token) - the unverified `x-owner-uid` header from Iteration B is
 * REMOVED, not merely deprioritized. This closes the security gap
 * explicitly flagged in the B.2 README ("Security Rules alone do NOT
 * protect POST /capture today").
 *
 * requireFirebaseAuth is mounted ahead of this router in index.ts, so
 * req.auth is guaranteed to be populated by the time this handler runs;
 * TypeScript still models it as optional (see firebaseAuth.ts) since the
 * type is declared globally and Express cannot statically prove
 * middleware ordering, so a defensive fallback to "unknown" would mask a
 * real bug - instead, this handler treats a missing req.auth as an
 * internal error (should be unreachable given the current middleware
 * chain) rather than silently defaulting.
 *
 * Sub-step E.1 change: after a conversation-turn capture succeeds, the
 * updated raw_history_refs count is checked against
 * shouldTriggerSummarization() and, if due, summarizeAndUpdateMemory()
 * is invoked fire-and-forget (not awaited into the response) - TZ 3.3
 * treats summarization as an async orchestration step, not a
 * synchronous part of the capture contract, so a slow or failed
 * summarization must never delay or fail the client-facing response.
 */
import { Router, Request, Response } from "express";
import { ZodError } from "zod";
import {
  CaptureRequestSchema,
  normalizeQaStatus,
} from "../schemas/capture";
import { sha256Hex } from "../utils/hash";
import { buildSessionBranchName } from "../utils/branchNaming";
import { newArtifactId } from "../utils/ids";
import { withLogContext } from "../logger";
import { codeArtifactsCollection, contextCollection } from "../models/collections";
import { CodeArtifactDocument, ChatContextDocument } from "../models/types";
import { recordDeadLetter } from "../services/deadLetterService";
import {
  summarizeAndUpdateMemory,
  shouldTriggerSummarization,
  SUMMARIZATION_TRIGGER_EVERY_N_TURNS,
} from "../services/summarizationService";
import { getQuotaGovernor } from "../services/quotaGovernor";
import { enqueueBatchedCapture } from "../services/captureBatchBuffer";
import { enqueueRetryTask } from "../services/retryQueueService";

export const captureRouter = Router();

captureRouter.post("/capture", async (req: Request, res: Response) => {
  const traceId = req.traceId;

  if (!req.auth) {
    withLogContext({
      trace_id: traceId,
      operation_type: "capture_conversation",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      "req.auth missing in capture handler despite requireFirebaseAuth mounted ahead of this route - middleware ordering bug"
    );
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }
  const ownerUid = req.auth.uid;

  let parsed;
  try {
    parsed = CaptureRequestSchema.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) {
      withLogContext({
        trace_id: traceId,
        operation_type: "capture_conversation",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn({ issues: err.issues }, "capture payload failed validation");

      res.status(400).json({
        error: "invalid_payload",
        trace_id: traceId,
        details: err.issues,
      });
      return;
    }

    withLogContext({
      trace_id: traceId,
      operation_type: "capture_conversation",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "unexpected error during capture validation");

    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  const { chat_id, session_id } = parsed;

  if ("artifact_type" in parsed && parsed.artifact_type === "code") {
    const contentHash = sha256Hex(parsed.content);
    const qaStatus = normalizeQaStatus(parsed.qa_status);
    const collection = codeArtifactsCollection();

    try {
      const existing = await collection
        .where("chat_id", "==", chat_id)
        .where("content_hash", "==", contentHash)
        .limit(1)
        .get();

      if (!existing.empty) {
        const existingDoc = existing.docs[0].data();

        if (existingDoc.owner_uid !== ownerUid) {
          withLogContext({
            trace_id: traceId,
            chat_id,
            session_id,
            operation_type: "capture_code_artifact",
            result_status: "VALIDATION_FAILED",
            retry_count: 0,
          }).warn(
            "content_hash collision across different owner_uid - refusing to return cross-owner artifact"
          );
          res.status(403).json({
            error: "forbidden",
            trace_id: traceId,
            note: "A matching artifact exists but belongs to a different owner_uid.",
          });
          return;
        }

        withLogContext({
          trace_id: traceId,
          chat_id,
          session_id,
          operation_type: "capture_code_artifact",
          result_status: "ACCEPTED",
          retry_count: 0,
        }).info(
          { artifact_id: existingDoc.artifact_id, deduplicated: true },
          "duplicate code artifact detected by content_hash, returning existing artifact"
        );

        res.status(200).json({
          accepted: true,
          persisted: true,
          deduplicated: true,
          trace_id: traceId,
          artifact_id: existingDoc.artifact_id,
          content_hash: contentHash,
          qa_status: existingDoc.qa_status,
          push_status: existingDoc.push_status,
        });
        return;
      }

      const artifactId = newArtifactId();
      const doc: CodeArtifactDocument = {
        artifact_id: artifactId,
        artifact_type: "code",
        content: parsed.content,
        content_hash: contentHash,
        qa_status: qaStatus,
        push_requested: parsed.push_requested,
        target_branch: buildSessionBranchName(session_id),
        push_status: "PENDING",
        retry_count: 0,
        chat_id,
        session_id,
        owner_uid: ownerUid,
        created_at: new Date().toISOString(),
      };

      await collection.doc(artifactId).set(doc);

      withLogContext({
        trace_id: traceId,
        chat_id,
        session_id,
        operation_type: "capture_code_artifact",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info(
        { artifact_id: artifactId, qa_status: qaStatus },
        "code artifact captured and persisted to Firestore"
      );

      res.status(202).json({
        accepted: true,
        persisted: true,
        deduplicated: false,
        trace_id: traceId,
        artifact_id: artifactId,
        content_hash: contentHash,
        qa_status: qaStatus,
        push_requested: parsed.push_requested,
        note: "Push-pipeline QA gate and idempotent push are implemented in Iteration F.",
      });
    } catch (err) {
      withLogContext({
        trace_id: traceId,
        chat_id,
        session_id,
        operation_type: "capture_code_artifact",
        result_status: "INTERNAL_ERROR",
        retry_count: 0,
      }).error({ err }, "Firestore write failed for code artifact capture");

      // Sub-step H.3.5: attempt to enqueue a Cloud Tasks retry BEFORE
      // falling back to a direct dead_letter write. retryTask.ts now has
      // a real "capture_code_artifact" handler (captureRetryHandlers.ts)
      // that can safely re-run this exact write, so a transient
      // Firestore failure gets automated exponential-backoff retries
      // (TZ 3.4) instead of going straight to dead_letter on the very
      // first failure, which was the behavior before this sub-step.
      let queued = false;
      try {
        await enqueueRetryTask({
          operation: "capture_code_artifact",
          trace_id: traceId,
          chat_id,
          session_id,
          reason: "firestore_write_failed:code_artifact",
          original_payload: {
            chat_id,
            session_id,
            owner_uid: ownerUid,
            content: parsed.content,
            push_requested: parsed.push_requested,
            qa_status: qaStatus,
          },
        });
        queued = true;
      } catch (enqueueErr) {
        withLogContext({
          trace_id: traceId,
          chat_id,
          session_id,
          operation_type: "capture_code_artifact",
          result_status: "INTERNAL_ERROR",
          retry_count: 0,
        }).error(
          { err: enqueueErr },
          "enqueueRetryTask failed (Cloud Tasks unavailable or misconfigured) - falling back to direct dead_letter write"
        );
      }

      const deadLettered = queued
        ? false
        : await recordDeadLetter({
            traceId,
            chatId: chat_id,
            sessionId: session_id,
            reason: "firestore_write_failed:code_artifact",
            originalPayload: parsed,
            operationType: "capture_code_artifact",
          });

      res.status(500).json({
        error: "persistence_failed",
        persisted: false,
        retry_queued: queued,
        dead_lettered: deadLettered,
        trace_id: traceId,
        note: queued
          ? "Primary write failed; a Cloud Tasks retry was enqueued and will re-run this exact write with exponential backoff (Sub-step H.3.5), falling back to dead_letter only if all attempts are exhausted."
          : deadLettered
            ? "Primary write AND retry-enqueue both failed, but the event was captured in dead_letter for forensics/reprocessing."
            : "Primary write, retry-enqueue, AND dead_letter write all failed. This event is genuinely lost.",
      });
    }
    return;
  }

  const contextCol = contextCollection();
  try {
    const docRef = contextCol.doc(chat_id);
    const nowIso = new Date().toISOString();
    const existingSnap = await docRef.get();
    let refCountLocal = 0;
    let mergedMemoryBlobUpdate: Partial<ChatContextDocument["memory_blob"]> = {};

    const rawRef =
      ("user_message" in parsed && parsed.user_message) ||
      ("model_response" in parsed && parsed.model_response) ||
      "";

    const quotaGovernor = getQuotaGovernor();
    const quotaMode = quotaGovernor.getQuotaMode();

    if (quotaMode === "aggressive" || quotaMode === "deferred") {
          await enqueueBatchedCapture(chat_id, traceId, {
    last_interaction: nowIso,
    memory_blob: {
      raw_history_refs: [rawRef],
    },
  });

      withLogContext({
        trace_id: traceId,
        chat_id,
        session_id,
        operation_type: "capture_conversation",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info(
        { quota_mode: quotaMode },
        "conversation turn handed to batched-capture buffer due to Firestore quota pressure (Sub-step H.3)"
      );

      res.status(202).json({
        accepted: true,
        persisted: false,
        batched: true,
        quota_mode: quotaMode,
        trace_id: traceId,
        note: "Firestore write batched due to quota pressure (Sub-step H.3); this turn will be flushed on the next batch cycle, not synchronously.",
      });
      return;
    }

    if (existingSnap.exists) {
      const existingData = existingSnap.data() as ChatContextDocument;

      if (existingData.owner_uid !== ownerUid) {
        withLogContext({
          trace_id: traceId,
          chat_id,
          session_id,
          operation_type: "capture_conversation",
          result_status: "VALIDATION_FAILED",
          retry_count: 0,
        }).warn(
          "chat_id owner_uid mismatch - refusing cross-owner conversation write"
        );
        res.status(403).json({
          error: "forbidden",
          trace_id: traceId,
          note: "This chat_id belongs to a different owner_uid.",
        });
        return;
      }

      const refs = existingData.memory_blob.raw_history_refs;
      mergedMemoryBlobUpdate = {
        ...existingData.memory_blob,
        raw_history_refs: [...refs, rawRef],
      };
      refCountLocal = refs.length + 1;

      await docRef.set(
        {
          last_interaction: nowIso,
          memory_blob: mergedMemoryBlobUpdate,
        },
        { merge: true }
      );
    } else {
      mergedMemoryBlobUpdate = {
        summary: "",
        entities: [],
        action_items: [],
        raw_history_refs: [rawRef],
        encrypted: false,
        schema_version: "v1",
        compression_level: "normal",
      };
      refCountLocal = 1;

      const newDoc: ChatContextDocument = {
        chat_id,
        session_id,
        trace_id: traceId,
        owner_uid: ownerUid,
        created_at: nowIso,
        last_interaction: nowIso,
        memory_blob: mergedMemoryBlobUpdate as ChatContextDocument["memory_blob"],
      };
      await docRef.set(newDoc);
    }

    quotaGovernor.recordWrite();

    withLogContext({
      trace_id: traceId,
      chat_id,
      session_id,
      operation_type: "capture_conversation",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { raw_history_refs_count: refCountLocal },
      "conversation turn captured and persisted to Firestore"
    );

    res.status(202).json({
      accepted: true,
      persisted: true,
      batched: false,
      trace_id: traceId,
      raw_history_refs_count: refCountLocal,
    });

    const quotaModeForCadence: QuotaMode = quotaMode;
const summarizationCadenceDivisor =
  quotaModeForCadence === "aggressive" ? 2 : 1;
const effectiveTriggerEvery =
  SUMMARIZATION_TRIGGER_EVERY_N_TURNS * summarizationCadenceDivisor;

    if (
      quotaMode === "normal" &&
      shouldTriggerSummarization(refCountLocal, effectiveTriggerEvery)
    ) {
     summarizeAndUpdateMemory(chat_id, traceId, session_id, ownerUid).catch((summarizationErr) => {
        withLogContext({
          trace_id: traceId,
          chat_id,
          session_id,
          operation_type: "summarize_memory",
          result_status: "INTERNAL_ERROR",
          retry_count: 0,
        }).error(
          { err: summarizationErr },
          "fire-and-forget summarization failed after capture response was already sent"
        );
      });
    } else if (
        quotaModeForCadence === "aggressive" &&
      shouldTriggerSummarization(refCountLocal, effectiveTriggerEvery)
    ) {
        summarizeAndUpdateMemory(chat_id, traceId, session_id, ownerUid).catch((summarizationErr) => {
        withLogContext({
          trace_id: traceId,
          chat_id,
          session_id,
          operation_type: "summarize_memory",
          result_status: "INTERNAL_ERROR",
          retry_count: 0,
        }).error(
          { err: summarizationErr },
          "fire-and-forget summarization failed after capture response was already sent (aggressive quota mode, halved cadence)"
        );
      });
    }
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      chat_id,
      session_id,
      operation_type: "capture_conversation",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "Firestore write failed for conversation capture");

    // Sub-step H.3.5: same enqueue-before-dead-letter pattern as the
    // code-artifact branch above - retryTask.ts's "capture_conversation"
    // handler (captureRetryHandlers.ts) can safely re-run this exact
    // conversation-turn append, with a best-effort idempotency check on
    // the last raw_history_refs entry.
    let queued = false;
    try {
      await enqueueRetryTask({
        operation: "capture_conversation",
        trace_id: traceId,
        chat_id,
        session_id,
        reason: "firestore_write_failed:conversation",
        original_payload: {
          chat_id,
          session_id,
          trace_id: traceId,
          owner_uid: ownerUid,
          user_message: "user_message" in parsed ? parsed.user_message : undefined,
          model_response: "model_response" in parsed ? parsed.model_response : undefined,
        },
      });
      queued = true;
    } catch (enqueueErr) {
      withLogContext({
        trace_id: traceId,
        chat_id,
        session_id,
        operation_type: "capture_conversation",
        result_status: "INTERNAL_ERROR",
        retry_count: 0,
      }).error(
        { err: enqueueErr },
        "enqueueRetryTask failed (Cloud Tasks unavailable or misconfigured) - falling back to direct dead_letter write"
      );
    }

    const deadLettered = queued
      ? false
      : await recordDeadLetter({
          traceId,
          chatId: chat_id,
          sessionId: session_id,
          reason: "firestore_write_failed:conversation",
          originalPayload: parsed,
          operationType: "capture_conversation",
        });

    res.status(500).json({
      error: "persistence_failed",
      persisted: false,
      retry_queued: queued,
      dead_lettered: deadLettered,
      trace_id: traceId,
      note: queued
        ? "Primary write failed; a Cloud Tasks retry was enqueued and will re-run this exact write with exponential backoff (Sub-step H.3.5), falling back to dead_letter only if all attempts are exhausted."
        : deadLettered
          ? "Primary write AND retry-enqueue both failed, but the event was captured in dead_letter for forensics/reprocessing."
          : "Primary write, retry-enqueue, AND dead_letter write all failed. This event is genuinely lost.",
    });
  }
});