import express, { Application } from "express";
import helmet from "helmet";
import cors from "cors";
import { loadConfig, assertBudgetRegion } from "./config";
import { createCaptureRouter } from "./routes/capture";
import { CaptureService } from "./services/captureService";
import { InMemoryContextRepository } from "./repositories/contextRepository";

export function buildApp(): Application {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // Sub-step A.3 will add GET /healthz here; kept out of this file's scope
  // for A.2 per the binding plan (Iteration A, sub-step boundaries).

  const repository = new InMemoryContextRepository();
  const captureService = new CaptureService(repository);
  app.use("/", createCaptureRouter(captureService));

  return app;
}

function main(): void {
  const config = loadConfig();
  assertBudgetRegion(config);

  const app = buildApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ severity: "INFO", message: `pnb-backend listening on port ${config.port}`, region: config.gcpRegion }));
  });
}

if (require.main === module) {
  main();
}
