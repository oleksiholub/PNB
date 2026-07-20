/**
 * Memory summarization service via LangGraph.js (Sub-step E.1;
 * Sub-step H.0 fixed a syntax bug; Sub-step H.2 implements the full
 * TZ 3.4 error-handling contract for this pipeline).
 *
 * TZ SECTION 3.4 REQUIREMENTS THIS FILE MUST SATISFY:
 *   (a) LangGraph THREW an exception -> RAW_FALLBACK written directly
 *       to memory_blob with a safe truncated raw fragment.
 *   (b) LangGraph RETURNED an invalid structure -> exactly ONE
 *       repair-pass attempt before falling back to the deterministic
 *       serializer.
 *
 * GAP FOUND (Established confidence): the H.0 version collapsed both
 * cases into one branch - a thrown exception was caught by the outer
 * try/catch and returned without ever writing to memory_blob at all,
 * meaning requirement (a) was not implemented. Fixed below.
 */
import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { contextCollection } from "../models/collections";
import { MemoryBlob, CompressionLevel, ChatContextDocument } from "../models/types";
import { withLogContext } from "../logger";

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
const ACTION_VERB_RE =
  /\b(need to|should|must|нужно|следует|необходимо|todo|fixme)\b[^.!?
]{0,120}/gi;

function extractEntitiesNode(state: GraphState): Partial<GraphState> {
  const joined = state.rawHistoryRefs.join("
");
  const matches = joined.match(CAPITALIZED_WORD_RE) ?? [];
  const unique = Array.from(new Set(matches)).slice(0, 25);
  return { entities: unique };
}

function extractActionItemsNode(state: GraphState): Partial<GraphState> {
  const joined = state.rawHistoryRefs.join("
");
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

function pickCompressionLevel(refCount: number): CompressionLevel {
  if (refCount >= EMERGENCY_THRESHOLD_REFS) return "emergency";
  if (refCount >= AGGRESSIVE_THRESHOLD_REFS) return "aggressive";
  return "normal";
}

export function shouldTriggerSummarization(refCount: number): boolean {
  return refCount > 0 && refCount % SUMMARIZATION_TRIGGER_EVERY_N_TURNS === 0;
}

type AttemptResult =
  | { outcome: "valid"; summary: string; entities: string[]; actionItems: string[] }
  | { outcome: "invalid"; invalidReason?: string }
  | { outcome: "threw"; error: unknown };

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
      compression_level: pickCompressionLevel(rawHistoryRefs.length),
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