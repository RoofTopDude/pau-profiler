export { analyzeTrace } from "./analyzer.js";
export {
  basicProfile,
  heuristicProfile,
  codingProfile,
  ragProfile,
  browserProfile,
  profiles,
  profileFor,
  getProfile
} from "./profile.js";
export type { ProfileName } from "./profile.js";
export { estimateTokens } from "./tokenizer.js";
export { fingerprint } from "./hash.js";
export { findNearDuplicateMatches, normalizedText, textShingles, jaccard } from "./similarity.js";
export { getContextHogs } from "./policy.js";
export { buildOptimizationPlan } from "./optimizer.js";
export { evaluateBudget } from "./budget.js";
export { compareReceipts } from "./compare.js";
export { analyzeTraceSeries } from "./series.js";
export {
  detectTraceFormat,
  normalizeTrace,
  openAIToTrace,
  anthropicToTrace
} from "./adapters.js";
export { toTelemetryAttributes, toSegmentTelemetryAttributes } from "./telemetry.js";
export type { HogFilterOptions } from "./policy.js";
export type { TelemetryAttributes } from "./telemetry.js";
export type {
  AdjustmentBreakdown,
  AnalysisMode,
  AnalyzeOptions,
  AnalyzedSegment,
  BudgetResult,
  BudgetThresholds,
  BudgetViolation,
  CategorySummary,
  ContextCategory,
  ContextReceipt,
  ContextSegmentInput,
  DuplicateMethod,
  HogSeverity,
  MetricDelta,
  NamedMetricDelta,
  NearDuplicateOptions,
  NormalizeTraceOptions,
  OptimizationAction,
  OptimizationActionType,
  OptimizationPlan,
  OptimizationPolicyName,
  PAUProfile,
  PAUTrace,
  ReceiptComparison,
  ReplayCountMethod,
  ScoreConfidence,
  SourceSummary,
  TokenCounter,
  TokenCountMethod,
  TraceFormat,
  TraceSeriesAnalysis,
  TraceSeriesPoint,
  UtilityMethod
} from "./types.js";
