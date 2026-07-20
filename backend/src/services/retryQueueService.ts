/**
 * Cloud Tasks-backed retry queue service (Sub-step H.1).
 *
 * TZ section 3.4: "Failed operations (capture ingestion, summarization,
 * push, etc.) must be retried with exponential backoff before being
 * moved to the dead-letter collection (dead_letter, Sub-step B.1/B.3) -
 * retries must not be an unbounded busy-loop and must not block the
 * original request."
 *
 * WHY CLOUD TASKS RATHER THAN AN IN-PROCESS SETTIMEOUT LOOP: Cloud Run
 * instances are not guaranteed to stay alive between requests (they can
 * scale to zero), so any retry mechanism relying on in-memory timers
 * would silently lose pending retries whenever the instance recycles.
 * Cloud Tasks persists the retry schedule server-side and re-delivers
 * the HTTP task to a (possibly different) Cloud Run instance - this is
 * the standard GCP-native pattern for exactly this failure mode
 * (verified via web search against docs.cloud.google.com/tasks and
 * multiple independent Cloud Tasks retry-policy references).
 *
 * BACKOFF CONFIGURATION LOCATION: exponential backoff itself
 * (minBackoff/maxBackoff/maxDoublings/maxAttempts) is configured at the
 * QUEUE level in Cloud Tasks, not per-task and not in this application
 * code - see infra/create_retry_queue.sh. This service only ENQUEUES
 * tasks; Cloud Tasks' own retry engine is what actually waits and
 * re-delivers, which is why this module contains no sleep/setTimeout
 * logic of its own.
 *
 * RETRY-COUNT SOURCE OF TRUTH: the retry-processing route
 * (routes/retryTask.ts) reads the CURRENT attempt number from Cloud
 * Tasks' own X-CloudTasks-TaskRetryCount request header, not from a
 * counter maintained in Firestore or in the task payload - Cloud Tasks
 * is the authoritative source for "how many times has this specific
 * task been attempted," and duplicating that counter in application
 * state would risk drift between the two if a task is ever manually
 * re-queued.
 */
import { CloudTasksClient } from "@google-cloud/tasks";
import { loadEnv } from "../config/env";
import { withLogContext } from "../logger";

const tasksClient = new CloudTasksClient();

export interface RetryTaskPayload {
  operation: string;
  trace_id: string;
  chat_id?: string;
  session_id?: string;
  original_payload: unknown;
  reason: string;
}

/**
 * Enqueues a Cloud Tasks HTTP task that will call back into
 * POST /retry-task/:operation on this same backend service, carrying
 * the original failed payload plus enough context (trace_id, chat_id,
 * session_id) for the retry handler and, if attempts are exhausted, the
 * dead-letter writer (deadLetterService.ts, Sub-step B.1/B.3) to
 * correlate the failure back to its origin.
 *
 * Callers (e.g. capture.ts's ingestion error handler, or
 * summarizationService.ts's LangGraph pipeline error handler) invoke
 * this INSTEAD OF calling the dead-letter writer directly on first
 * failure - the dead-letter write now happens only inside
 * routes/retryTask.ts, after Cloud Tasks reports that attempts are
 * exhausted (see that file's header for the exact exhaustion check).
 *
 * INTEGRATION DISCLOSURE (explicit, not silently assumed): wiring the
 * existing capture-ingestion (B.1) and summarization (E.1) failure
 * paths to call this function instead of writing directly to
 * dead_letter is a follow-up code change to those two files' existing
 * catch blocks. It is NOT performed as part of this sub-step, because
 * this session does not have independently re-verified current source
 * of capture.ts / summarizationService.ts to safely edit without risk
 * of silently overwriting unrelated logic added in prior sub-steps.
 * This gap is called out explicitly per the Anti-Sycophancy /
 * Symmetric Self-Verification rule against fabricating unseen file
 * state, and is flagged as an open item for the next sub-step or an
 * explicit follow-up instruction.
 */
export async function enqueueRetryTask(payload: RetryTaskPayload): Promise<string> {
  const env = loadEnv();

  if (!env.RETRY_QUEUE_NAME || !env.RETRY_QUEUE_LOCATION || !env.GCP_PROJECT_ID) {
    throw new Error(
      "RETRY_QUEUE_NAME, RETRY_QUEUE_LOCATION, and GCP_PROJECT_ID must be set to enqueue a retry task (Sub-step H.1 dependency)."
    );
  }

  const parent = tasksClient.queuePath(
    env.GCP_PROJECT_ID,
    env.RETRY_QUEUE_LOCATION,
    env.RETRY_QUEUE_NAME
  );

  const url = `${env.RETRY_CALLBACK_BASE_URL ?? ""}/retry-task/${encodeURIComponent(payload.operation)}`;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");

  const [response] = await tasksClient.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: "POST",
        url,
        headers: { "Content-Type": "application/json" },
        body,
        oidcToken: env.SERVICE_AUDIENCE
          ? { serviceAccountEmail: env.RETRY_QUEUE_INVOKER_SA ?? "", audience: env.SERVICE_AUDIENCE }
          : undefined,
      },
    },
  });

  withLogContext({
    trace_id: payload.trace_id,
    chat_id: payload.chat_id,
    session_id: payload.session_id,
    operation_type: "retry_task",
    result_status: "ACCEPTED",
    retry_count: 0,
  }).info({ task_name: response.name, operation: payload.operation }, "retry task enqueued via Cloud Tasks");

  return response.name ?? "";
}