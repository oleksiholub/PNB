import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { withLogContext } from "../logger";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        uid: string;
      };
    }
  }
}

export async function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const traceId = req.traceId;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    withLogContext({
      trace_id: traceId,
      operation_type: "capture_conversation",
      result_status: "VALIDATION_FAILED",
      retry_count: 0,
    }).warn("missing or malformed Authorization header");

    res.status(401).json({
      error: "unauthorized",
      trace_id: traceId,
      note: "Expected 'Authorization: Bearer <Firebase ID Token>' header.",
    });
    return;
  }

  const idToken = authHeader.slice("Bearer ".length);

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.auth = { uid: decoded.uid };
    next();
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      operation_type: "capture_conversation",
      result_status: "VALIDATION_FAILED",
      retry_count: 0,
    }).warn({ err }, "Firebase ID token verification failed");

    res.status(401).json({
      error: "unauthorized",
      trace_id: traceId,
      note: "Firebase ID token is invalid, expired, or revoked.",
    });
  }
}