import type { BudgetResult, BudgetThresholds, BudgetViolation, ContextReceipt } from "./types.js";

export function evaluateBudget(
  receipt: ContextReceipt,
  thresholds: BudgetThresholds
): BudgetResult {
  const violations: BudgetViolation[] = [];

  checkMax(violations, "maxTokens", receipt.totalTokens, thresholds.maxTokens, "Physical token budget exceeded.");
  checkMax(violations, "maxRawUtilization", receipt.rawUtilization, thresholds.maxRawUtilization, "Raw context utilization exceeded.");
  checkMax(violations, "maxPAUUtilization", receipt.pauUtilization, thresholds.maxPAUUtilization, "Pig-adjusted utilization exceeded.");
  checkMax(violations, "maxDuplicateTokenRatio", receipt.duplicateTokenRatio, thresholds.maxDuplicateTokenRatio, "Duplicate context ratio exceeded.");
  checkMax(violations, "maxReplayOverheadRatio", receipt.replayOverheadRatio, thresholds.maxReplayOverheadRatio, "Replay overhead exceeded.");
  checkMax(violations, "maxHogScore", receipt.maxHogScore, thresholds.maxHogScore, "Maximum Context Hog score exceeded.");
  checkMin(violations, "minContextHealthScore", receipt.contextHealthScore, thresholds.minContextHealthScore, "Context Health score is below the minimum.");
  checkMin(violations, "minPigEfficiency", receipt.pigEfficiency, thresholds.minPigEfficiency, "Pig Efficiency is below the minimum.");

  return { passed: violations.length === 0, violations };
}

function checkMax(
  violations: BudgetViolation[],
  metric: keyof BudgetThresholds,
  actual: number | null,
  threshold: number | undefined,
  message: string
): void {
  if (threshold === undefined || actual === null) return;
  if (actual > threshold) violations.push({ metric, actual, threshold, message });
}

function checkMin(
  violations: BudgetViolation[],
  metric: keyof BudgetThresholds,
  actual: number | null,
  threshold: number | undefined,
  message: string
): void {
  if (threshold === undefined || actual === null) return;
  if (actual < threshold) violations.push({ metric, actual, threshold, message });
}
