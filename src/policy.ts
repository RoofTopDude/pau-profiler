import type { AnalyzedSegment, ContextReceipt } from "./types.js";

export interface HogFilterOptions {
  minScore?: number;
  includeProtected?: boolean;
  minConfidence?: "low" | "medium" | "high";
}

export function getContextHogs(
  receipt: ContextReceipt,
  options: HogFilterOptions = {}
): AnalyzedSegment[] {
  const minScore = options.minScore ?? 4;
  const includeProtected = options.includeProtected ?? false;
  const minConfidence = options.minConfidence ?? "low";
  const confidenceOrder = { low: 0, medium: 1, high: 2 } as const;

  return receipt.segments
    .filter((segment) => includeProtected || !segment.protected)
    .filter((segment) => segment.effectiveHogScore >= minScore)
    .filter((segment) => confidenceOrder[segment.scoreConfidence] >= confidenceOrder[minConfidence])
    .sort((a, b) => b.effectiveHogScore - a.effectiveHogScore);
}
