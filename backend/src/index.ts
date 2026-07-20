/**
 * PNB Backend entrypoint - L2 Orchestrator (Cloud Run service).
 * Sub-step C.1: mounts requireFirebaseAuth ahead of captureRouter, so
 * POST /capture now requires a verified Firebase ID token
 * (Authorization: Bearer <token>) instead of the unverified x-owner-uid
 * header used throughout Iteration B.
 */
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { loadEnv } from "./config/env";
import { assertExpectedRegion } from "./config/region";
import { logger, httpLogger, withLogContext } from "./logger";
import { requestContextMiddleware } from "./middleware/requestContext";
import { requireFirebaseAuth } from "./middleware/firebaseAuth";
import { requireGoogleServiceAuth } from "./middleware/serviceAuth";
import { captureRouter } from "./routes/capture";
import { selectorConfigRouter } from "./routes/selectorConfig";
import { handoffRouter } from "./routes/handoff";
import { contextRouter } from "./routes/context";
import { qaGateAndPushArtifact } from "./routes/push";
import { handleCiCallback } from "./routes/ciCallback";

function bootstrap() {
  const env = loadEnv();

  try {
    assertExpectedRegion(env.GCP_REGION);
  } catch (err) {
    logger.error({ err }, "Region configuration assertion failed");
    throw err;
  }

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use(requestContextMiddleware);
  app.use(httpLogger);

  app.get("/healthz", (req: Request, res: Response) => {
    withLogContext({
      trace_id: req.traceId,
      operation_type: "healthz_check",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).debug("healthz probed");

    res.status(200).json({
      status: "ok",
      service: "pnb-backend",
      region: env.GCP_REGION,
      trace_id: req.traceId,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(requireFirebaseAuth, captureRouter);

  app.use(requireFirebaseAuth, selectorConfigRouter);

  app.use(requireFirebaseAuth, handoffRouter);

  app.use(requireFirebaseAuth, contextRouter);

  app.post("/push/:artifactId", requireFirebaseAuth, qaGateAndPushArtifact);

  app.post("/ci-callback", requireGoogleServiceAuth, handleCiCallback);

  app.get("/", (req: Request, res: Response) => {
    res.status(200).json({
      service: "pnb-backend",
      status: "skeleton+capture+auth+firestore+handoff+context+push+selector-config-refresh+ci-callback",
      trace_id: req.traceId,
      note: "Push-pipeline, selector-config publish (F), and CI-callback reporting (G.1) are complete; merge automation is G.2",
    });
  });

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    withLogContext({
      trace_id: req.traceId ?? "unknown",
      operation_type: "capture_conversation",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "Unhandled error");

    res.status(500).json({ error: "internal_error", trace_id: req.traceId });
  });

  const port = Number(env.PORT);
  app.listen(port, () => {
    logger.info({ port, region: env.GCP_REGION }, "pnb-backend listening");
  });
}

bootstrap();