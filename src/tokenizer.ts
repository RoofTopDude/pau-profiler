import type { ContextSegmentInput, TokenCounter } from "./types.js";

/**
 * Deterministic fallback only. This is not a model tokenizer.
 * PAU consumers should provide exact token counts or a model-specific counter.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const codePoints = Array.from(text).length;
  const whitespaceSeparated = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
  return Math.max(1, Math.ceil(Math.max(codePoints / 4, whitespaceSeparated * 1.25)));
}

export function countTokens(
  segment: ContextSegmentInput,
  tokenCounter?: TokenCounter
): { tokens: number; method: "provided" | "custom" | "estimated" } {
  if (segment.tokens !== undefined) {
    assertNonNegativeFinite(segment.tokens, `${segment.id}.tokens`);
    return { tokens: Math.round(segment.tokens), method: "provided" };
  }

  if (segment.content === undefined) {
    throw new Error(`Segment ${segment.id} must provide either tokens or content.`);
  }

  if (tokenCounter) {
    const tokens = tokenCounter(segment.content, segment);
    assertNonNegativeFinite(tokens, `tokenCounter(${segment.id})`);
    return { tokens: Math.round(tokens), method: "custom" };
  }

  return { tokens: estimateTokens(segment.content), method: "estimated" };
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}
