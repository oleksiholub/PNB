import { deadLetterCollection } from "../models/collections";
import { DeadLetterDocument } from "../models/types";
import { withLogContext } from "../logger";
import { OperationType } from "../types/logging";

export interface DeadLetterInput {
  traceId: string;
  chatId?: string;
  sessionId?: string;
  reason: string;
  originalPayload: unknown;
  operationType: OperationType;
}

export async function recordDeadLetter(
  input: DeadLetterInput
): Promise<boolean> {
  const doc: DeadLetterDocument = {
    original_payload: input.originalPayload,
    reason: input.reason,
    trace_id: input.traceId,
    chat_id: input.chatId,
    session_id: input.sessionId,
    failed_at: new Date().toISOString(),
    retry_count: 0,
  };

  try {
    await deadLetterCollection().add(doc);
    withLogContext({
      trace_id: input.traceId,
      chat_id: input.chatId,
      session_id: input.sessionId,
      operation_type: input.operationType,
      result_status: "ACCEPTED",
      retry_count: 0,
    }).warn(
      { reason: input.reason },
      "event recorded to dead_letter after primary persistence failure"
    );
    return true;
  } catch (err) {
    withLogContext({
      trace_id: input.traceId,
      chat_id: input.chatId,
      session_id: input.sessionId,
      operation_type: input.operationType,
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      { err, reason: input.reason },
      "dead_letter write ALSO failed - event genuinely lost until Sub-step H.1's retry queue exists"
    );
    return false;
  }
}