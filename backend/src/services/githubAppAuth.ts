import jwt from "jsonwebtoken";
import { withLogContext } from "../logger";

const GITHUB_API_BASE = "https://api.github.com";
const JWT_ISSUED_AT_SKEW_SECONDS = 60;
const JWT_EXPIRY_SECONDS = 600;

export interface GithubAppCredentials {
  appId: string;
  privateKeyPem: string;
  installationId: string;
}

export interface InstallationAccessToken {
  token: string;
  expiresAt: string;
}

export function loadGithubAppCredentialsFromEnv(): GithubAppCredentials | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (!appId || !privateKeyPem || !installationId) {
    return null;
  }

  return { appId, privateKeyPem, installationId };
}

export function signAppJwt(credentials: GithubAppCredentials): string {
  const nowSeconds = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: nowSeconds - JWT_ISSUED_AT_SKEW_SECONDS,
      exp: nowSeconds + JWT_EXPIRY_SECONDS,
      iss: credentials.appId,
    },
    credentials.privateKeyPem,
    { algorithm: "RS256" }
  );
}

export async function getInstallationAccessToken(
  credentials: GithubAppCredentials,
  traceId: string
): Promise<InstallationAccessToken | null> {
  const appJwt = signAppJwt(credentials);

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/app/installations/${credentials.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      const bodyText = await response.text();
      withLogContext({
        trace_id: traceId,
        operation_type: "handoff",
        result_status: "INTERNAL_ERROR",
        retry_count: 0,
      }).error(
        { status: response.status, body: bodyText },
        "GitHub installation access token request failed"
      );
      return null;
    }

    const body = (await response.json()) as {
      token: string;
      expires_at: string;
    };

    withLogContext({
      trace_id: traceId,
      operation_type: "handoff",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { expiresAt: body.expires_at },
      "GitHub installation access token minted"
    );

    return { token: body.token, expiresAt: body.expires_at };
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "GitHub installation access token request threw");
    return null;
  }
}