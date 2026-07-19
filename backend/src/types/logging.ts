export type OperationType =
  | "capture_conversation"
  | "capture_code_artifact"
  | "healthz_check"
  | "summarize_memory"
  | "handoff";

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