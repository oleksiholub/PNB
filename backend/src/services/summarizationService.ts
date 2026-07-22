/**
 * Memory summarization service via LangGraph.js (Sub-step E.1;
 * Sub-step H.0 fixed a syntax bug; Sub-step H.2 implements the full
 * TZ 3.4 error-handling contract for this pipeline).
 *
 * Sub-step H.3 addition: pickCompressionLevel() now also consults
 * services/quotaGovernor.ts so that, per TZ 3.4's "включить более
 * агрессивную суммаризацию" clause, elevated Firestore write pressure
 * forces a floor on compression_level (aggressive/emergency) regardless
 * of raw_history_refs.length alone. See pickCompressionLevel() below for
 * the exact floor-vs-override semantics.
 *
 * TZ SECTION 3.4 REQUIREMENTS THIS FILE MUST SATISFY (quoted, translated):
 *   (a) "Если LangGraph.js завершился ошибкой на суммаризации, исходный
 *       capture сохраняется как RAW_FALLBACK, а в память временно
 *       записывается сырой укороченный фрагмент по безопасному лимиту
 *       размера." -> triggered when the graph THROWS (an exception),
 *       not merely produces invalid output.
 *   (b) "Если LangGraph.js вернул невалидную структуру (missing entities,
 *       broken JSON, oversized output), backend выполняет одну попытку
 *       repair-pass; при повторной неудаче включается deterministic
 *       fallback serializer." -> triggered when the graph COMPLETES but
 *       validateNode() marks the result invalid; exactly ONE additional
 *       repair attempt must be made before falling back to the
 *       deterministic serializer.
 *
 * SUB-STEP H.2 GAP FOUND AND FIXED (Established confidence, found by
 * direct comparison of the prior implementation against the TZ text
 * above): the prior version of this file collapsed both (a) and (b)
 * into a single code path - ANY invalid-or-thrown outcome went straight
 * to buildDeterministicFallback() with zero repair attempts, and a
 * THROWN exception from compiledGraph.invoke() was caught by the
 * OUTER try/catch and returned `{ updated: false, usedFallback: false }`
 * WITHOUT ever writing anything to memory_blob - meaning requirement (a)
 * was not implemented at all: an exception left the stored memory_blob
 * completely stale rather than being overwritten with a RAW_FALLBACK
 * truncated fragment as the TZ mandates. This sub-step fixes both gaps:
 *   - runSummarizationAttempt() wraps a single compiledGraph.invoke()
 *     call and normalizes both "threw" and "returned invalid" into one
 *     { ok: boolean, ... } result shape, but the two cases are tagged
 *     differently (`threw` vs `invalid`) so callers can apply the
 *     correct TZ behavior to each.
 *   - On a THROWN exception, summarizeAndUpdateMemory() now writes a
 *     RAW_FALLBACK summary (via buildRawFallbackOnException(), capped at
 *     RAW_FALLBACK_EXCEPTION_CHARS) directly to memory_blob instead of
 *     silently returning without persisting anything - satisfying
 *     requirement (a).
 *   - On an INVALID (but non-throwing) result, the pipeline now retries
 *     the graph invocation exactly once ("repair-pass") before falling
 *     back to buildDeterministicFallback() - satisfying requirement (b).
 *     The repair-pass reuses the same compiled graph and rawHistoryRefs;
 *     it is a deliberately simple immediate retry rather than a
 *     different repair strategy, since the TZ does not specify what a
 *     "repair" transformation should look like beyond "one more attempt"
 *     - this is disclosed rather than inventing unrequested repair logic.
 */
import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { contextCollection } from "../models/collections";
import { MemoryBlob, CompressionLevel, ChatContextDocument } from "../models/types";
import { withLogContext } from "../logger";
import { getQuotaGovernor, QuotaMode } from "./quotaGovernor";

export const SUMMARIZATION_TRIGGER_EVERY_N_TURNS = 5;

const MAX_SUMMARY_CHARS = 4000;
const AGGRESSIVE_THRESHOLD_REFS = 30;
const EMERGENCY_THRESHOLD_REFS = 60;
const RAW_FALLBACK_EXCEPTION_CHARS = 500;

interface GraphState {
  rawHistoryRefs: string[];
  entities: string[];
  actionItems: string[];
  summary: string;
  valid: boolean;
  invalidReason?: string;
}

const StateAnnotation = Annotation.Root({
  rawHistoryRefs: Annotation<string[]>(),
  entities: Annotation<string[]>({ default: () => [] }),
  actionItems: Annotation<string[]>({ default: () => [] }),
  summary: Annotation<string>({ default: () => "" }),
  valid: Annotation<boolean>({ default: () => false }),
  invalidReason: Annotation<string | undefined>({ default: () => undefined }),
});

const CAPITALIZED_WORD_RE = /\b[A-ZА-Я][a-zа-я]{2,}\b/g;
const ACTION_VERB_RE = /\b(need to|should|must|нужно|следует|необходимо|todo|fixme)\b[^.!?\n]{0,120}/gi;

function extractEntitiesNode(state: GraphState): Partial<GraphState> {
  const joined = state.rawHistoryRefs.join("\n");
  const matches = joined.match(CAPITALIZED_WORD_RE) ?? [];
  const unique = Array.from(new Set(matches)).slice(0, 25);
  return { entities: unique };
}

function extractActionItemsNode(state: GraphState): Partial<GraphState> {
  const joined = state.rawHistoryRefs.join("\n");
  const matches = joined.match(ACTION_VERB_RE) ?? [];
  const trimmed = matches.map((m) => m.trim()).slice(0, 15);
  return { actionItems: trimmed };
}

function summarizeNode(state: GraphState): Partial<GraphState> {
  const joined = state.rawHistoryRefs.join(" ");
  const truncated =
    joined.length > MAX_SUMMARY_CHARS
      ? `${joined.slice(0, MAX_SUMMARY_CHARS)}... [truncated, ${joined.length} chars total]`
      : joined;
  return { summary: truncated };
}

function validateNode(state: GraphState): Partial<GraphState> {
  if (typeof state.summary !== "string") {
    return { valid: false, invalidReason: "summary_not_string" };
  }
  if (state.summary.length > MAX_SUMMARY_CHARS + 200) {
    return { valid: false, invalidReason: "summary_oversized_after_truncation" };
  }
  if (!Array.isArray(state.entities) || !Array.isArray(state.actionItems)) {
    return { valid: false, invalidReason: "entities_or_action_items_malformed" };
  }
  return { valid: true };
}

function buildGraph() {
  const graph = new StateGraph(StateAnnotation)
    .addNode("extractEntities", extractEntitiesNode)
    .addNode("extractActionItems", extractActionItemsNode)
    .addNode("summarize", summarizeNode)
    .addNode("validate", validateNode)
    .addEdge(START, "extractEntities")
    .addEdge("extractEntities", "extractActionItems")
    .addEdge("extractActionItems", "summarize")
    .addEdge("summarize", "validate")
    .addEdge("validate", END);

  return graph.compile();
}

function buildDeterministicFallback(rawHistoryRefs: string[]): {
  summary: string;
  entities: string[];
  actionItems: string[];
} {
  const joined = rawHistoryRefs.join(" ").slice(0, 500);
  return {
    summary: `[RAW_FALLBACK] ${joined}`,
    entities: [],
    actionItems: [],
  };
}

/**
 * Sub-step H.2 addition: builds the RAW_FALLBACK payload for TZ 3.4
 * requirement (a) - a THROWN LangGraph exception, as opposed to a
 * returned-but-invalid structure (requirement (b), handled separately
 * via the repair-pass). Deliberately reuses the same "[RAW_FALLBACK] "
 * prefix convention as buildDeterministicFallback() so both fallback
 * paths are visually identifiable in stored memory_blob.summary values,
 * but is kept as a distinct function since the TZ describes them as two
 * separate failure conditions with two separate trigger clauses.
 */
function buildRawFallbackOnException(rawHistoryRefs: string[]): {
  summary: string;
  entities: string[];
  actionItems: string[];
} {
  const joined = rawHistoryRefs.join(" ").slice(0, RAW_FALLBACK_EXCEPTION_CHARS);
  return {
    summary: `[RAW_FALLBACK] ${joined}`,
    entities: [],
    actionItems: [],
  };
}

/**
 * Sub-step H.3 update: pickCompressionLevel() now also accepts the
 * current QuotaMode (services/quotaGovernor.ts) and escalates the
 * ref-count-based level per TZ 3.4's "включить более агрессивную
 * суммаризацию" directive when Firestore write pressure is elevated -
 * "aggressive" quota mode floors the result at "aggressive" even if
 * refCount alone would say "normal"; "deferred" quota mode floors the
 * result at "emergency" (the most compressed level this schema
 * supports - TZ 4 defines only normal|aggressive|emergency, so
 * "deferred" quota mode maps to the strongest existing compression
 * level rather than inventing a new one). This is a floor, not an
 * override: a refCount that already independently warrants "emergency"
 * stays "emergency" regardless of quota mode.
 */
function pickCompressionLevel(
  refCount: number,
  quotaMode: QuotaMode = "normal"
): CompressionLevel {
  const refCountLevel: CompressionLevel =
    refCount >= EMERGENCY_THRESHOLD_REFS
      ? "emergency"
      : refCount >= AGGRESSIVE_THRESHOLD_REFS
        ? "aggressive"
        : "normal";

  const levelRank: Record<CompressionLevel, number> = {
    normal: 0,
    aggressive: 1,
    emergency: 2,
  };

  const quotaFloor: CompressionLevel =
    quotaMode === "deferred"
      ? "emergency"
      : quotaMode === "aggressive"
        ? "aggressive"
        : "normal";

  return levelRank[quotaFloor] > levelRank[refCountLevel]
    ? quotaFloor
    : refCountLevel;
}

export function shouldTriggerSummarization(refCount: number): boolean {
  return refCount > 0 && refCount % SUMMARIZATION_TRIGGER_EVERY_N_TURNS === 0;
}

type AttemptResult =
  | { outcome: "valid"; summary: string; entities: string[]; actionItems: string[] }
  | { outcome: "invalid"; invalidReason?: string }
  | { outcome: "threw"; error: unknown };

/**
 * Sub-step H.2 addition: runs exactly one compiled-graph invocation and
 * normalizes its outcome into one of three tagged states so the caller
 * can apply the TZ's two DIFFERENT fallback behaviors correctly instead
 * of collapsing "threw" and "returned invalid" into the same branch (the
 * bug this sub-step fixes).
 */
async function runSummarizationAttempt(
  rawHistoryRefs: string[]
): Promise<AttemptResult> {
  try {
    const compiledGraph = buildGraph();
    const result = await compiledGraph.invoke({ rawHistoryRefs });

    if (!result.valid) {
      return { outcome: "invalid", invalidReason: result.invalidReason };
    }

    return {
      outcome: "valid",
      summary: result.summary,
      entities: result.entities,
      actionItems: result.actionItems,
    };
  } catch (error) {
    return { outcome: "threw", error };
  }
}

export async function summarizeAndUpdateMemory(
  chatId: string,
  traceId: string
): Promise<{ updated: boolean; usedFallback: boolean }> {
  const docRef = contextCollection().doc(chatId);

  try {
    const snap = await docRef.get();
    if (!snap.exists) {
      withLogContext({
        trace_id: traceId,
        chat_id: chatId,
        operation_type: "summarize_memory",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn("summarizeAndUpdateMemory called for nonexistent chat_id");
      return { updated: false, usedFallback: false };
    }

    const existing = snap.data() as ChatContextDocument;
    const rawHistoryRefs = existing.memory_blob.raw_history_refs;

    const firstAttempt = await runSummarizationAttempt(rawHistoryRefs);

    let finalSummary: string;
    let finalEntities: string[];
    let finalActionItems: string[];
    let usedFallback = false;

    if (firstAttempt.outcome === "valid") {
      finalSummary = firstAttempt.summary;
      finalEntities = firstAttempt.entities;
      finalActionItems = firstAttempt.actionItems;
    } else if (firstAttempt.outcome === "threw") {
      // TZ 3.4 requirement (a): LangGraph THREW -> RAW_FALLBACK, not a
      // repair-pass (repair-pass is defined only for requirement (b),
      // "returned invalid structure"). Sub-step H.2 fix: previously this
      // branch silently returned without persisting anything.
      usedFallback = true;
      withLogContext({
        trace_id: traceId,
        chat_id: chatId,
        operation_type: "summarize_memory",
        result_status: "INTERNAL_ERROR",
        retry_count: 0,
      }).error(
        { err: firstAttempt.error },
        "LangGraph summarization threw an exception, writing RAW_FALLBACK per TZ 3.4(a)"
      );

      const rawFallback = buildRawFallbackOnException(rawHistoryRefs);
      finalSummary = rawFallback.summary;
      finalEntities = rawFallback.entities;
      finalActionItems = rawFallback.actionItems;
    } else {
      // TZ 3.4 requirement (b): LangGraph returned an INVALID structure
      // -> exactly one repair-pass attempt before deterministic fallback.
      withLogContext({
        trace_id: traceId,
        chat_id: chatId,
        operation_type: "summarize_memory",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn(
        { reason: firstAttempt.invalidReason },
        "LangGraph summarization returned invalid structure, attempting one repair-pass per TZ 3.4(b)"
      );

      const repairAttempt = await runSummarizationAttempt(rawHistoryRefs);

      if (repairAttempt.outcome === "valid") {
        withLogContext({
          trace_id: traceId,
          chat_id: chatId,
          operation_type: "summarize_memory",
          result_status: "ACCEPTED",
          retry_count: 1,
        }).info("repair-pass succeeded, using repaired summarization output");

        finalSummary = repairAttempt.summary;
        finalEntities = repairAttempt.entities;
        finalActionItems = repairAttempt.actionItems;
      } else {
        // Repair-pass also failed (invalid again OR threw) -> deterministic
        // fallback serializer, exactly as TZ 3.4(b) specifies.
        usedFallback = true;
        withLogContext({
          trace_id: traceId,
          chat_id: chatId,
          operation_type: "summarize_memory",
          result_status: "VALIDATION_FAILED",
          retry_count: 1,
        }).warn(
          {
            reason:
              repairAttempt.outcome === "invalid"
                ? repairAttempt.invalidReason
                : "repair_pass_threw",
          },
          "repair-pass also failed, using deterministic RAW_FALLBACK serializer per TZ 3.4(b)"
        );

        const fallback = buildDeterministicFallback(rawHistoryRefs);
        finalSummary = fallback.summary;
        finalEntities = fallback.entities;
        finalActionItems = fallback.actionItems;
      }
    }

    const updatedMemoryBlob: MemoryBlob = {
      ...existing.memory_blob,
      summary: finalSummary,
      entities: finalEntities,
      action_items: finalActionItems,
      compression_level: pickCompressionLevel(
        rawHistoryRefs.length,
        getQuotaGovernor().getQuotaMode()
      ),
    };

    await docRef.set({ memory_blob: updatedMemoryBlob }, { merge: true });

    withLogContext({
      trace_id: traceId,
      chat_id: chatId,
      operation_type: "summarize_memory",
      result_status: "ACCEPTED",
      retry_count: 0,
    }).info(
      { used_fallback: usedFallback, ref_count: rawHistoryRefs.length },
      "memory_blob updated by summarization pipeline"
    );

    return { updated: true, usedFallback };
  } catch (err) {
    withLogContext({
      trace_id: traceId,
      chat_id: chatId,
      operation_type: "summarize_memory",
      result_status: "INTERNAL_ERROR",
      retry_count: 0,
    }).error({ err }, "summarizeAndUpdateMemory failed unexpectedly");
    return { updated: false, usedFallback: false };
  }
}