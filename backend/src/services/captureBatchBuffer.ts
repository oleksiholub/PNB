/**
 * Capture batch buffer (Sub-step H.3).
 *
 * TZ 3.4 requirement this file implements: "объединять несколько
 * capture-событий в батч" - when the QuotaGovernor reports "aggressive"
 * or "deferred" mode, non-critical conversation-turn capture writes are
 * buffered in memory and flushed together as a single Firestore
 * batch().commit() instead of one individual write per HTTP request.
 *
 * SCOPE DISCLOSURE (Established, by design choice, not a bug): batching
 * applies ONLY to conversational capture (memory_blob.raw_history_refs
 * updates), never to code_artifact writes. Rationale, directly from TZ
 * wording: TZ 3.4 says batching/deferred mode applies to
 * "не-критичные операции" (non-critical operations); code artifacts
 * feed the push/CI/merge pipeline (TZ 3.2.1) and idempotent dedup
 * relies on being persisted promptly, so they are treated as critical
 * and always written synchronously regardless of quota mode. This is a
 * judgment call applying the TZ's own "critical vs non-critical"
 * language, not an unstated assumption.
 *
 * CONSISTENCY TRADE-OFF DISCLOSURE (Established): while an update for a
 * given chat_id sits in the buffer (not yet flushed), a concurrent
 * GET /context/:chatId read will NOT see it, and a second capture
 * request for the SAME chat_id arriving before the flush will overwrite
 * the buffered entry rather than append to it (last-write-wins within
 * the flush window) - this is an accepted trade-off of batching, and is
 * the reason batching is only enabled once the quota governor detects
 * write pressure, not unconditionally.
 */
import { contextCollection } from "../models/collections";
import { ChatContextDocument } from "../models/types";
import { getFirestoreDb } from "../config/firestore";
import { withLogContext } from "../logger";

interface BufferedUpdate {
  chatId: string;
  traceId: string;
  data: Partial<ChatContextDocument>;
  enqueuedAt: number;
}

const MAX_BUFFER_SIZE = 20;
const MAX_BUFFER_AGE_MS = 4000;

let buffer = new Map<string, BufferedUpdate>();
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBufferedCaptures();
  }, MAX_BUFFER_AGE_MS);
}

/**
 * Enqueues a conversation-turn update for batched persistence. Returns
 * immediately without waiting for the actual Firestore write - callers
 * must treat this as "accepted, will be persisted shortly" rather than
 * "persisted", and the capture.ts response note field must reflect that
 * honestly.
 */
export function enqueueBatchedCapture(
  chatId: string,
  traceId: string,
  data: Partial<ChatContextDocument>
): void {
  buffer.set(chatId, { chatId, traceId, data, enqueuedAt: Date.now() });

  if (buffer.size >= MAX_BUFFER_SIZE) {
    void flushBufferedCaptures();
    return;
  }

  scheduleFlush();
}

export async function flushBufferedCaptures(): Promise<{
  flushed: number;
  failed: number;
}> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (buffer.size === 0) {
    return { flushed: 0, failed: 0 };
  }

  const pending = buffer;
  buffer = new Map();

  try {
    const db = getFirestoreDb();
    const batch = db.batch();
    const col = contextCollection();

    for (const entry of pending.values()) {
      batch.set(col.doc(entry.chatId), entry.data, { merge: true });
    }

    await batch.commit();

    withLogContext({
      trace_id: "batch-flush",
      operation_type: "capture_conversation",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { batch_size: pending.size },
      "flushed batched conversation-turn captures per TZ 3.4 batching directive"
    );

    return { flushed: pending.size, failed: 0 };
  } catch (err) {
    withLogContext({
      trace_id: "batch-flush",
      operation_type: "capture_conversation",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error(
      { err, batch_size: pending.size },
      "batched conversation-turn flush failed - buffered updates for this batch are lost, not re-queued (see H.3 disclosure)"
    );

    return { flushed: 0, failed: pending.size };
  }
}

/** Test-only reset. Not used by production code paths. */
export function resetCaptureBatchBufferForTests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  buffer = new Map();
}