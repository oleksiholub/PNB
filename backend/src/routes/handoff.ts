import { Router, Request, Response } from "express";
import { ZodError } from "zod";
import { HandoffRequestSchema } from "../schemas/handoff";
import { withLogContext } from "../logger";
import { contextCollection } from "../models/collections";
import { ChatContextDocument, MemoryBlob } from "../models/types";
import { recordDeadLetter } from "../services/deadLetterService";

export const handoffRouter = Router();

const HANDOFF_MARKER_PREFIX = "[HANDOFF_FROM:";

function buildHandoffMarker(sourceChatId: string): string {
  return `${HANDOFF_MARKER_PREFIX}${sourceChatId}]`;
}

handoffRouter.post("/handoff", async (req: Request, res: Response) => {
  const traceId = req.traceId;

  if (!req.auth) {
    withLogContext({
      trace_id: traceId,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      "req.auth missing in handoff handler despite requireFirebaseAuth mounted ahead of this route - middleware ordering bug"
    );
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }
  const ownerUid = req.auth.uid;

  let parsed;
  try {
    parsed = HandoffRequestSchema.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) {
      withLogContext({
        trace_id: traceId,
        operation_type: "handoff",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn({ issues: err.issues }, "handoff payload failed validation");

      res.status(400).json({
        error: "invalid_payload",
        trace_id: traceId,
        details: err.issues,
      });
      return;
    }

    withLogContext({
      trace_id: traceId,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "unexpected error during handoff validation");

    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  const { source_chat_id, target_chat_id, target_session_id } = parsed;

  if (source_chat_id === target_chat_id) {
    res.status(400).json({
      error: "invalid_payload",
      trace_id: traceId,
      note: "source_chat_id and target_chat_id must differ - handoff to the same chat is a no-op by definition.",
    });
    return;
  }

  const contextCol = contextCollection();

  try {
    const sourceSnap = await contextCol.doc(source_chat_id).get();

    if (!sourceSnap.exists) {
      withLogContext({
        trace_id: traceId,
        chat_id: source_chat_id,
        session_id: target_session_id,
        operation_type: "handoff",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn("handoff requested for nonexistent source_chat_id");

      res.status(404).json({
        error: "source_not_found",
        trace_id: traceId,
        note: "source_chat_id does not exist in Firestore - nothing to hand off.",
      });
      return;
    }

    const sourceData = sourceSnap.data() as ChatContextDocument;

    if (sourceData.owner_uid !== ownerUid) {
      withLogContext({
        trace_id: traceId,
        chat_id: source_chat_id,
        session_id: target_session_id,
        operation_type: "handoff",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn("handoff refused - source_chat_id belongs to a different owner_uid");

      res.status(403).json({
        error: "forbidden",
        trace_id: traceId,
        note: "source_chat_id belongs to a different owner_uid.",
      });
      return;
    }

    const targetDocRef = contextCol.doc(target_chat_id);
    const targetSnap = await targetDocRef.get();
    const marker = buildHandoffMarker(source_chat_id);
    const nowIso = new Date().toISOString();

    if (targetSnap.exists) {
      const targetData = targetSnap.data() as ChatContextDocument;

      if (targetData.owner_uid !== ownerUid) {
        withLogContext({
          trace_id: traceId,
          chat_id: target_chat_id,
          session_id: target_session_id,
          operation_type: "handoff",
          result_status: "VALIDATION_FAILED",
          retry_count: 0,
        }).warn("handoff refused - target_chat_id belongs to a different owner_uid");

        res.status(403).json({
          error: "forbidden",
          trace_id: traceId,
          note: "target_chat_id belongs to a different owner_uid.",
        });
        return;
      }

      const alreadyHandedOff = targetData.memory_blob.raw_history_refs.some(
        (ref) => ref === marker
      );

      if (alreadyHandedOff) {
        withLogContext({
          trace_id: traceId,
          chat_id: target_chat_id,
          session_id: target_session_id,
          operation_type: "handoff",
          result_status: "ACCEPTED",
          retry_count: 0,
        }).info(
          { source_chat_id },
          "handoff already applied to target_chat_id, returning existing state (idempotent)"
        );

        res.status(200).json({
          accepted: true,
          persisted: true,
          deduplicated: true,
          trace_id: traceId,
          target_chat_id,
          memory_blob: targetData.memory_blob,
        });
        return;
      }

      const mergedMemoryBlob: MemoryBlob = {
        ...sourceData.memory_blob,
        raw_history_refs: [
          ...targetData.memory_blob.raw_history_refs,
          marker,
          ...sourceData.memory_blob.raw_history_refs,
        ],
      };

      await targetDocRef.set(
        {
          ...targetData,
          session_id: target_session_id,
          last_interaction: nowIso,
          memory_blob: mergedMemoryBlob,
        },
        { merge: true }
      );

      withLogContext({
        trace_id: traceId,
        chat_id: target_chat_id,
        session_id: target_session_id,
        operation_type: "handoff",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info({ source_chat_id }, "handoff merged into existing target_chat_id");

      res.status(200).json({
        accepted: true,
        persisted: true,
        deduplicated: false,
        trace_id: traceId,
        target_chat_id,
        memory_blob: mergedMemoryBlob,
      });
      return;
    }

    const newTargetDoc: ChatContextDocument = {
      chat_id: target_chat_id,
      session_id: target_session_id,
      trace_id: traceId,
      owner_uid: ownerUid,
      created_at: nowIso,
      last_interaction: nowIso,
      memory_blob: {
        ...sourceData.memory_blob,
        raw_history_refs: [marker, ...sourceData.memory_blob.raw_history_refs],
      },
    };

    await targetDocRef.set(newTargetDoc);

    withLogContext({
      trace_id: traceId,
      chat_id: target_chat_id,
      session_id: target_session_id,
      operation_type: "handoff",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info({ source_chat_id }, "handoff created new target_chat_id document");

    res.status(201).json({
      accepted: true,
      persisted: true,
      deduplicated: false,
      trace_id: traceId,
      target_chat_id,
      memory_blob: newTargetDoc.memory_blob,
    });
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      chat_id: source_chat_id,
      session_id: target_session_id,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "Firestore operation failed during handoff");

    const deadLettered = await recordDeadLetter({
      traceId,
      chatId: source_chat_id,
      sessionId: target_session_id,
      reason: "firestore_write_failed:handoff",
      originalPayload: parsed,
      operationType: "handoff",
    });

    res.status(500).json({
      error: "persistence_failed",
      persisted: false,
      dead_lettered: deadLettered,
      trace_id: traceId,
      note: deadLettered
        ? "Handoff failed but the event was captured in dead_letter for forensics/reprocessing. Automated retry with backoff is implemented in Sub-step H.1."
        : "Handoff write AND dead_letter write both failed. This event is genuinely lost.",
    });
  }
});