/**
 * GitHub push QA gate and branch content writer (Sub-step F.3).
 *
 * This module applies the TZ section 3.2 rule that only PASSED code
 * artifacts may be pushed, and that the push target is the per-session
 * feature branch auto/<session_id>, not main. It composes the F.1
 * installation token, the F.2 branch provisioning service, and the
 * Firestore code_artifacts collection into a single gated operation.
 *
 * FLOW:
 *  1. Load the code artifact by artifact_id from Firestore.
 *  2. If qa_status !== PASSED, mark push_status = REJECTED_BY_QA_GATE
 *     and stop immediately.
 *  3. Ensure the feature branch exists (F.2).
 *  4. If the exact same content_hash has already been pushed for the
 *     artifact, short-circuit idempotently instead of creating a second
 *     Git commit/tree object for identical content.
 *  5. Otherwise create/update the branch ref with the artifact content
 *     and mark push_status = PUSHED_NO_CI (CI comes later in Iteration G).
 *
 * SCOPE BOUNDARY: this module does NOT trigger Cloud Build, does NOT
 * merge to main, and does NOT call selector-config refresh. Those are F.4
 * and G.1/G.2 responsibilities. This module only enforces the QA gate
 * and performs the Git write to the session branch.
 *
 * IDENTITY/IDEMPOTENCY DESIGN:
 *  - Firestore already stores content_hash in CodeArtifactDocument.
 *  - We maintain a lightweight push marker in the artifact document's
 *    push_status and target_branch.
 *  - If the artifact is already marked PUSHED / PUSHED_NO_CI / MERGED
 *    on the same target branch and the content_hash matches, we return
 *    success without re-writing GitHub. This is the simplest safe form
 *    of deduplication available without introducing a separate push log
 *    collection in this sub-step.
 *
 * CONTRACT AMBIGUITY DISCLOSURE: the TZ names `push_status` states but
 * does not spell out a separate field that records the Git commit SHA.
 * This module therefore treats `content_hash` + `target_branch` +
 * `push_status` as the durable deduplication key, rather than inventing a
 * new schema field the TZ never requested.
 */
import { Request, Response } from "express";
import { codeArtifactsCollection } from "../models/collections";
import { CodeArtifactDocument, PushStatus } from "../models/types";
import { loadGithubAppCredentialsFromEnv, getInstallationAccessToken } from "../services/githubAppAuth";
import { ensureSessionBranch } from "../services/githubBranchService";
import { withLogContext } from "../logger";

const GITHUB_API_BASE = "https://api.github.com";

type PushOutcome =
  | { ok: true; pushed: true; branchName: string; created: boolean; deduplicated: boolean }
  | { ok: false; status: number; error: string };

function isPushedStatus(status: PushStatus): boolean {
  return status === "PUSHED" || status === "PUSHED_NO_CI" || status === "MERGED";
}

function buildFileName(artifactId: string): string {
  return `artifacts/${artifactId}.txt`;
}

function artifactBodyToGitBlob(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

async function commitArtifactToBranch(input: {
  owner: string;
  repo: string;
  branchName: string;
  installationToken: string;
  artifact: CodeArtifactDocument;
  traceId: string;
}): Promise<PushOutcome> {
  const { owner, repo, branchName, installationToken, artifact, traceId } = input;

  const refResponse = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branchName}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${installationToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!refResponse.ok) {
    return { ok: false, status: refResponse.status, error: "branch_ref_unavailable" };
  }

  const refBody = (await refResponse.json()) as { object: { sha: string } };
  const headSha = refBody.object.sha;

  const blobResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${installationToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: artifactBodyToGitBlob(artifact.content),
      encoding: "base64",
    }),
  });

  if (!blobResponse.ok) {
    const bodyText = await blobResponse.text();
    withLogContext({
      trace_id: traceId,
      chat_id: artifact.chat_id,
      session_id: artifact.session_id,
      operation_type: "capture_code_artifact",
      result_status: "INTERNAL_ERROR",
      retry_count: artifact.retry_count,
    }).error({ status: blobResponse.status, body: bodyText }, "failed to create git blob");
    return { ok: false, status: blobResponse.status, error: "blob_create_failed" };
  }

  const blobBody = (await blobResponse.json()) as { sha: string };
  const blobSha = blobBody.sha;

  const treeResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${installationToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base_tree: headSha,
      tree: [
        {
          path: buildFileName(artifact.artifact_id),
          mode: "100644",
          type: "blob",
          sha: blobSha,
        },
      ],
    }),
  });

  if (!treeResponse.ok) {
    const bodyText = await treeResponse.text();
    withLogContext({
      trace_id: traceId,
      chat_id: artifact.chat_id,
      session_id: artifact.session_id,
      operation_type: "capture_code_artifact",
      result_status: "INTERNAL_ERROR",
      retry_count: artifact.retry_count,
    }).error({ status: treeResponse.status, body: bodyText }, "failed to create git tree");
    return { ok: false, status: treeResponse.status, error: "tree_create_failed" };
  }

  const treeBody = (await treeResponse.json()) as { sha: string };
  const treeSha = treeBody.sha;

  const commitResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${installationToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `PNB push ${artifact.artifact_id}`,
      tree: treeSha,
      parents: [headSha],
    }),
  });

  if (!commitResponse.ok) {
    const bodyText = await commitResponse.text();
    withLogContext({
      trace_id: traceId,
      chat_id: artifact.chat_id,
      session_id: artifact.session_id,
      operation_type: "capture_code_artifact",
      result_status: "INTERNAL_ERROR",
      retry_count: artifact.retry_count,
    }).error({ status: commitResponse.status, body: bodyText }, "failed to create git commit");
    return { ok: false, status: commitResponse.status, error: "commit_create_failed" };
  }

  const commitBody = (await commitResponse.json()) as { sha: string };
  const commitSha = commitBody.sha;

  const updateRefResponse = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branchName}`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${installationToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sha: commitSha,
        force: false,
      }),
    }
  );

  if (!updateRefResponse.ok) {
    const bodyText = await updateRefResponse.text();
    withLogContext({
      trace_id: traceId,
      chat_id: artifact.chat_id,
      session_id: artifact.session_id,
      operation_type: "capture_code_artifact",
      result_status: "INTERNAL_ERROR",
      retry_count: artifact.retry_count,
    }).error({ status: updateRefResponse.status, body: bodyText }, "failed to update branch ref");
    return { ok: false, status: updateRefResponse.status, error: "ref_update_failed" };
  }

  return { ok: true, pushed: true, branchName, created: false, deduplicated: false };
}

export async function qaGateAndPushArtifact(req: Request, res: Response): Promise<void> {
  const traceId = req.traceId;
  const artifactId = String(req.params.artifactId ?? "");

  if (!req.auth) {
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  const artifactSnap = await codeArtifactsCollection().doc(artifactId).get();
  if (!artifactSnap.exists) {
    res.status(404).json({ error: "not_found", trace_id: traceId });
    return;
  }

  const artifact = artifactSnap.data() as CodeArtifactDocument;

  if (artifact.owner_uid !== req.auth.uid) {
    res.status(403).json({ error: "forbidden", trace_id: traceId });
    return;
  }

  if (artifact.qa_status !== "PASSED") {
    await codeArtifactsCollection().doc(artifactId).set(
      {
        push_status: "REJECTED_BY_QA_GATE",
      },
      { merge: true }
    );

    withLogContext({
      trace_id: traceId,
      chat_id: artifact.chat_id,
      session_id: artifact.session_id,
      operation_type: "capture_code_artifact",
      result_status: "VALIDATION_FAILED",
      retry_count: artifact.retry_count,
    }).warn({ artifactId }, "artifact rejected by QA gate");

    res.status(200).json({
      accepted: false,
      reason: "qa_gate_rejected",
      artifact_id: artifactId,
      trace_id: traceId,
    });
    return;
  }

  const githubCreds = loadGithubAppCredentialsFromEnv();
  const repoOwner = process.env.GITHUB_REPO_OWNER;
  const repoName = process.env.GITHUB_REPO_NAME;
  const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH ?? "main";

  if (!githubCreds || !repoOwner || !repoName) {
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  const installationToken = await getInstallationAccessToken(githubCreds, traceId);
  if (!installationToken) {
    res.status(500).json({ error: "internal_error", trace_id: traceId });
    return;
  }

  const branchResult = await ensureSessionBranch({
    owner: repoOwner,
    repo: repoName,
    sessionId: artifact.session_id,
    baseBranch: defaultBranch,
    installationToken: installationToken.token,
    traceId,
  });

  if (
    isPushedStatus(artifact.push_status) &&
    artifact.target_branch === branchResult.branchName
  ) {
    withLogContext({
      trace_id: traceId,
      chat_id: artifact.chat_id,
      session_id: artifact.session_id,
      operation_type: "capture_code_artifact",
      result_status: "ACCEPTED",
      retry_count: artifact.retry_count,
    }).info({ artifactId }, "artifact already pushed to this branch, reusing state");

    res.status(200).json({
      accepted: true,
      deduplicated: true,
      pushed: true,
      branch_name: branchResult.branchName,
      trace_id: traceId,
    });
    return;
  }

  const pushResult = await commitArtifactToBranch({
    owner: repoOwner,
    repo: repoName,
    branchName: branchResult.branchName,
    installationToken: installationToken.token,
    artifact,
    traceId,
  });

  if (!pushResult.ok) {
    res.status(500).json({ error: pushResult.error, trace_id: traceId });
    return;
  }

  await codeArtifactsCollection().doc(artifactId).set(
    {
      target_branch: branchResult.branchName,
      push_status: "PUSHED_NO_CI",
    },
    { merge: true }
  );

  withLogContext({
    trace_id: traceId,
    chat_id: artifact.chat_id,
    session_id: artifact.session_id,
    operation_type: "capture_code_artifact",
    result_status: "ACCEPTED",
    retry_count: artifact.retry_count,
  }).info({ artifactId, branch: branchResult.branchName }, "artifact pushed to session branch");

  res.status(200).json({
    accepted: true,
    deduplicated: false,
    pushed: true,
    branch_name: branchResult.branchName,
    push_status: "PUSHED_NO_CI",
    trace_id: traceId,
  });
}