import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { loadEnv } from "./config/env";
import { assertExpectedRegion } from "./config/region";
import { logger } from "./logger";
import { captureRouter } from "./routes/capture";

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

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      service: "pnb-backend",
      region: env.GCP_REGION,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(captureRouter);

  app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
      service: "pnb-backend",
      status: "skeleton+capture",
      note: "Firestore persistence, auth, handoff, push-pipeline are added in later iterations",
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "internal_error" });
  });

  const port = Number(env.PORT);
  app.listen(port, () => {
    logger.info({ port, region: env.GCP_REGION }, "pnb-backend listening");
  });
}

bootstrap();