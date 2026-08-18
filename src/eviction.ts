import { clamp, round, safeRatio } from "./math.js";
import type {
  AnalyzedSegment,
  ContextReceipt,
  EvictionEstimate,
  EvictionMethod,
  ScoreConfidence
} from "./types.js";

interface Candidate {
  segment: AnalyzedSegment;
  /** Estimated share of total task value this segment carries, in [0,1]. */
  valueShare: number;
}

/**
 * Estimates PAU §5.5 evictable load: the largest weighted load that could be removed while
 * estimated quality stays within `tolerance` of the current run.
 *
 * This is an ESTIMATE derived from the receipt's own utility model, not a measured ablation.
 * The paper defines EvictablePAU through counterfactual evaluation; reproducing that requires
 * re-running the task with segments removed. The value here ranks candidates by value density
 * and spends the tolerance budget on the worst ones, which is the greedy solution to the
 * fractional relaxation of that knapsack. Treat it as a planning number and confirm with
 * controlled replay before enforcing it.
 */
export function estimateEvictablePAU(receipt: ContextReceipt, tolerance = 0.05): EvictionEstimate {
  const budget = clamp(tolerance, 0, 1);
  const method = resolveMethod(receipt.segments);
  const candidates = buildCandidates(receipt.segments, method);

  // Worst value per unit of load first: that spends the least estimated quality per PAU freed.
  const ordered = [...candidates].sort((a, b) => valueDensity(a) - valueDensity(b));

  const segmentIds: string[] = [];
  let evictablePAU = 0;
  let evictableTokens = 0;
  let qualityLoss = 0;

  for (const candidate of ordered) {
    if (qualityLoss + candidate.valueShare > budget) continue;
    qualityLoss += candidate.valueShare;
    evictablePAU += candidate.segment.pau;
    evictableTokens += candidate.segment.tokens;
    segmentIds.push(candidate.segment.id);
  }

  const evictableShare = safeRatio(evictablePAU, receipt.totalPAU);

  return {
    tolerance: round(budget),
    method,
    evictablePAU: round(evictablePAU, 2),
    evictableTokens,
    evictableShare: round(evictableShare),
    pigEfficiency: round(1 - evictableShare),
    estimatedQualityLoss: round(qualityLoss),
    segmentIds,
    protectedPAUExcluded: round(
      receipt.segments
        .filter((segment) => segment.protected)
        .reduce((total, segment) => total + segment.pau, 0),
      2
    ),
    confidence: confidenceFor(method, receipt.segments)
  };
}

/**
 * PAU §5.5 Pig Yield: task outcome per 1,000 units of cumulative run load. Only comparable
 * when the evaluator and task distribution are held constant, so the quality score must come
 * from the caller rather than from the receipt.
 */
export function pigYield(runPAU: number, qualityScore: number): number | null {
  if (runPAU <= 0) return null;
  return round(qualityScore / (runPAU / 1000), 4);
}

function buildCandidates(segments: AnalyzedSegment[], method: EvictionMethod): Candidate[] {
  const evictable = segments.filter((segment) => !segment.protected);

  if (method === "structural") {
    // With no utility signal at all, the only defensible ordering is inverse structural
    // pressure: segments under the most size/duplication/replay pressure are the ones a
    // harness should question first. Quality loss is approximated from the same signal.
    const weights = evictable.map((segment) => 1 - clamp(segment.structuralPressureScore / 10));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    return evictable.map((segment, index) => ({
      segment,
      valueShare: totalWeight === 0 ? 0 : (weights[index] ?? 0) / totalWeight
    }));
  }

  const totalUtilityMass = segments.reduce(
    (sum, segment) => sum + segment.pau * (segment.utilityEstimate ?? 0),
    0
  );
  return evictable.map((segment) => ({
    segment,
    valueShare: totalUtilityMass === 0
      ? 0
      : (segment.pau * (segment.utilityEstimate ?? 0)) / totalUtilityMass
  }));
}

function valueDensity(candidate: Candidate): number {
  return safeRatio(candidate.valueShare, candidate.segment.pau);
}

function resolveMethod(segments: AnalyzedSegment[]): EvictionMethod {
  const scored = segments.filter((segment) => segment.utilityEstimate !== null);
  if (scored.length === 0) return "structural";
  return scored.every((segment) => segment.utilityMethod === "provided")
    ? "provided-utility"
    : "heuristic-utility";
}

function confidenceFor(method: EvictionMethod, segments: AnalyzedSegment[]): ScoreConfidence {
  if (method === "structural") return "low";
  const lowConfidence = segments.filter((segment) => segment.scoreConfidence === "low").length;
  if (method === "provided-utility" && lowConfidence === 0) return "high";
  return lowConfidence > segments.length / 2 ? "low" : "medium";
}
