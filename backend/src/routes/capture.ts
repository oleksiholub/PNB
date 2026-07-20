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

      const deadLettered = await recordDeadLetter({
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
        dead_lettered: deadLettered,
        trace_id: traceId,
        note: deadLettered
          ? "Primary write failed but the event was captured in dead_letter for forensics/reprocessing. Automated retry with backoff is implemented in Sub-step H.1."
          : "Primary write AND dead_letter write both failed. This event is genuinely lost.",
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
    let mergedMemoryBlobUpdate: Partial<ChatContextDocument>;

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
          "capture requested for chat owned by a different user - rejecting write"
        );
        res.status(403).json({
          error: "forbidden",
          trace_id: traceId,
          note: "The requested chat_id belongs to a different owner_uid.",
        });
        return;
      }

      refCountLocal = existingData.memory_blob.raw_history_refs.length;
      mergedMemoryBlobUpdate = {
        last_interaction: nowIso,
        memory_blob: {
          ...existingData.memory_blob,
          raw_history_refs: existingData.memory_blob.raw_history_refs,
        },
      };
    } else {
      mergedMemoryBlobUpdate = {
        chat_id,
        session_id,
        trace_id: traceId,
        owner_uid: ownerUid,
        created_at: nowIso,
        last_interaction: nowIso,
        memory_blob: {
          summary: "",
          entities: [],
          action_items: [],
          raw_history_refs: [],
          encrypted: false,
          schema_version: "v1",
          compression_level: "normal",
        },
      } as ChatContextDocument;
    }

    const captureMode = getQuotaGovernor().currentMode();

    if (captureMode === "deferred") {
      await enqueueBatchedCapture({
        chat_id,
        session_id,
        trace_id: traceId,
        owner_uid: ownerUid,
        memory_blob_update: mergedMemoryBlobUpdate,
      });

      withLogContext({
        trace_id: traceId,
        chat_id,
        session_id,
        operation_type: "capture_conversation",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info(
        { capture_mode: captureMode },
        "capture conversation turn batched due to quota pressure"
      );

      res.status(202).json({
        accepted: true,
        persisted: false,
        batched: true,
        trace_id: traceId,
        capture_mode: captureMode,
      });
      return;
    }

    await docRef.set(mergedMemoryBlobUpdate, { merge: true });

    const updatedRefCount = refCountLocal + 1;
    const shouldSummarize =
      captureMode === "aggressive"
        ? updatedRefCount % Math.max(1, Math.floor(SUMMARIZATION_TRIGGER_EVERY_N_TURNS / 2)) === 0
        : shouldTriggerSummarization(updatedRefCount);

    if (shouldSummarize) {
      void summarizeAndUpdateMemory({
        chat_id,
        session_id,
        trace_id: traceId,
        owner_uid: ownerUid,
      });
    }

    withLogContext({
      trace_id: traceId,
      chat_id,
      session_id,
      operation_type: "capture_conversation",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { capture_mode: captureMode, ref_count: updatedRefCount },
      "conversation turn captured and persisted to Firestore"
    );

    res.status(202).json({
      accepted: true,
      persisted: true,
      batched: false,
      trace_id: traceId,
      capture_mode: captureMode,
      ref_count: updatedRefCount,
    });
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      chat_id,
      session_id,
      operation_type: "capture_conversation",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "Firestore write failed for conversation capture");

    const deadLettered = await recordDeadLetter({
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
      dead_lettered: deadLettered,
      trace_id: traceId,
      note: deadLettered
        ? "Primary write failed but the event was captured in dead_letter for forensics/reprocessing. Automated retry with backoff is implemented in Sub-step H.1."
        : "Primary write AND dead_letter write both failed. This event is genuinely lost.",
    });
  }
});