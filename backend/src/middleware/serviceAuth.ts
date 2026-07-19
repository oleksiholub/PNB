import { Request, Response, NextFunction } from "express";
import { OAuth2Client } from "google-auth-library";
import { withLogContext } from "../logger";

const oauthClient = new OAuth2Client();

function getTrustedServiceAccounts(): string[] {
  const raw = process.env.TRUSTED_SERVICE_ACCOUNTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getServiceAudience(): string | undefined {
  return process.env.SERVICE_AUDIENCE;
}

declare global {
  namespace Express {
    interface Request {
      serviceCaller?: {
        email: string;
      };
    }
  }
}

export async function requireGoogleServiceAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const traceId = req.traceId;
  const authHeader = req.headers.authorization;
  const audience = getServiceAudience();
  const trustedAccounts = getTrustedServiceAccounts();

  if (!audience) {
    withLogContext({
      trace_id: traceId,
      operation_type: "capture_conversation",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      "SERVICE_AUDIENCE env var is not set - requireGoogleServiceAuth cannot verify audience, refusing all requests fail-closed"
    );
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      trace_id: traceId,
      note: "Expected 'Authorization: Bearer <Google-signed OIDC identity token>' header.",
    });
    return;
  }

  const idToken = authHeader.slice("Bearer ".length);

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience,
    });
    const payload = ticket.getPayload();
    const callerEmail = payload?.email;

    if (!callerEmail || !trustedAccounts.includes(callerEmail)) {
      withLogContext({
        trace_id: traceId,
        operation_type: "capture_conversation",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn(
        { callerEmail },
        "Google-signed token verified but caller service account is not in TRUSTED_SERVICE_ACCOUNTS allowlist"
      );
      res.status(403).json({
        error: "forbidden",
        trace_id: traceId,
        note: "Caller service account is not authorized to invoke this endpoint.",
      });
      return;
    }

    req.serviceCaller = { email: callerEmail };
    next();
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      operation_type: "capture_conversation",
      result_status: "VALIDATION_FAILED",
      retry_count: 0,
    }).warn({ err }, "Google-signed identity token verification failed");

    res.status(401).json({
      error: "unauthorized",
      trace_id: traceId,
      note: "Identity token is invalid, expired, or has the wrong audience.",
    });
  }
}