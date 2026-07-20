/**
 * GET /selector-config/current and POST /selector-config/refresh
 * (Sub-step F.4).
 *
 * Sub-step H.0 FIX: this route previously called getFirestoreDb()
 * directly and wrote/read TWO uncoordinated Firestore paths for the same
 * logical "current published config" concept -
 * db.collection("selector_configs").doc(payload.version) (a per-version
 * archive doc, fine on its own) AND
 * db.collection("configs").doc("selectors").collection("versions").doc("current")
 * (a completely separate nested-subcollection path) - while
 * models/collections.ts's selectorConfigsCollection() pointed at yet a
 * THIRD, never-actually-read path ("selector_configs" as a flat
 * collection queried by auto-ID, not by version). GET
 * /selector-config/current read from the second path, so a caller
 * reading via selectorConfigsCollection() would see nothing. This is a
 * genuine data-consistency bug, not a stylistic one - fixed by routing
 * both the archive write and the "current" pointer through
 * models/collections.ts's currentSelectorConfigDoc() (new in this
 * sub-step) and selectorConfigsCollection().doc(version) exclusively, so
 * there is exactly one place ("current" pointer doc) any reader needs to
 * query, and exactly one archive collection any version lookup needs to
 * query - no other module computes its own Firestore path for selector
 * config anymore.
 */
import { Router, Request, Response } from "express";
import { ZodError } from "zod";
import { withLogContext } from "../logger";
import { SelectorConfigPayloadSchema } from "../schemas/selectorConfig";
import { selectorConfigsCollection, currentSelectorConfigDoc } from "../models/collections";

export const selectorConfigRouter = Router();

selectorConfigRouter.get("/selector-config/current", async (req: Request, res: Response) => {
  const traceId = req.traceId;

  try {
    const snapshot = await currentSelectorConfigDoc().get();

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
    const publishedAt = new Date().toISOString();
    const archiveDoc = {
      version: payload.version,
      payload,
      published_at: publishedAt,
    };

    await Promise.all([
      selectorConfigsCollection().doc(payload.version).set(archiveDoc),
      currentSelectorConfigDoc().set(archiveDoc),
    ]);

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
