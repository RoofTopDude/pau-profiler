import { isTransformationAllowed } from "./governance.js";
import { clamp, round, safeRatio } from "./math.js";
import type {
  AnalyzedSegment,
  ContextReceipt,
  GovernanceLedger,
  OptimizationAction,
  OptimizationActionType,
  OptimizationPlan,
  OptimizationPolicyName,
  ScoreConfidence,
  TransformationName
} from "./types.js";

/** The governance transformation each optimization action actually performs. */
const transformationFor: Record<OptimizationActionType, TransformationName> = {
  deduplicate: "compress",
  "cache-reference": "retrieve-on-demand",
  "selective-retrieval": "retrieve-on-demand",
  "summarize-history": "summarize",
  "prune-stale": "evict",
  retain: "retain"
};

const confidenceWeight: Record<ScoreConfidence, number> = { low: 0.45, medium: 0.75, high: 1 };

interface PolicyConfig {
  minScore: number;
  duplicateThreshold: number;
  replayThreshold: number;
  maxCurrentReduction: number;
  historyReduction: number;
  selectiveReduction: number;
  staleAge: number;
  allowLowConfidence: boolean;
}

const policies: Record<OptimizationPolicyName, PolicyConfig> = {
  conservative: {
    minScore: 6,
    duplicateThreshold: 0.5,
    replayThreshold: 2,
    maxCurrentReduction: 0.45,
    historyReduction: 0.35,
    selectiveReduction: 0.4,
    staleAge: 8,
    allowLowConfidence: false
  },
  balanced: {
    minScore: 4,
    duplicateThreshold: 0.3,
    replayThreshold: 1,
    maxCurrentReduction: 0.65,
    historyReduction: 0.55,
    selectiveReduction: 0.58,
    staleAge: 5,
    allowLowConfidence: true
  },
  aggressive: {
    minScore: 2,
    duplicateThreshold: 0.15,
    replayThreshold: 1,
    maxCurrentReduction: 0.82,
    historyReduction: 0.72,
    selectiveReduction: 0.75,
    staleAge: 3,
    allowLowConfidence: true
  }
};

export function buildOptimizationPlan(
  receipt: ContextReceipt,
  policy: OptimizationPolicyName = "balanced"
): OptimizationPlan {
  const config = policies[policy];
  const governance = receipt.governance;
  const actions = receipt.segments
    .map((segment) => chooseAction(segment, config, governance, receipt.eviction.tolerance))
    .filter((action): action is OptimizationAction => action !== null)
    .sort((a, b) => b.removableLoadValue - a.removableLoadValue);

  const totalCurrentTokenSavings = Math.min(
    receipt.totalTokens,
    Math.round(actions.reduce((total, action) => total + action.currentTokenSavings, 0))
  );
  const totalFutureReplayTokenSavings = Math.min(
    receipt.replayTokens,
    Math.round(actions.reduce((total, action) => total + action.futureReplayTokenSavings, 0))
  );
  const totalCurrentPAUSavings = Math.min(
    receipt.totalPAU,
    round(actions.reduce((total, action) => total + action.currentPAUSavings, 0), 2)
  );
  const projectedTotalTokens = Math.max(0, receipt.totalTokens - totalCurrentTokenSavings);
  const projectedTotalPAU = round(Math.max(0, receipt.totalPAU - totalCurrentPAUSavings), 2);

  return {
    policy,
    generatedFromProfile: receipt.profile,
    governanceLockedSegments: governance.lockedSegmentIds,
    actions,
    totalCurrentTokenSavings,
    totalFutureReplayTokenSavings,
    totalCurrentPAUSavings,
    projectedTotalTokens,
    projectedTotalPAU,
    projectedRawUtilization: receipt.contextWindow === undefined
      ? null
      : round(safeRatio(projectedTotalTokens, receipt.contextWindow)),
    projectedPAUUtilization: receipt.contextWindow === undefined
      ? null
      : round(safeRatio(projectedTotalPAU, receipt.contextWindow))
  };
}

function chooseAction(
  segment: AnalyzedSegment,
  config: PolicyConfig,
  governance: GovernanceLedger,
  tolerance: number
): OptimizationAction | null {
  if (segment.protected) return null;
  if (!config.allowLowConfidence && segment.scoreConfidence === "low") return null;

  const candidates: OptimizationAction[] = [];
  const make = (
    action: OptimizationActionType,
    reason: string,
    currentFraction: number,
    replayFraction: number
  ): void => {
    // Governance is consulted before the score is used, not after. A segment whose
    // transformation is forbidden never becomes a candidate at any score.
    if (!isTransformationAllowed(governance, segment.id, transformationFor[action])) return;
    candidates.push(makeAction(segment, action, reason, currentFraction, replayFraction, tolerance));
  };

  if (segment.duplicateRatio >= config.duplicateThreshold) {
    const currentFraction = Math.min(config.maxCurrentReduction, segment.duplicateRatio * 0.92);
    make(
      "deduplicate",
      `Remove repeated material or replace it with a stable reference; ${percent(segment.duplicateRatio)} of the segment is duplicated.`,
      currentFraction,
      currentFraction
    );
  }

  if (segment.replayCount >= config.replayThreshold) {
    const replayFraction = clamp(0.58 + 0.08 * Math.min(segment.replayCount, 4), 0, 0.9);
    make(
      "cache-reference",
      `The segment is replayed ${segment.replayCount} time(s); cache it and inject a compact reference or delta.`,
      0,
      replayFraction
    );
  }

  if (segment.effectiveHogScore >= config.minScore) {
    if (["tool", "workspace", "rag", "browser", "data", "code"].includes(segment.type)) {
      const lowUtilityBoost = segment.utilityEstimate === null ? 0 : (1 - segment.utilityEstimate) * 0.2;
      const currentFraction = Math.min(
        config.maxCurrentReduction,
        config.selectiveReduction + lowUtilityBoost
      );
      make(
        "selective-retrieval",
        "Replace the full payload with targeted excerpts, symbols, fields, or retrieval-on-demand.",
        currentFraction,
        currentFraction
      );
    }

    if (segment.type === "history") {
      make(
        "summarize-history",
        "Collapse older dialogue into a decision-and-state summary while preserving the current request.",
        Math.min(config.maxCurrentReduction, config.historyReduction),
        Math.min(config.maxCurrentReduction, config.historyReduction)
      );
    }
  }

  if (
    (segment.ageTurns ?? 0) >= config.staleAge
    && (segment.utilityEstimate ?? segment.adjustments.relevance) < 0.5
  ) {
    const staleFraction = Math.min(config.maxCurrentReduction, 0.65 + 0.03 * Math.min(segment.ageTurns ?? 0, 6));
    make(
      "prune-stale",
      `The segment is ${segment.ageTurns} turn(s) old and has limited estimated value; require re-retrieval if needed.`,
      staleFraction,
      staleFraction
    );
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.removableLoadValue - a.removableLoadValue)[0] ?? null;
}

function makeAction(
  segment: AnalyzedSegment,
  action: OptimizationActionType,
  reason: string,
  currentReductionFraction: number,
  replayReductionFraction: number,
  tolerance: number
): OptimizationAction {
  const currentTokenSavings = Math.round(segment.tokens * clamp(currentReductionFraction));
  const futureReplayTokenSavings = Math.round(segment.replayTokens * clamp(replayReductionFraction));
  const confidence = actionConfidence(segment);
  // Either fraction changes what the model sees: a cache-reference removes nothing from this
  // call but replaces the payload with a pointer on every later turn. Risk follows the larger.
  const qualityRiskProbability = qualitySafetyProbability(
    segment,
    Math.max(currentReductionFraction, replayReductionFraction),
    tolerance
  );
  const expectedSavings = currentTokenSavings + 0.25 * futureReplayTokenSavings;

  const result: OptimizationAction = {
    segmentId: segment.id,
    segmentType: segment.type,
    action,
    transformation: transformationFor[action],
    score: segment.effectiveHogScore,
    removableLoadValue: round(
      expectedSavings * qualityRiskProbability * confidenceWeight[confidence],
      2
    ),
    qualityRiskProbability: round(qualityRiskProbability),
    confidence,
    reason,
    currentTokenSavings,
    futureReplayTokenSavings,
    currentPAUSavings: round(currentTokenSavings * segment.pigDensity, 2),
    protected: false
  };
  if (segment.source !== undefined) result.source = segment.source;
  return result;
}

/**
 * Probability that removing this much of the segment keeps quality within tolerance.
 *
 * Estimated from the segment utility actually at risk. This is the term that keeps the ranking
 * stable where a hog ratio would not: utility sits in the numerator here, so a segment whose
 * utility estimate approaches zero produces a confident high value rather than an unbounded one.
 */
function qualitySafetyProbability(
  segment: AnalyzedSegment,
  reductionFraction: number,
  tolerance: number
): number {
  const utility = segment.utilityEstimate ?? 1 - clamp(segment.structuralPressureScore / 10);
  const valueAtRisk = utility * (segment.utilityShare ?? segment.pauShare) * clamp(reductionFraction);
  if (valueAtRisk <= 0) return 1;
  // A logistic falloff centered on the tolerance: comfortably inside it stays near 1, and the
  // value decays smoothly rather than switching off at an arbitrary threshold.
  const safeTolerance = Math.max(tolerance, 0.01);
  return clamp(1 / (1 + Math.exp(((valueAtRisk - safeTolerance) / safeTolerance) * 2.5)));
}

function actionConfidence(segment: AnalyzedSegment): ScoreConfidence {
  if (segment.duplicateMethod === "exact" || segment.utilityMethod === "provided") return "high";
  return segment.scoreConfidence;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
