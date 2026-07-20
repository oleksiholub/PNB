/**
 * Shared structured-logging field vocabulary.
 * TZ section 3.2 mandates that ALL critical operations log:
 * session_id, chat_id, trace_id, operation_type, result_status, retry_count.
 * Centralizing the allowed operation_type/result_status values here
 * prevents ad-hoc string drift across route handlers as more iterations
 * (B-J) add new operations.
 */

export type OperationType =
  | "capture_conversation"
  | "capture_code_artifact"
  | "healthz_check"
  | "summarize_memory"
  | "handoff"
  | "selector_config_fetch"
  | "selector_config_publish"
  | "ci_callback";

export type ResultStatus =
  | "ACCEPTED"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export interface LogContextFields {
  trace_id: string;
  chat_id?: string;
  session_id?: string;
  operation_type: OperationType;
  result_status: ResultStatus;
  retry_count: number;
}