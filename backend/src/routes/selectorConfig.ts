import { Router, Request, Response } from "express";
import { ZodError } from "zod";
import { getFirestoreDb } from "../config/firestore";
import { withLogContext } from "../logger";
import { SelectorConfigPayloadSchema } from "../schemas/selectorConfig";

export const selectorConfigRouter = Router();

selectorConfigRouter.get("/selector-config/current", async (req: Request, res: Response) => {
  const traceId = req.traceId;

  try {
    const db = getFirestoreDb();
    const docRef = db.collection("configs").doc("selectors").collection("versions").doc("current");
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      withLogContext({
        trace_id: traceId,
        operation_type: "selector_config_fetch",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn("no published selector config found");
      res.status(404).json({ error: "selector_config_not_found", trace_id: traceId });
      return;
    }

    const data = snapshot.data();
    withLogContext({
      trace_id: traceId,
      operation_type: "selector_config_fetch",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info({ version: data?.version }, "selector config served");
    res.status(200).json(data);
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      operation_type: "selector_config_fetch",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "failed to fetch selector config");
    res.status(500).json({ error: "internal_error", trace_id: traceId });
  }
});

selectorConfigRouter.post("/selector-config/refresh", async (req: Request, res: Response) => {
  const traceId = req.traceId;

  let payload;
  try {
    payload = SelectorConfigPayloadSchema.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) {
      withLogContext({
        trace_id: traceId,
        operation_type: "selector_config_publish",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn({ issues: err.issues }, "selector config payload failed structural validation");
      res.status(400).json({
        error: "invalid_selector_config",
        trace_id: traceId,
        details: err.issues,
      });
      return;
    }

    withLogContext({
      trace_id: traceId,
      operation_type: "selector_config_publish",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "unexpected error during selector config validation");
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  try {
    const db = getFirestoreDb();
    const publishedAt = new Date().toISOString();
    const versionDocRef = db.collection("selector_configs").doc(payload.version);
    const currentDocRef = db
      .collection("configs")
      .doc("selectors")
      .collection("versions")
      .doc("current");

    const batch = db.batch();
    batch.set(versionDocRef, {
      version: payload.version,
      payload,
      published_at: publishedAt,
    });
    batch.set(currentDocRef, {
      ...payload,
      published_at: publishedAt,
    });
    await batch.commit();

    withLogContext({
      trace_id: traceId,
      operation_type: "selector_config_publish",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info({ version: payload.version }, "selector config published");

    res.status(200).json({
      accepted: true,
      version: payload.version,
      published_at: publishedAt,
      trace_id: traceId,
    });
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      operation_type: "selector_config_publish",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "failed to publish selector config");
    res.status(500).json({ error: "internal_error", trace_id: traceId });
  }
});