import type { AnalyzedSegment, ContextReceipt } from "./types.js";

export interface HogFilterOptions {
  minScore?: number;
  includeProtected?: boolean;
}

export function getContextHogs(
  receipt: ContextReceipt,
  options: HogFilterOptions = {}
): AnalyzedSegment[] {
  const minScore = options.minScore ?? 4;
  const includeProtected = options.includeProtected ?? false;

  return receipt.segments
    .filter((segment) => includeProtected || !segment.protected)
    .filter((segment) => scoreOf(segment) >= minScore)
    .sort((a, b) => scoreOf(b) - scoreOf(a));
}

function scoreOf(segment: AnalyzedSegment): number {
  return segment.contextHogIndex ?? segment.structuralPressureScore;
}
