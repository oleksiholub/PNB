import { Router, Request, Response } from "express";
import { getFirestoreDb } from "../config/firestore";
import { withLogContext } from "../logger";

export const selectorConfigRouter = Router();

selectorConfigRouter.get("/selector-config/current", async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const log = withLogContext({
    trace_id: traceId,
    operation_type: "selector_config_fetch",
    result_status: "PENDING",
    retry_count: 0,
  });

  try {
    const db = getFirestoreDb();
    const docRef = db.collection("configs").doc("selectors").collection("versions").doc("current");
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      log.warn({ result_status: "NOT_FOUND" }, "no published selector config found");
      res.status(404).json({ error: "selector_config_not_found", trace_id: traceId });
      return;
    }

    const data = snapshot.data();
    log.info({ result_status: "OK", version: data?.version }, "selector config served");
    res.status(200).json(data);
  } catch (err) {
    log.error({ result_status: "ERROR", error: String(err) }, "failed to fetch selector config");
    res.status(500).json({ error: "internal_error", trace_id: traceId });
  }
});