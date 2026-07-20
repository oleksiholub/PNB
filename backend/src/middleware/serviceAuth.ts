/**
 * requireGoogleServiceAuth middleware (Sub-step C.2): verifies
 * service-to-service OIDC tokens (Cloud Build / Cloud Tasks) against
 * SERVICE_AUDIENCE and TRUSTED_SERVICE_ACCOUNTS.
 *
 * Sub-step H.0 FIX: this file previously read
 * process.env.SERVICE_AUDIENCE / process.env.TRUSTED_SERVICE_ACCOUNTS
 * directly, bypassing config/env.ts's loadEnv()/EnvSchema entirely -
 * every other module that reads these two variables (capture.ts's
 * dependents, routes/retryTask.ts, routes/push.ts) goes through
 * loadEnv(), so this file was a silent second source of truth for the
 * same two env vars, with no shared validation (e.g. EnvSchema's
 * z.string().optional() coercion). Not a runtime crash on its own, but
 * a genuine drift risk (Likely-confidence bug: if EnvSchema's validation
 * for these fields is ever tightened, this file would silently continue
 * reading the raw, unvalidated process.env value instead of failing the
 * same way loadEnv() callers do). Fixed by routing both reads through
 * loadEnv(), matching the rest of the codebase's convention.
 */
import { Request, Response, NextFunction } from "express";
import { OAuth2Client } from "google-auth-library";
import { withLogContext } from "../logger";
import { loadEnv } from "../config/env";

const oauthClient = new OAuth2Client();

function getTrustedServiceAccounts(): string[] {
  const raw = loadEnv().TRUSTED_SERVICE_ACCOUNTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getServiceAudience(): string | undefined {
  return loadEnv().SERVICE_AUDIENCE;
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
