import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { loadEnv } from "./config/env";
import { assertExpectedRegion } from "./config/region";
import { logger, httpLogger, withLogContext } from "./logger";
import { requestContextMiddleware } from "./middleware/requestContext";
import { requireFirebaseAuth } from "./middleware/firebaseAuth";
import { captureRouter } from "./routes/capture";
import { selectorConfigRouter } from "./routes/selectorConfig";
import { handoffRouter } from "./routes/handoff";
import { contextRouter } from "./routes/context";
import { qaGateAndPushArtifact } from "./routes/push";

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

  // POST /capture now requires a verified Firebase ID token (Sub-step C.1)
  app.use(requireFirebaseAuth, captureRouter);

  // GET /selector-config/current (Sub-step D.3) - closes the read-side gap
  // left by TZ specifying only POST /selector-config/refresh (publish)
  app.use(requireFirebaseAuth, selectorConfigRouter);

  // POST /handoff (Sub-step E.2) - Cross-Chat Handoff per TZ section 3.3
  app.use(requireFirebaseAuth, handoffRouter);

  // GET /context/:chatId (Sub-step E.3) - read-side for resumed sessions
  app.use(requireFirebaseAuth, contextRouter);

  // POST /push/{artifactId} (Sub-step F.3) - QA gate + commit to session branch
  app.post("/push/:artifactId", requireFirebaseAuth, qaGateAndPushArtifact);

  app.get("/", (req: Request, res: Response) => {
    res.status(200).json({
      service: "pnb-backend",
      status: "skeleton+capture+auth+firestore+handoff+context",
      trace_id: req.traceId,
      note: "Push-pipeline (Iteration F) is added in later iterations",
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