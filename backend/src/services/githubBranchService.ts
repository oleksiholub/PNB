import { withLogContext } from "../logger";

const GITHUB_API_BASE = "https://api.github.com";

export interface EnsureBranchInput {
  owner: string;
  repo: string;
  sessionId: string;
  baseBranch: string;
  installationToken: string;
  traceId: string;
}

export interface EnsureBranchResult {
  branchName: string;
  headSha: string;
  created: boolean;
}

function buildBranchName(sessionId: string): string {
  return `auto/${sessionId}`;
}

async function getRefSha(
  owner: string,
  repo: string,
  ref: string,
  token: string
): Promise<string | null> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${ref}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { object: { sha: string } };
  return body.object.sha;
}

export async function ensureSessionBranch(
  input: EnsureBranchInput
): Promise<EnsureBranchResult> {
  const { owner, repo, sessionId, baseBranch, installationToken, traceId } =
    input;
  const branchName = buildBranchName(sessionId);

  const existingHeadSha = await getRefSha(
    owner,
    repo,
    branchName,
    installationToken
  );

  if (existingHeadSha) {
    withLogContext({
      trace_id: traceId,
      session_id: sessionId,
      operation_type: "handoff",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { branchName },
      "session branch already exists, reusing (idempotent)"
    );
    return { branchName, headSha: existingHeadSha, created: false };
  }

  const baseHeadSha = await getRefSha(
    owner,
    repo,
    baseBranch,
    installationToken
  );

  if (!baseHeadSha) {
    withLogContext({
      trace_id: traceId,
      session_id: sessionId,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      { baseBranch },
      "could not resolve base branch HEAD SHA - cannot create session branch"
    );
    throw new Error(
      `Unable to resolve HEAD SHA for base branch '${baseBranch}' in ${owner}/${repo}`
    );
  }

  const createResponse = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${installationToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseHeadSha,
      }),
    }
  );

  if (createResponse.status === 422) {
    const raceHeadSha = await getRefSha(
      owner,
      repo,
      branchName,
      installationToken
    );

    if (raceHeadSha) {
      withLogContext({
        trace_id: traceId,
        session_id: sessionId,
        operation_type: "handoff",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info(
        { branchName },
        "session branch was created concurrently by another request (422 race), treating as idempotent success"
      );
      return { branchName, headSha: raceHeadSha, created: false };
    }
  }

  if (!createResponse.ok) {
    const bodyText = await createResponse.text();
    withLogContext({
      trace_id: traceId,
      session_id: sessionId,
      operation_type: "handoff",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      { status: createResponse.status, body: bodyText },
      "failed to create session branch"
    );
    throw new Error(
      `Failed to create branch '${branchName}' in ${owner}/${repo}: ${createResponse.status}`
    );
  }

  withLogContext({
    trace_id: traceId,
    session_id: sessionId,
    operation_type: "handoff",
    result_status: "ACCEPTED",
    retry_count: 0,
  }).info({ branchName }, "session branch created");

  return { branchName, headSha: baseHeadSha, created: true };
}