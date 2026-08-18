export type AnalysisMode = "basic" | "heuristic";

export type ContextCategory =
  | "system"
  | "developer"
  | "user"
  | "history"
  | "tool"
  | "workspace"
  | "rag"
  | "browser"
  | "memory"
  | "code"
  | "data"
  | "summary"
  | "other";

export type HogSeverity = "low" | "watch" | "medium" | "high" | "severe";
export type ScoreConfidence = "low" | "medium" | "high";
export type UtilityMethod = "none" | "provided" | "heuristic";
export type DuplicateMethod = "none" | "provided" | "exact" | "near";
export type ReplayCountMethod = "provided" | "inferred" | "none";
export type TokenCountMethod = "provided" | "custom" | "estimated";
export type TraceFormat = "auto" | "pau" | "openai" | "anthropic" | "messages";

export interface ContextSegmentInput {
  id: string;
  type: ContextCategory;
  source?: string;
  content?: string;
  contentHash?: string;
  tokens?: number;
  turnAdded?: number;
  turnLastSeen?: number;
  replayCount?: number;
  duplicateRatio?: number;
  relevance?: number;
  density?: number;
  authority?: number;
  utility?: number;
  protected?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface PAUTrace {
  version: "0.1" | "0.2" | string;
  runId?: string;
  model?: string;
  provider?: string;
  tokenizer?: string;
  traceBoundary?: string;
  contextWindow?: number;
  turn?: number;
  analysisMode?: AnalysisMode;
  segments: ContextSegmentInput[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface PAUProfile {
  id: string;
  version: string;
  mode: AnalysisMode;
  baseWeights: Record<ContextCategory, number>;
  defaultRelevance: number;
  defaultDensity: number;
  defaultAuthority: number;
  protectedTypes: ContextCategory[];
  hogEpsilon: number;
}

export interface NearDuplicateOptions {
  enabled?: boolean;
  threshold?: number;
  shingleSize?: number;
  maxComparisons?: number;
}

export interface AdjustmentBreakdown {
  baseWeight: number;
  relevance: number;
  density: number;
  authority: number;
  adjustmentFactor: number;
}

export interface AnalyzedSegment extends ContextSegmentInput {
  tokens: number;
  tokenCountMethod: TokenCountMethod;
  contentHash?: string;
  protected: boolean;
  duplicateRatio: number;
  duplicateMethod: DuplicateMethod;
  duplicateOf?: string;
  replayCount: number;
  replayCountMethod: ReplayCountMethod;
  lifetimeTurns: number | null;
  ageTurns: number | null;
  adjustments: AdjustmentBreakdown;
  pau: number;
  pigDensity: number;
  replayTokens: number;
  replayPAU: number;
  retentionTaxPAU: number | null;
  tokenShare: number;
  pauShare: number;
  utilityEstimate: number | null;
  utilityMethod: UtilityMethod;
  utilityShare: number | null;
  structuralPressureScore: number;
  contextHogIndex: number | null;
  effectiveHogScore: number;
  hogSeverity: HogSeverity;
  scoreConfidence: ScoreConfidence;
  recommendations: string[];
}

export interface CategorySummary {
  type: ContextCategory;
  segments: number;
  tokens: number;
  tokenShare: number;
  pau: number;
  pauShare: number;
  replayTokens: number;
  maxHogScore: number;
}

export interface SourceSummary {
  source: string;
  segments: number;
  tokens: number;
  tokenShare: number;
  pau: number;
  pauShare: number;
  replayTokens: number;
  duplicateTokenRatio: number;
  maxHogScore: number;
}

export interface ContextReceipt {
  schemaVersion: "0.2";
  profile: string;
  analysisMode: AnalysisMode;
  runId?: string;
  model?: string;
  provider?: string;
  tokenizer?: string;
  traceBoundary?: string;
  turn?: number;
  contextWindow?: number;
  totalTokens: number;
  totalPAU: number;
  rawUtilization: number | null;
  pauUtilization: number | null;
  duplicateTokenRatio: number;
  replayTokens: number;
  replayPAU: number;
  replayOverheadRatio: number;
  protectedTokenRatio: number;
  estimatedTokenRatio: number;
  usefulPAU: number | null;
  wastePAU: number | null;
  pigEfficiency: number | null;
  maxHogScore: number;
  contextHealthScore: number;
  categories: CategorySummary[];
  sources: SourceSummary[];
  warnings: string[];
  segments: AnalyzedSegment[];
}

export type TokenCounter = (text: string, segment: ContextSegmentInput) => number;

export interface AnalyzeOptions {
  profile?: PAUProfile;
  tokenCounter?: TokenCounter;
  nearDuplicates?: NearDuplicateOptions | boolean;
}

export interface NormalizeTraceOptions {
  format?: TraceFormat;
  version?: string;
  runId?: string;
  model?: string;
  provider?: string;
  tokenizer?: string;
  traceBoundary?: string;
  contextWindow?: number;
  turn?: number;
  analysisMode?: AnalysisMode;
}

export type OptimizationPolicyName = "conservative" | "balanced" | "aggressive";
export type OptimizationActionType =
  | "deduplicate"
  | "cache-reference"
  | "selective-retrieval"
  | "summarize-history"
  | "prune-stale"
  | "retain";

export interface OptimizationAction {
  segmentId: string;
  segmentType: ContextCategory;
  source?: string;
  action: OptimizationActionType;
  score: number;
  confidence: ScoreConfidence;
  reason: string;
  currentTokenSavings: number;
  futureReplayTokenSavings: number;
  currentPAUSavings: number;
  protected: boolean;
}

export interface OptimizationPlan {
  policy: OptimizationPolicyName;
  generatedFromProfile: string;
  actions: OptimizationAction[];
  totalCurrentTokenSavings: number;
  totalFutureReplayTokenSavings: number;
  totalCurrentPAUSavings: number;
  projectedTotalTokens: number;
  projectedTotalPAU: number;
  projectedRawUtilization: number | null;
  projectedPAUUtilization: number | null;
}

export interface BudgetThresholds {
  maxTokens?: number;
  maxRawUtilization?: number;
  maxPAUUtilization?: number;
  maxDuplicateTokenRatio?: number;
  maxReplayOverheadRatio?: number;
  maxHogScore?: number;
  minContextHealthScore?: number;
  minPigEfficiency?: number;
}

export interface BudgetViolation {
  metric: keyof BudgetThresholds;
  actual: number;
  threshold: number;
  message: string;
}

export interface BudgetResult {
  passed: boolean;
  violations: BudgetViolation[];
}

export interface MetricDelta {
  baseline: number | null;
  candidate: number | null;
  absolute: number | null;
  relative: number | null;
}

export interface NamedMetricDelta extends MetricDelta {
  name: string;
}

export interface ReceiptComparison {
  verdict: "improved" | "regressed" | "mixed" | "neutral";
  metrics: {
    totalTokens: MetricDelta;
    totalPAU: MetricDelta;
    contextHealthScore: MetricDelta;
    replayOverheadRatio: MetricDelta;
    duplicateTokenRatio: MetricDelta;
    pigEfficiency: MetricDelta;
    maxHogScore: MetricDelta;
  };
  categoryDeltas: NamedMetricDelta[];
  sourceDeltas: NamedMetricDelta[];
  findings: string[];
}

export interface TraceSeriesPoint {
  index: number;
  turn: number | null;
  runId?: string;
  totalTokens: number;
  totalPAU: number;
  replayTokens: number;
  contextHealthScore: number;
  tokenGrowth: number | null;
  pauGrowth: number | null;
}

export interface TraceSeriesAnalysis {
  receipts: ContextReceipt[];
  points: TraceSeriesPoint[];
  peakTokens: number;
  peakPAU: number;
  totalReplayTokens: number;
  averageHealthScore: number;
  fastestGrowingCategory: string | null;
}
