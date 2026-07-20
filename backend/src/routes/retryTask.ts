/**
 * POST /retry-task/:operation route handler (Sub-step H.1; business
 * logic dispatch wired in Sub-step H.3.5).
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
 * Sub-step H.3.5 UPDATE (closes a gap carried over, undocumented, from
 * the original implementation plan's H.2 line item "подключение
 * реальной бизнес-логики в OPERATION_HANDLERS" - that specific task was
 * NOT actually done during H.2, which only implemented the summarization
 * error-handling contract; see README H.3.5 section for the full trace):
 * OPERATION_HANDLERS now wires two real handlers -
 * "capture_conversation" -> retryConversationCapture() and
 * "capture_code_artifact" -> retryCodeArtifactCapture()
 * (services/captureRetryHandlers.ts). Both re-run the exact same
 * Firestore write capture.ts's own try block attempts on first pass,
 * with idempotency checks so a Cloud-Tasks-redelivered retry can never
 * create a duplicate artifact or double-append a conversation turn -
 * see captureRetryHandlers.ts's IDEMPOTENCY STRATEGY disclosure for the
 * exact guarantees and their limits.
 *
 * REMAINING EXPLICIT GAP (Established, not silently hidden): "push" and
 * "ci_callback" operation types are NOT wired here. routes/push.ts and
 * routes/ciCallback.ts do not currently call enqueueRetryTask() on
 * failure (they still write directly to dead_letter via
 * recordDeadLetter(), unchanged from prior sub-steps) - so no retry task
 * for those operation types is ever actually enqueued today, and adding
 * a handler here for them would be dead code with no caller. Wiring
 * push/CI retry-on-failure through this same queue is left as a
 * follow-up item, tracked in README as an open compromise, rather than
 * fabricated here as an unused handler.
 */
import { Request, Response } from "express";
import { deadLetterCollection } from "../models/collections";
import { withLogContext } from "../logger";
import { loadEnv } from "../config/env";
import {
  retryConversationCapture,
  retryCodeArtifactCapture,
} from "../services/captureRetryHandlers";

type OperationHandler = (payload: unknown) => Promise<void>;

const OPERATION_HANDLERS: Record<string, OperationHandler> = {
  // Sub-step H.3.5: real business-logic handlers, re-running the exact
  // Firestore write capture.ts attempts on first pass. See
  // services/captureRetryHandlers.ts for the full idempotency contract.
  capture_conversation: retryConversationCapture,
  capture_code_artifact: retryCodeArtifactCapture,
  // "push" and "ci_callback" intentionally NOT wired - see file header
  // REMAINING EXPLICIT GAP above.
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
      "retry-task received for an operation with no wired handler (see file header REMAINING EXPLICIT GAP for push/ci_callback)"
    );
    res.status(501).json({
      error: "operation_not_wired",
      operation,
      trace_id: traceId,
      note: "capture_conversation and capture_code_artifact are wired as of Sub-step H.3.5; push/ci_callback retry dispatch is a disclosed follow-up, not yet implemented.",
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