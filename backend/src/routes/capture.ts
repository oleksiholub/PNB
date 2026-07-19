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

export const captureRouter = Router();

captureRouter.post("/capture", async (req: Request, res: Response) => {
  const traceId = req.traceId;

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
        owner_uid: req.headers["x-owner-uid"]?.toString() ?? "unknown",
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

      res.status(500).json({
        error: "persistence_failed",
        persisted: false,
        retry_queued: false,
        trace_id: traceId,
        note: "Retry queue / dead-letter handling not yet implemented (Sub-step H.1). This event is currently lost on Firestore failure.",
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
        owner_uid: req.headers["x-owner-uid"]?.toString() ?? "unknown",
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

    res.status(202).json({
      accepted: true,
      persisted: true,
      trace_id: traceId,
      chat_id,
      session_id,
      note: "Summarization, entity extraction and encryption are implemented in Iteration E.",
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

    res.status(500).json({
      error: "persistence_failed",
      persisted: false,
      retry_queued: false,
      trace_id: traceId,
      note: "Retry queue / dead-letter handling not yet implemented (Sub-step H.1). This event is currently lost on Firestore failure.",
    });
  }
});