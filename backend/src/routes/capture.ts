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
        target_branch: `auto/${session_id}`,
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
          "chat_id collision across different owner_uid - refusing cross-owner write"
        );
        res.status(403).json({
          error: "forbidden",
          trace_id: traceId,
          note: "This chat_id belongs to a different owner_uid.",
        });
        return;
      }

      const rawRef = parsed.user_message ?? parsed.model_response ?? "";
      await docRef.set(
        {
          ...existingData,
          last_interaction: nowIso,
          memory_blob: {
            ...existingData.memory_blob,
            raw_history_refs: [
              ...existingData.memory_blob.raw_history_refs,
              rawRef,
            ],
          },
        },
        { merge: true }
      );
    } else {
      const newDoc: ChatContextDocument = {
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
          raw_history_refs: [parsed.user_message ?? parsed.model_response ?? ""],
          encrypted: false,
          schema_version: "v1",
          compression_level: "normal",
        },
      };
      await docRef.set(newDoc);
    }

    withLogContext({
      trace_id: traceId,
      chat_id,
      session_id,
      operation_type: "capture_conversation",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info("conversation turn captured and persisted to Firestore");

    const refreshedSnap = await docRef.get();
    const refCount = (refreshedSnap.data() as ChatContextDocument).memory_blob
      .raw_history_refs.length;

    let summarizationTriggered = false;
    if (shouldTriggerSummarization(refCount)) {
      summarizationTriggered = true;
      // Fire-and-forget: summarization must never block or fail the
      // capture response - TZ 3.3 treats it as an async orchestration
      // step, not a synchronous part of the capture contract.
      summarizeAndUpdateMemory(chat_id, traceId).catch((err) => {
        withLogContext({
          trace_id: traceId,
          chat_id,
          session_id,
          operation_type: "summarize_memory",
          result_status: "INTERNAL_ERROR",
          retry_count: 0,
        }).error({ err }, "unhandled rejection from summarizeAndUpdateMemory");
      });
    }

    res.status(202).json({
      accepted: true,
      persisted: true,
      trace_id: traceId,
      chat_id,
      session_id,
      summarization_triggered: summarizationTriggered,
      note: summarizationTriggered
        ? "Summarization pipeline triggered asynchronously (LangGraph.js, extractive interim summarizer - see Sub-step E.1 README)."
        : `Summarization triggers every ${SUMMARIZATION_TRIGGER_EVERY_N_TURNS} turns; client-side encryption of memory_blob is implemented in a later sub-step.`,
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