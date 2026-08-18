export { analyzeTrace } from "./analyzer.js";
export {
  basicProfile,
  heuristicProfile,
  codingProfile,
  ragProfile,
  browserProfile,
  profiles,
  profileFor,
  getProfile,
  defineProfile,
  describeProfile,
  contextCategories,
  baselineSegmentClass
} from "./profile.js";
export type { ProfileName } from "./profile.js";
export { estimateTokens } from "./tokenizer.js";
export { fingerprint } from "./hash.js";
export { findNearDuplicateMatches, normalizedText, textShingles, jaccard } from "./similarity.js";
export { getContextHogs } from "./policy.js";
export { buildOptimizationPlan } from "./optimizer.js";
export { evaluateBudget } from "./budget.js";
export { estimateEvictablePAU, pigYield } from "./eviction.js";
export {
  gradeForSegment,
  weakestGrade,
  describeGrade,
  reconcileTokens,
  gradeDistribution
} from "./accounting.js";
export { computeInteractionIndex } from "./interaction.js";
export {
  buildGovernanceLedger,
  isTransformationAllowed,
  governanceFor
} from "./governance.js";
export { validatePAUTrace } from "./validate.js";
export { renderReceiptMarkdown } from "./report.js";
export {
  defaultUncertaintyModel,
  segmentInterval,
  segmentSigma,
  totalInterval
} from "./uncertainty.js";
export {
  formatCompact,
  formatCount,
  formatInterval,
  formatPercent,
  formatSigned,
  markdownTable
} from "./format.js";
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
export type { ReportOptions } from "./report.js";
export type { SegmentUncertaintyInput } from "./uncertainty.js";
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
  AuthorityClass,
  ContextSegmentInput,
  DisclosureTier,
  EffectScope,
  DuplicateMethod,
  EvictionEstimate,
  EvictionMethod,
  GovernanceLedger,
  GovernanceRecord,
  InteractionIndex,
  HogSeverity,
  MetricDelta,
  NamedMetricDelta,
  NearDuplicateOptions,
  NormalizeTraceOptions,
  OptimizationAction,
  OptimizationActionType,
  OptimizationPlan,
  OptimizationPolicyName,
  PAUInterval,
  PAUProfile,
  PAUTrace,
  ProfileManifest,
  ProfileSpec,
  ProfileStatus,
  ReceiptComparison,
  ReplayCountMethod,
  ScoreConfidence,
  SensitivityClass,
  SourceSummary,
  TokenAccountingGrade,
  TokenReconciliation,
  TransformationName,
  TokenCounter,
  TokenCountMethod,
  TraceFormat,
  TraceSeriesAnalysis,
  TraceSeriesPoint,
  UncertaintyModel,
  UtilityMethod,
  ValidationIssue,
  ValidationResult
} from "./types.js";
