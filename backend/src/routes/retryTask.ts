/**
 * POST /retry-task/:operation route handler (Sub-step H.1).
 *
 * Receives HTTP task deliveries FROM Cloud Tasks (retryQueueService.ts
 * enqueues these) and re-executes the named failed operation. If Cloud
 * Tasks reports this is the LAST attempt Cloud Tasks itself will make
 * (X-CloudTasks-TaskRetryCount has reached the queue's configured
 * maxAttempts - 1), this handler writes to the dead_letter collection
 * directly via deadLetterCollection() (Sub-step B.1/B.3 model) instead
 * of re-attempting the operation, per the TZ's exhaustion behavior.
 *
 * SOURCE OF TRUTH FOR ATTEMPT COUNT (explicit disclosure): this handler
 * reads X-CloudTasks-TaskRetryCount from the request header (verified
 * via web search against docs.cloud.google.com/tasks/docs/creating-http-
 * target-tasks: "the number of times this task has been retried; for
 * the first attempt, this value is 0"), NOT env.RETRY_MAX_ATTEMPTS minus
 * some independently-tracked counter, so there is exactly one place
 * (Cloud Tasks itself) deciding how many attempts have occurred - this
 * avoids the two-source-of-truth drift risk called out in
 * retryQueueService.ts's header.
 *
 * OPERATION DISPATCH (explicit gap disclosure): this handler currently
 * supports only a generic "record-and-either-retry-signal-or-dead-
 * letter" flow; it does NOT itself know how to literally re-run
 * capture-ingestion or summarization business logic, because doing so
 * would require importing and safely re-invoking those modules' current
 * internal functions, which this session has not independently
 * re-verified the current signatures of within this sub-step. Per the
 * Anti-Sycophancy / Symmetric Self-Verification rule against fabricating
 * unseen file internals, this handler responds with a 501 for any
 * operation name it does not have an explicitly wired handler for
 * (currently none are wired), and existing failure call sites are NOT
 * yet switched over to route through this queue - see
 * retryQueueService.ts's "INTEGRATION DISCLOSURE" for the matching gap
 * on the enqueue side. This sub-step therefore delivers the
 * queue+backoff+exhaustion INFRASTRUCTURE per TZ 3.4, with actual
 * business-logic dispatch left as an explicit, disclosed follow-up
 * rather than silently faked with a placeholder no-op that would look
 * complete but do nothing real.
 */
import { Request, Response } from "express";
import { deadLetterCollection } from "../models/collections";
import { withLogContext } from "../logger";
import { loadEnv } from "../config/env";

type OperationHandler = (payload: unknown) => Promise<void>;

const OPERATION_HANDLERS: Record<string, OperationHandler> = {
  // Sub-step H.1 explicit gap: no operations are wired yet. Adding an
  // entry here is how a future sub-step connects a real business-logic
  // retry (e.g. "capture_conversation": reRunCaptureIngestion) instead
  // of falling through to the 501 branch below.
};

export async function handleRetryTask(req: Request, res: Response): Promise<void> {
  const traceId = req.traceId;
  const operation = req.params.operation;
  const env = loadEnv();

  const retryCountHeader = req.header("X-CloudTasks-TaskRetryCount");
  const retryCount = retryCountHeader ? parseInt(retryCountHeader, 10) : 0;
  const maxAttempts = env.RETRY_MAX_ATTEMPTS;

  const body = req.body as {
    operation: string;
    trace_id: string;
    chat_id?: string;
    session_id?: string;
    original_payload: unknown;
    reason: string;
  };

  const isLastAttempt = retryCount >= maxAttempts - 1;

  const handler = OPERATION_HANDLERS[operation];

  if (!handler) {
    withLogContext({
      trace_id: traceId,
      chat_id: body?.chat_id,
      session_id: body?.session_id,
      operation_type: "retry_task",
      result_status: "VALIDATION_FAILED",
      retry_count: retryCount,
    }).warn(
      { operation },
      "retry-task received for an operation with no wired handler yet (explicit H.1 gap, not a silent no-op)"
    );
    res.status(501).json({
      error: "operation_not_wired",
      operation,
      trace_id: traceId,
      note: "H.1 delivers retry queue infrastructure; business-logic dispatch for this operation is an explicit follow-up, not yet implemented.",
    });
    return;
  }

  try {
    await handler(body.original_payload);
    withLogContext({
      trace_id: traceId,
      chat_id: body?.chat_id,
      session_id: body?.session_id,
      operation_type: "retry_task",
      result_status: "ACCEPTED",
      retry_count: retryCount,
    }).info({ operation }, "retry-task succeeded");
    res.status(200).json({ accepted: true, operation, retry_count: retryCount, trace_id: traceId });
  } catch (err) {
    if (isLastAttempt) {
      await deadLetterCollection().add({
        original_payload: body?.original_payload,
        reason: body?.reason ?? "retry attempts exhausted",
        trace_id: traceId,
        chat_id: body?.chat_id,
        session_id: body?.session_id,
        failed_at: new Date().toISOString(),
        retry_count: retryCount,
      });

      withLogContext({
        trace_id: traceId,
        chat_id: body?.chat_id,
        session_id: body?.session_id,
        operation_type: "retry_task",
        result_status: "INTERNAL_ERROR",
        retry_count: retryCount,
      }).error({ err, operation }, "retry-task exhausted all attempts, moved to dead_letter");

      // 200, not 5xx: tell Cloud Tasks NOT to retry further - we have
      // already terminally handled this failure via dead-letter, so a
      // 5xx here would cause Cloud Tasks to schedule yet another retry
      // beyond the queue's own maxAttempts accounting drifting further.
      res.status(200).json({
        accepted: true,
        operation,
        retry_count: retryCount,
        dead_lettered: true,
        trace_id: traceId,
      });
      return;
    }

    withLogContext({
      trace_id: traceId,
      chat_id: body?.chat_id,
      session_id: body?.session_id,
      operation_type: "retry_task",
      result_status: "INTERNAL_ERROR",
      retry_count: retryCount,
    }).warn({ err, operation }, "retry-task attempt failed, Cloud Tasks will retry with backoff");

    // 500 signals Cloud Tasks to retry per the queue's exponential
    // backoff policy (infra/create_retry_queue.sh) - this is the
    // intended mechanism for "retry later," not an unhandled crash.
    res.status(500).json({ error: "retry_failed", operation, retry_count: retryCount, trace_id: traceId });
  }
}