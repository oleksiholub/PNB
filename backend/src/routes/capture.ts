import { Router, Request, Response } from "express";
import { ZodError } from "zod";
import {
  CaptureRequestSchema,
  normalizeQaStatus,
} from "../schemas/capture";
import { sha256Hex } from "../utils/hash";
import { newArtifactId } from "../utils/ids";
import { withLogContext } from "../logger";

export const captureRouter = Router();

captureRouter.post("/capture", (req: Request, res: Response) => {
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
    const artifactId = newArtifactId();

    withLogContext({
      trace_id: traceId,
      chat_id,
      session_id,
      operation_type: "capture_code_artifact",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { artifact_id: artifactId, qa_status: qaStatus },
      "code artifact captured (not yet persisted - Iteration B)"
    );

    res.status(202).json({
      accepted: true,
      persisted: false,
      trace_id: traceId,
      artifact_id: artifactId,
      content_hash: contentHash,
      qa_status: qaStatus,
      push_requested: parsed.push_requested,
      note: "Persistence to Firestore and push-pipeline are implemented in later iterations (B, F).",
    });
    return;
  }

  withLogContext({
    trace_id: traceId,
    chat_id,
    session_id,
    operation_type: "capture_conversation",
    result_status: "ACCEPTED",
    retry_count: 0,
  }).info("conversation turn captured (not yet persisted - Iteration B)");

  res.status(202).json({
    accepted: true,
    persisted: false,
    trace_id: traceId,
    chat_id,
    session_id,
    note: "Persistence to Firestore and memory orchestration are implemented in later iterations (B, E).",
  });
});