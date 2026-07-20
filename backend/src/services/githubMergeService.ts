/**
 * GitHub branch merge service (Sub-step G.2).
 *
 * TZ section 3.2: "После прохождения CI ветка auto/<session_id> должна
 * автоматически смерджиться в целевую ветку (main / GITHUB_DEFAULT_BRANCH);
 * при конфликте merge помечается как REQUIRES_REVIEW, а не проваливается
 * молча." Section 5 bootstrap step 10: "merge automation policy."
 *
 * SCOPE FOR G.2: this service ONLY performs the merge-on-green-CI step
 * via GitHub's REST "Merge a branch" endpoint
 * (POST /repos/{owner}/{repo}/merges), and classifies the two outcomes
 * the TZ explicitly names - MERGED on success, REQUIRES_REVIEW on a
 * real merge conflict (HTTP 409, verified via web search against
 * docs.github.com/v3/repos/branches and multiple community reports of
 * that exact status code for this exact endpoint). It reuses the same
 * getInstallationAccessToken() from githubAppAuth.ts (F.1) and the same
 * owner/repo coordinates from env (F.2) as githubBranchService.ts - no
 * new repository-configuration surface is introduced here.
 *
 * DEPENDENCY DISCLOSURE: this module uses Node 20's built-in global
 * fetch() rather than introducing a new @octokit/rest dependency, since
 * the project's existing package.json (F.1/F.2) does not include an
 * Octokit client - githubAppAuth.ts and githubBranchService.ts already
 * call the GitHub REST API directly. Using fetch() here keeps that same
 * pattern instead of silently adding a new third-party library the
 * plan never called for.
 *
 * WHY "Merge a branch" (POST /merges) INSTEAD OF A PULL REQUEST FLOW:
 * the TZ's push-pipeline (F.3) commits directly to auto/<session_id> via
 * the Git Data API and never creates a pull request object. Introducing
 * a PR purely to merge it would add an artifact with no described
 * consumer; the direct "Merge a branch" endpoint matches the TZ's
 * existing branch-centric model without that extra surface.
 *
 * CONTRACT AMBIGUITY DISCLOSURE: the TZ does not specify what happens to
 * the code_artifact document(s) tied to a branch once REQUIRES_REVIEW is
 * set - specifically, whether a human resolving the conflict manually on
 * GitHub should have some automated way to flip push_status back to
 * MERGED. No such webhook listener exists yet (out of scope for G.2);
 * REQUIRES_REVIEW is therefore a terminal state from this pipeline's
 * perspective, requiring manual Firestore intervention until a later
 * iteration builds that webhook - this gap is disclosed explicitly
 * rather than silently assumed away.
 *
 * Sub-step H.0 FIX: mergeSessionBranchIntoDefault() now REQUIRES a
 * traceId parameter (second positional argument), because its internal
 * call to getInstallationAccessToken() needs one to attach structured
 * logs to the correct request trace - this was previously called with
 * zero arguments, a genuine bug caught by direct signature comparison
 * against githubAppAuth.ts. Callers (ciCallback.ts) are updated in this
 * same sub-step to pass req.traceId.
 */
import { getInstallationAccessToken, loadGithubAppCredentialsFromEnv } from "./githubAppAuth";
import { loadEnv } from "../config/env";

export type MergeOutcome = "MERGED" | "REQUIRES_REVIEW";

export interface MergeResult {
  outcome: MergeOutcome;
  merge_commit_sha?: string;
  conflict_message?: string;
}

/**
 * Attempts to merge `sourceBranch` (e.g. auto/<session_id>) into the
 * target branch (defaults to env.GITHUB_DEFAULT_BRANCH, following the
 * same fallback convention as githubBranchService.ts in F.2 - never
 * hardcoded to "main" directly in this module).
 *
 * Returns MERGED with the resulting commit SHA on success, or
 * REQUIRES_REVIEW (never throws) when GitHub reports a 409 conflict -
 * callers must NOT treat REQUIRES_REVIEW as an exception-driven failure
 * path, since it is an expected, named terminal state per the TZ, not
 * an error condition to retry.
 *
 * Any other non-2xx/non-409 response (e.g. 404 missing branch, 403
 * permission, 422 nothing-to-merge) is thrown as an Error, since the TZ
 * gives no specific handling for those and they should surface as
 * INTERNAL_ERROR to the caller (ciCallback.ts) rather than being
 * silently swallowed.
 */
export async function mergeSessionBranchIntoDefault(
  sourceBranch: string,
  traceId: string,
  targetBranch?: string
): Promise<MergeResult> {
  const env = loadEnv();
  const owner = env.GITHUB_REPO_OWNER;
  const repo = env.GITHUB_REPO_NAME;
  const base = targetBranch ?? env.GITHUB_DEFAULT_BRANCH;

  if (!owner || !repo) {
    throw new Error(
      "GITHUB_REPO_OWNER / GITHUB_REPO_NAME must be set to perform a merge (Sub-step F.2/G.2 dependency)."
    );
  }

  // Sub-step H.0 FIX: getInstallationAccessToken() requires
  // (credentials: GithubAppCredentials, traceId: string) per its actual
  // signature in githubAppAuth.ts - the original call here passed zero
  // arguments, which would compile under TypeScript's structural typing
  // only if both parameters were optional (they are not), so this was a
  // genuine type error caught by direct comparison of the call site
  // against the callee's real signature (Established confidence). Fixed
  // by loading credentials via loadGithubAppCredentialsFromEnv() (same
  // pattern already used in routes/push.ts) and threading a traceId
  // through mergeSessionBranchIntoDefault() so callers (ciCallback.ts)
  // can supply the request's actual trace_id instead of a placeholder.
  const credentials = loadGithubAppCredentialsFromEnv();
  if (!credentials) {
    throw new Error(
      "GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID must be set to perform a merge (Sub-step F.1/G.2 dependency)."
    );
  }

  const tokenResult = await getInstallationAccessToken(credentials, traceId);
  if (!tokenResult) {
    throw new Error(
      "Failed to obtain a GitHub App installation access token for the merge attempt."
    );
  }
  const token = tokenResult.token;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/merges`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        base,
        head: sourceBranch,
        commit_message: `PNB: auto-merge ${sourceBranch} into ${base} after green CI (Sub-step G.2)`,
      }),
    }
  );

  if (response.status === 201) {
    const data = (await response.json()) as { sha: string };
    return { outcome: "MERGED", merge_commit_sha: data.sha };
  }

  if (response.status === 204) {
    // Base already up to date with head - GitHub's documented "nothing
    // to merge, already merged" success case; treat as MERGED.
    return { outcome: "MERGED" };
  }

  if (response.status === 409) {
    let message = "Merge conflict reported by GitHub (409); manual resolution required.";
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody?.message) {
        message = errBody.message;
      }
    } catch {
      // response body was not JSON; keep default message
    }
    return { outcome: "REQUIRES_REVIEW", conflict_message: message };
  }

  const errorText = await response.text();
  throw new Error(
    `GitHub merge request failed with unexpected status ${response.status}: ${errorText}`
  );
}