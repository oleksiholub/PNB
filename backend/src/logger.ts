import pino from "pino";
import pinoHttp from "pino-http";
import type { Request } from "express";
import { LogContextFields } from "./types/logging";
import { genReqId } from "./middleware/requestContext";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId,
  autoLogging: {
    ignore: (req: Request) => req.url === "/healthz",
  },
});

export function withLogContext(fields: LogContextFields) {
  return logger.child(fields);
}