import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "../logger";

declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incoming = req.headers["x-trace-id"];
  const traceId =
    typeof incoming === "string" && incoming.length > 0
      ? incoming
      : randomUUID();

  req.traceId = traceId;
  res.setHeader("X-Trace-Id", traceId);

  next();
}

export function genReqId(req: Request): string {
  return req.traceId ?? randomUUID();
}

export { logger };