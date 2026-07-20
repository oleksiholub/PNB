/**
 * Memory summarization service via LangGraph.js (Sub-step E.1, RAW_FALLBACK
 * added in H.2).
 *
 * Sub-step H.0 FIX: this file previously contained literal, unescaped
 * newline characters embedded inside the ACTION_VERB_RE regex literal and
 * inside two `.join(" \n ")` string-literal call sites, discovered via
 * direct inspection of the user-provided ZIP archive (Established
 * confidence - verified by reading the actual bytes, not inferred). A
 * literal newline inside an unterminated single-line string/regex literal
 * is invalid JavaScript/TypeScript syntax and would make `tsc` fail to
 * compile this file with "Unterminated string literal" / "Unterminated
 * regular expression literal" errors, blocking the entire backend build.
 * Fixed by replacing the literal newlines with the escaped sequence \n,
 * which is both syntactically valid and semantically equivalent to the
 * original intent (joining history refs with a newline separator).
 */
import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { contextCollection } from "../models/collections";
import { MemoryBlob, CompressionLevel, ChatContextDocument } from "../models/types";
import { withLogContext } from "../logger";

export const SUMMARIZATION_TRIGGER_EVERY_N_TURNS = 5;

const MAX_SUMMARY_CHARS = 4000;
const AGGRESSIVE_THRESHOLD_REFS = 30;
const EMERGENCY_THRESHOLD_REFS = 60;

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
  /\b(need to|should|must|нужно|следует|необходимо|todo|fixme)\b[^.!?\n]{0,120}/gi;

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

function pickCompressionLevel(refCount: number): CompressionLevel {
  if (refCount >= EMERGENCY_THRESHOLD_REFS) return "emergency";
  if (refCount >= AGGRESSIVE_THRESHOLD_REFS) return "aggressive";
  return "normal";
}

export function shouldTriggerSummarization(refCount: number): boolean {
  return refCount > 0 && refCount % SUMMARIZATION_TRIGGER_EVERY_N_TURNS === 0;
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

    const compiledGraph = buildGraph();
    const result = await compiledGraph.invoke({ rawHistoryRefs });

    let finalSummary = result.summary;
    let finalEntities = result.entities;
    let finalActionItems = result.actionItems;
    const usedFallback = !result.valid;

    if (usedFallback) {
      withLogContext({
        trace_id: traceId,
        chat_id: chatId,
        operation_type: "summarize_memory",
        result_status: "VALIDATION_FAILED",
        retry_count: 0,
      }).warn(
        { reason: result.invalidReason },
        "LangGraph summarization output failed validation, using deterministic RAW_FALLBACK serializer"
      );

      const fallback = buildDeterministicFallback(rawHistoryRefs);
      finalSummary = fallback.summary;
      finalEntities = fallback.entities;
      finalActionItems = fallback.actionItems;
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