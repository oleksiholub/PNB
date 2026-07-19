import { Router, Request, Response } from "express";
import { withLogContext } from "../logger";
import { contextCollection } from "../models/collections";
import { ChatContextDocument } from "../models/types";

export const contextRouter = Router();

function redactMemoryBlob(memoryBlob: ChatContextDocument["memory_blob"]) {
  return {
    encrypted: true,
    schema_version: memoryBlob.schema_version,
    compression_level: memoryBlob.compression_level,
    ciphertext: Buffer.from(JSON.stringify(memoryBlob)).toString("base64"),
    key_info: {
      algorithm: "unspecified-placeholder",
      note:
        "E.3 transport placeholder - cryptographic algorithm not specified in TZ; client-side decryption contract to be finalized later.",
    },
  };
}

contextRouter.get("/context/:chatId", async (req: Request, res: Response) => {
  const traceId = req.traceId;

  if (!req.auth) {
    withLogContext({
      trace_id: traceId,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      "req.auth missing in context handler despite requireFirebaseAuth mounted ahead of this route - middleware ordering bug"
    );
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  const chatId = req.params.chatId;
  const mode = typeof req.query.mode === "string" ? req.query.mode : "encrypted";

  try {
    const snap = await contextCollection().doc(chatId).get();

    if (!snap.exists) {
      withLogContext({
        trace_id: traceId,
        chat_id: chatId,
        operation_type: "handoff",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn("GET /context/:chatId requested for nonexistent chat_id");

      res.status(404).json({
        error: "not_found",
        trace_id: traceId,
      });
      return;
    }

    const doc = snap.data() as ChatContextDocument;

    if (doc.owner_uid !== req.auth.uid) {
      withLogContext({
        trace_id: traceId,
        chat_id: chatId,
        operation_type: "handoff",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn("GET /context/:chatId refused - chat belongs to a different owner_uid");

      res.status(403).json({
        error: "forbidden",
        trace_id: traceId,
      });
      return;
    }

    const payload =
      mode === "plaintext"
        ? {
            chat_id: doc.chat_id,
            session_id: doc.session_id,
            trace_id: doc.trace_id,
            owner_uid: doc.owner_uid,
            created_at: doc.created_at,
            last_interaction: doc.last_interaction,
            memory_blob: doc.memory_blob,
            mode: "plaintext",
          }
        : {
            chat_id: doc.chat_id,
            session_id: doc.session_id,
            trace_id: doc.trace_id,
            owner_uid: doc.owner_uid,
            created_at: doc.created_at,
            last_interaction: doc.last_interaction,
            memory_blob: redactMemoryBlob(doc.memory_blob),
            mode: "encrypted",
          };

    withLogContext({
      trace_id: traceId,
      chat_id: chatId,
      session_id: doc.session_id,
      operation_type: "handoff",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info({ mode }, "context document returned");

    res.status(200).json(payload);
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      chat_id: chatId,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "GET /context/:chatId failed unexpectedly");

    res.status(500).json({ error: "internal_error", trace_id: traceId });
  }
});