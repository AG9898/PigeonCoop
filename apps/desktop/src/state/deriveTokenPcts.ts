// Derive per-agent-node context/token usage percentages from an event
// sequence up to a given index. Shared by the RunPanel graph overlay
// (live tail and replay scrub positions use the same derivation).

import type { RunEvent } from "../types/workflow";

export type TokenPctByNode = Map<string, number>;

/**
 * Scan events[0..upToIndex] (inclusive) and return the most recent token
 * usage percentage for every agent node that reported usage. Pass
 * `events.length - 1` to derive from the full log (live tail).
 */
export function deriveTokenPcts(
  events: RunEvent[],
  upToIndex: number
): TokenPctByNode {
  const tokenPcts: TokenPctByNode = new Map();
  const end = Math.min(upToIndex, events.length - 1);
  for (let i = 0; i <= end; i += 1) {
    const event = events[i];
    if (!event?.node_id) continue;
    if (
      event.event_type !== "agent.completed" &&
      event.event_type !== "agent.response"
    ) {
      continue;
    }

    const pct = tokenPctFromPayload(event.payload);
    if (pct !== null) {
      tokenPcts.set(event.node_id, pct);
    }
  }
  return tokenPcts;
}

function tokenPctFromPayload(payload: unknown): number | null {
  const record = asRecord(payload);
  if (!record) return null;

  const usage = asRecord(record.usage);
  const tokensUsed =
    readNumber(record.tokens_used) ??
    readNumber(record.tokensUsed) ??
    readNumber(usage?.tokens_used) ??
    readNumber(usage?.tokensUsed);
  const contextLimit =
    readNumber(record.context_limit) ??
    readNumber(record.contextLimit) ??
    readNumber(usage?.context_limit) ??
    readNumber(usage?.contextLimit);
  const inputTokens =
    readNumber(record.input_tokens) ??
    readNumber(record.inputTokens) ??
    readNumber(usage?.input_tokens) ??
    readNumber(usage?.inputTokens);
  const outputTokens =
    readNumber(record.output_tokens) ??
    readNumber(record.outputTokens) ??
    readNumber(usage?.output_tokens) ??
    readNumber(usage?.outputTokens);
  const derivedUsed =
    inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null;
  const used = tokensUsed ?? derivedUsed;

  if (used === null || contextLimit === null || contextLimit <= 0) return null;
  return Math.min(100, Math.max(0, (used / contextLimit) * 100));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}
