import { clamp, round, safeRatio } from "./math.js";
import type { AnalyzedSegment, InteractionIndex } from "./types.js";

/**
 * Context Interaction/Interference Index (CII).
 *
 * Segment PAU is additive by construction, but the evidence says contextual burden is not.
 * Input length alone degrades performance even when retrieval is controlled, and the spacing
 * between pieces of evidence that must be combined introduces its own bias. Neither effect
 * belongs in a per-segment multiplier, because neither is a property of any single segment.
 *
 * CII is therefore a companion signal, not a term in the PAU sum. It is deliberately
 * DIMENSIONLESS: there is no defensible conversion from "this spacing pattern" to "N extra
 * token-equivalents", so the index reports interaction pressure on a 0-1 scale and leaves the
 * PAU ledger untouched.
 *
 * Every component is reported so a reader can see which pressure drove the score.
 */
export function computeInteractionIndex(
  segments: AnalyzedSegment[],
  rawUtilization: number | null,
  duplicateTokenRatio: number
): InteractionIndex {
  const occupancy = rawUtilization === null ? 0 : clamp(rawUtilization);
  const fragmentation = computeFragmentation(segments);
  const evidenceSpread = computeEvidenceSpread(segments);
  const instructionConflict = computeInstructionConflict(segments);
  const redundancyInterference = clamp(duplicateTokenRatio);

  // Occupancy carries the most weight because length-driven degradation is the best evidenced
  // of these effects; conflict carries the least because it is the coarsest proxy.
  const index = clamp(
    0.34 * occupancy
    + 0.18 * fragmentation
    + 0.22 * evidenceSpread
    + 0.12 * instructionConflict
    + 0.14 * redundancyInterference
  );

  return {
    index: round(index),
    dimensionless: true,
    components: {
      occupancy: round(occupancy),
      fragmentation: round(fragmentation),
      evidenceSpread: round(evidenceSpread),
      instructionConflict: round(instructionConflict),
      redundancyInterference: round(redundancyInterference)
    },
    interpretation: interpret(index),
    statement:
      "CII estimates nonlocal interaction pressure and is not convertible to token-equivalents. "
      + "It is reported alongside PAU, never added to it."
  };
}

/**
 * Many small segments cost more attention to reconcile than the same tokens in a few coherent
 * blocks. Normalized against 40 segments, beyond which additional fragmentation adds little
 * discriminating signal.
 */
function computeFragmentation(segments: AnalyzedSegment[]): number {
  if (segments.length <= 1) return 0;
  const countPressure = clamp(segments.length / 40);
  const median = medianTokens(segments);
  // A long tail of fragments below a fifth of the median indicates scattered context.
  const scattered = segments.filter((segment) => segment.tokens < median * 0.2).length;
  return clamp(0.6 * countPressure + 0.4 * safeRatio(scattered, segments.length));
}

/**
 * Distance between the pieces of evidence a task must combine.
 *
 * Approximated from prompt order: the positions of high-value segments are compared against a
 * perfectly clustered arrangement. Widely separated evidence scores higher.
 */
function computeEvidenceSpread(segments: AnalyzedSegment[]): number {
  const relevant: number[] = [];
  segments.forEach((segment, index) => {
    const value = segment.utilityEstimate ?? segment.adjustments.relevance;
    if (value >= 0.6) relevant.push(index);
  });

  if (relevant.length < 2 || segments.length < 3) return 0;

  const span = (relevant[relevant.length - 1] ?? 0) - (relevant[0] ?? 0);
  const clustered = relevant.length - 1;
  const maximumSpan = segments.length - 1;
  // 0 when the relevant segments are adjacent, 1 when they sit at opposite ends.
  return clamp(safeRatio(span - clustered, Math.max(1, maximumSpan - clustered)));
}

/**
 * Competing instruction sources. Multiple independent high-authority sources raise the chance
 * of conflicting directives, which the model must resolve before doing the task.
 */
function computeInstructionConflict(segments: AnalyzedSegment[]): number {
  const instructionSources = new Set<string>();
  for (const segment of segments) {
    if (segment.type !== "system" && segment.type !== "developer") continue;
    instructionSources.add(segment.source ?? segment.type);
  }
  if (instructionSources.size <= 1) return 0;
  return clamp((instructionSources.size - 1) / 4);
}

function medianTokens(segments: AnalyzedSegment[]): number {
  const sorted = segments.map((segment) => segment.tokens).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function interpret(index: number): string {
  if (index >= 0.7) {
    return "High interaction pressure: length, fragmentation, or evidence spacing are likely to "
      + "degrade use of the context beyond what segment PAU alone suggests.";
  }
  if (index >= 0.45) {
    return "Moderate interaction pressure: consider consolidating evidence and reducing occupancy.";
  }
  return "Low interaction pressure: segment-level accounting is likely to describe this context well.";
}
