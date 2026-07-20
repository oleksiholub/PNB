/**
 * Capture retry handlers (Sub-step H.3.5).
 *
 * PURPOSE: this file closes the gap explicitly disclosed in H.1's
 * retryTask.ts header ("OPERATION DISPATCH... this handler currently
 * supports only a generic record-and-either-retry-signal-or-dead-letter
 * flow; it does NOT itself know how to literally re-run capture-
 * ingestion... business logic") and in the old implementation plan's
 * H.2 line item "подключение реальной бизнес-логики в
 * OPERATION_HANDLERS", which was never actually implemented in H.2 -
 * see the H.3.5 README section for the explicit trace of that carried-
 * over gap.
 *
 * SCOPE (Established, explicit): these handlers re-run EXACTLY the same
 * Firestore write that capture.ts's own try block attempts on the first
 * pass - conversation-turn append to `context/{chat_id}` and
 * code-artifact insert into `code_artifacts`. They do NOT re-run
 * anything downstream of capture (no push, no CI trigger, no
 * summarization) - a failed capture write means the artifact/turn never
 * reached Firestore in the first place, so there is nothing downstream
 * to re-run; summarization and push are separately triggered AFTER a
 * successful capture write, on the next capture request or via
 * routes/push.ts respectively, and are out of scope for this file.
 *
 * IDEMPOTENCY STRATEGY (Established, by design):
 *   - Code artifacts: reuse the EXACT SAME content_hash-based dedup
 *     query capture.ts already performs on first attempt. If Cloud
 *     Tasks redelivers this retry task after the original write
 *     actually succeeded (e.g. the write committed but the HTTP
 *     response to capture.ts's caller never got a chance to run before
 *     a crash), the dedup query finds the existing doc and this handler
 *     is a safe no-op rather than creating a duplicate artifact.
 *   - Conversation turns: raw_history_refs has no unique key of its own
 *     (TZ 4 defines it as a plain string array), so this handler
 *     applies a narrower idempotency check - if the LAST entry in the
 *     array already equals the turn being retried, it assumes the
 *     original write already committed and skips re-appending. This is
 *     a best-effort heuristic, not a cryptographic guarantee: two
 *     genuinely distinct turns with identical text back-to-back would
 *     be (harmlessly) treated as "already applied" and the second one
 *     silently dropped. This trade-off is accepted rather than adding a
 *     per-turn UUID to the schema, which would be a TZ 4 schema change
 *     outside this sub-step's scope - documented as an open compromise.
 */
import { contextCollection, codeArtifactsCollection } from "../models/collections";
import { ChatContextDocument, CodeArtifactDocument, QaStatus } from "../models/types";
import { buildSessionBranchName } from "../utils/branchNaming";
import { sha256Hex } from "../utils/hash";
import { newArtifactId } from "../utils/ids";
import { getQuotaGovernor } from "./quotaGovernor";
import { withLogContext } from "../logger";

export interface ConversationRetryPayload {
  chat_id: string;
  session_id: string;
  trace_id: string;
  owner_uid: string;
  user_message?: string;
  model_response?: string;
}

export interface CodeArtifactRetryPayload {
  chat_id: string;
  session_id: string;
  owner_uid: string;
  content: string;
  push_requested: boolean;
  qa_status?: QaStatus;
}

/**
 * Re-runs a failed conversation-turn capture write. Throws on any
 * unexpected condition (owner_uid mismatch, Firestore error) so that
 * routes/retryTask.ts's existing catch block correctly signals Cloud
 * Tasks to retry again (or dead-letter on exhaustion) - this function
 * intentionally does NOT swallow errors itself.
 */
export async function retryConversationCapture(
  payloadUnknown: unknown
): Promise<void> {
  const payload = payloadUnknown as ConversationRetryPayload;
  const { chat_id, session_id, trace_id, owner_uid } = payload;

  if (!chat_id || !owner_uid) {
    throw new Error(
      "retryConversationCapture: malformed payload - chat_id and owner_uid are required"
    );
  }

  const docRef = contextCollection().doc(chat_id);
  const nowIso = new Date().toISOString();
  const existingSnap = await docRef.get();
  const rawRef = payload.user_message ?? payload.model_response ?? "";

  if (existingSnap.exists) {
    const existingData = existingSnap.data() as ChatContextDocument;

    if (existingData.owner_uid !== owner_uid) {
      throw new Error(
        `retryConversationCapture: chat_id ${chat_id} owner_uid mismatch - refusing cross-owner retry write`
      );
    }

    const refs = existingData.memory_blob.raw_history_refs;
    const alreadyApplied = refs.length > 0 && refs[refs.length - 1] === rawRef;

    if (alreadyApplied) {
      withLogContext({
        trace_id,
        chat_id,
        session_id,
        operation_type: "retry_task",
        result_status: "ACCEPTED",
        retry_count: 0,
      }).info(
        "retryConversationCapture: last raw_history_refs entry already matches this turn, treating as already-applied no-op"
      );
      return;
    }

    await docRef.set(
      {
        last_interaction: nowIso,
        memory_blob: {
          ...existingData.memory_blob,
          raw_history_refs: [...refs, rawRef],
        },
      },
      { merge: true }
    );
  } else {
    const newDoc: ChatContextDocument = {
      chat_id,
      session_id,
      trace_id,
      owner_uid,
      created_at: nowIso,
      last_interaction: nowIso,
      memory_blob: {
        summary: "",
        entities: [],
        action_items: [],
        raw_history_refs: [rawRef],
        encrypted: false,
        schema_version: "v1",
        compression_level: "normal",
      },
    };
    await docRef.set(newDoc);
  }

  getQuotaGovernor().recordWrite();

  withLogContext({
    trace_id,
    chat_id,
    session_id,
    operation_type: "retry_task",
    result_status: "ACCEPTED",
    retry_count: 0,
  }).info("retryConversationCapture: conversation turn re-written to Firestore on retry");
}

/**
 * Re-runs a failed code-artifact capture write, reusing the same
 * content_hash dedup check capture.ts performs on the first attempt so
 * a redelivered retry task never creates a duplicate artifact.
 */
export async function retryCodeArtifactCapture(
  payloadUnknown: unknown
): Promise<void> {
  const payload = payloadUnknown as CodeArtifactRetryPayload;
  const { chat_id, session_id, owner_uid, content } = payload;

  if (!chat_id || !owner_uid || !content) {
    throw new Error(
      "retryCodeArtifactCapture: malformed payload - chat_id, owner_uid and content are required"
    );
  }

  const contentHash = sha256Hex(content);
  const collection = codeArtifactsCollection();

  const existing = await collection
    .where("chat_id", "==", chat_id)
    .where("content_hash", "==", contentHash)
    .limit(1)
    .get();

  if (!existing.empty) {
    const existingDoc = existing.docs[0].data();

    if (existingDoc.owner_uid !== owner_uid) {
      throw new Error(
        `retryCodeArtifactCapture: content_hash collision across different owner_uid for chat_id ${chat_id} - refusing cross-owner retry write`
      );
    }

    withLogContext({
      trace_id: "retry",
      chat_id,
      session_id,
      operation_type: "retry_task",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { artifact_id: existingDoc.artifact_id },
      "retryCodeArtifactCapture: matching content_hash already exists, treating as already-applied no-op"
    );
    return;
  }

  const artifactId = newArtifactId();
  const doc: CodeArtifactDocument = {
    artifact_id: artifactId,
    artifact_type: "code",
    content,
    content_hash: contentHash,
    qa_status: payload.qa_status ?? "FAILED",
    push_requested: payload.push_requested,
    target_branch: buildSessionBranchName(session_id),
    push_status: "PENDING",
    retry_count: 0,
    chat_id,
    session_id,
    owner_uid,
    created_at: new Date().toISOString(),
  };

  await collection.doc(artifactId).set(doc);
  getQuotaGovernor().recordWrite();

  withLogContext({
    trace_id: "retry",
    chat_id,
    session_id,
    operation_type: "retry_task",
    result_status: "ACCEPTED",
    retry_count: 0,
  }).info(
    { artifact_id: artifactId },
    "retryCodeArtifactCapture: code artifact re-written to Firestore on retry"
  );
}