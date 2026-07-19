export type CompressionLevel = "normal" | "aggressive" | "emergency";

export interface MemoryBlob {
  summary: string;
  entities: string[];
  action_items: string[];
  raw_history_refs: string[];
  encrypted: boolean;
  schema_version: "v1";
  compression_level: CompressionLevel;
}

export type QaStatus = "PASSED" | "FAILED" | "FIXING";

export type PushStatus =
  | "PENDING"
  | "REJECTED_BY_QA_GATE"
  | "PUSHED"
  | "PUSHED_NO_CI"
  | "CI_FAILED"
  | "MERGED"
  | "REQUIRES_REVIEW";

export interface CodeArtifactDocument {
  artifact_id: string;
  artifact_type: "code";
  content: string;
  content_hash: string;
  qa_status: QaStatus;
  push_requested: boolean;
  target_branch: string;
  push_status: PushStatus;
  retry_count: number;
  chat_id: string;
  session_id: string;
  owner_uid: string;
  created_at: string;
}

export interface ChatContextDocument {
  chat_id: string;
  session_id: string;
  trace_id: string;
  memory_blob: MemoryBlob;
  owner_uid: string;
  created_at: string;
  last_interaction: string;
  model_context?: string;
  browser_family?: "kiwi" | "helium" | "lemur" | "other";
  device_platform?: "android";
}

export interface DeadLetterDocument {
  original_payload: unknown;
  reason: string;
  trace_id: string;
  chat_id?: string;
  session_id?: string;
  failed_at: string;
  retry_count: number;
}

export interface SelectorConfigDocument {
  version: string;
  payload: unknown;
  published_at: string;
}