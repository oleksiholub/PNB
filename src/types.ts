/**
 * Shared data model types, mirroring TZ section 4 (Data Model) exactly.
 * Single source of truth for capture payload shape across routes/services/repositories.
 */

export type CompressionLevel = "normal" | "aggressive" | "emergency";
export type QaStatus = "PASSED" | "FAILED" | "FIXING";
export type PushStatus =
  | "PENDING"
  | "REJECTED_BY_QA_GATE"
  | "PUSHED"
  | "PUSHED_NO_CI"
  | "CI_FAILED"
  | "MERGED"
  | "REQUIRES_REVIEW";
export type BrowserFamily = "kiwi" | "yandex" | "other";
export type ArtifactType = "code";

export interface MemoryBlob {
  summary: string;
  entities: string[];
  action_items: string[];
  raw_history_refs: string[];
  encrypted: boolean;
  schema_version: string;
  compression_level: CompressionLevel;
}

export interface CodeArtifact {
  artifact_id: string;
  artifact_type: ArtifactType;
  content: string;
  content_hash: string;
  qa_status: QaStatus;
  push_requested: boolean;
  target_branch: string;
  push_status: PushStatus;
  retry_count: number;
}

export interface SelectorConfigRef {
  version: string;
  source: string;
}

export interface ContextMetadata {
  created_at: string;
  last_interaction: string;
  model_context: string;
  owner_uid: string;
  browser_family: BrowserFamily;
  device_platform: "android";
}

export interface ContextRecord {
  chat_id: string;
  session_id: string;
  trace_id: string;
  memory_blob?: MemoryBlob;
  code_artifact?: CodeArtifact;
  selector_config_ref?: SelectorConfigRef;
  metadata: ContextMetadata;
}

/**
 * Raw inbound payload for POST /capture, per TZ section 3.2:
 * either a plain (user_message, model_response, metadata) turn,
 * or an artifact_type: "code" payload with push_requested.
 */
export interface CaptureRequestBody {
  chat_id: string;
  session_id: string;
  owner_uid: string;
  user_message?: string;
  model_response?: string;
  artifact_type?: ArtifactType;
  code_artifact?: Partial<CodeArtifact>;
  push_requested?: boolean;
  metadata?: Partial<ContextMetadata>;
}

export interface CaptureAcceptedResponse {
  status: "ACCEPTED" | "DEDUPLICATED";
  chat_id: string;
  session_id: string;
  trace_id: string;
  artifact_id?: string;
  push_status?: PushStatus;
}
