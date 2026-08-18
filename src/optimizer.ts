import { clamp, round, safeRatio } from "./math.js";
import type {
  AnalyzedSegment,
  ContextReceipt,
  OptimizationAction,
  OptimizationActionType,
  OptimizationPlan,
  OptimizationPolicyName,
  ScoreConfidence
} from "./types.js";

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
  const actions = receipt.segments
    .map((segment) => chooseAction(segment, config))
    .filter((action): action is OptimizationAction => action !== null)
    .sort((a, b) => {
      const savingsA = a.currentTokenSavings + 0.25 * a.futureReplayTokenSavings;
      const savingsB = b.currentTokenSavings + 0.25 * b.futureReplayTokenSavings;
      return savingsB - savingsA;
    });

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

function chooseAction(segment: AnalyzedSegment, config: PolicyConfig): OptimizationAction | null {
  if (segment.protected) return null;
  if (!config.allowLowConfidence && segment.scoreConfidence === "low") return null;

  const candidates: OptimizationAction[] = [];

  if (segment.duplicateRatio >= config.duplicateThreshold) {
    const currentFraction = Math.min(config.maxCurrentReduction, segment.duplicateRatio * 0.92);
    candidates.push(makeAction(
      segment,
      "deduplicate",
      `Remove repeated material or replace it with a stable reference; ${percent(segment.duplicateRatio)} of the segment is duplicated.`,
      currentFraction,
      currentFraction
    ));
  }

  if (segment.replayCount >= config.replayThreshold) {
    const replayFraction = clamp(0.58 + 0.08 * Math.min(segment.replayCount, 4), 0, 0.9);
    candidates.push(makeAction(
      segment,
      "cache-reference",
      `The segment is replayed ${segment.replayCount} time(s); cache it and inject a compact reference or delta.`,
      0,
      replayFraction
    ));
  }

  if (segment.effectiveHogScore >= config.minScore) {
    if (["tool", "workspace", "rag", "browser", "data", "code"].includes(segment.type)) {
      const lowUtilityBoost = segment.utilityEstimate === null ? 0 : (1 - segment.utilityEstimate) * 0.2;
      const currentFraction = Math.min(
        config.maxCurrentReduction,
        config.selectiveReduction + lowUtilityBoost
      );
      candidates.push(makeAction(
        segment,
        "selective-retrieval",
        "Replace the full payload with targeted excerpts, symbols, fields, or retrieval-on-demand.",
        currentFraction,
        currentFraction
      ));
    }

    if (segment.type === "history") {
      candidates.push(makeAction(
        segment,
        "summarize-history",
        "Collapse older dialogue into a decision-and-state summary while preserving the current request.",
        Math.min(config.maxCurrentReduction, config.historyReduction),
        Math.min(config.maxCurrentReduction, config.historyReduction)
      ));
    }
  }

  if (
    (segment.ageTurns ?? 0) >= config.staleAge
    && (segment.utilityEstimate ?? segment.adjustments.relevance) < 0.5
  ) {
    const staleFraction = Math.min(config.maxCurrentReduction, 0.65 + 0.03 * Math.min(segment.ageTurns ?? 0, 6));
    candidates.push(makeAction(
      segment,
      "prune-stale",
      `The segment is ${segment.ageTurns} turn(s) old and has limited estimated value; require re-retrieval if needed.`,
      staleFraction,
      staleFraction
    ));
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => actionValue(b) - actionValue(a))[0] ?? null;
}

function makeAction(
  segment: AnalyzedSegment,
  action: OptimizationActionType,
  reason: string,
  currentReductionFraction: number,
  replayReductionFraction: number
): OptimizationAction {
  const currentTokenSavings = Math.round(segment.tokens * clamp(currentReductionFraction));
  const futureReplayTokenSavings = Math.round(segment.replayTokens * clamp(replayReductionFraction));
  const result: OptimizationAction = {
    segmentId: segment.id,
    segmentType: segment.type,
    action,
    score: segment.effectiveHogScore,
    confidence: actionConfidence(segment),
    reason,
    currentTokenSavings,
    futureReplayTokenSavings,
    currentPAUSavings: round(currentTokenSavings * segment.pigDensity, 2),
    protected: false
  };
  if (segment.source !== undefined) result.source = segment.source;
  return result;
}

function actionValue(action: OptimizationAction): number {
  return action.currentTokenSavings + 0.25 * action.futureReplayTokenSavings;
}

function actionConfidence(segment: AnalyzedSegment): ScoreConfidence {
  if (segment.duplicateMethod === "exact" || segment.utilityMethod === "provided") return "high";
  return segment.scoreConfidence;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
