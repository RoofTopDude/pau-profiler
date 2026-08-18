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
export type EvictionMethod = "provided-utility" | "heuristic-utility" | "structural";
export type DisclosureTier = "user" | "developer" | "auditor";
export type ProfileStatus = "experimental" | "stable" | "deprecated";
export type TokenAccountingGrade = "A" | "B" | "C" | "D";
export type SensitivityClass = "public" | "internal" | "confidential" | "personal" | "regulated" | "secret";
export type AuthorityClass =
  | "mandatory-policy"
  | "application-instruction"
  | "current-user"
  | "advisory"
  | "untrusted-external";
export type TransformationName =
  | "retain"
  | "reposition"
  | "compress"
  | "summarize"
  | "retrieve-on-demand"
  | "evict";

/**
 * The causal scope a utility estimate refers to. These can differ in magnitude and even in
 * sign: context that barely affects one answer can change a tool choice that reshapes every
 * later observation, so an unlabeled "utility" number is ambiguous.
 */
export type EffectScope = "local" | "run" | "policy";

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
  /** Governance classification. Independent of the numeric `authority` measurement factor. */
  authorityClass?: AuthorityClass;
  sensitivity?: SensitivityClass;
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
  /** Aggregate input tokens reported by the provider, used to grade accounting fidelity. */
  providerTokenTotal?: number;
  /** Causal scope that supplied `utility` values refer to. Defaults to "local". */
  utilityEffectScope?: EffectScope;
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
  uncertainty: UncertaintyModel;
  description?: string;
  publisher?: string;
  effectiveDate?: string;
  status?: ProfileStatus;
}

/** Partial input accepted by defineProfile(). Unspecified fields inherit the core defaults. */
export interface ProfileSpec {
  id: string;
  version: string;
  mode?: AnalysisMode;
  baseWeights?: Partial<Record<ContextCategory, number>>;
  defaultRelevance?: number;
  defaultDensity?: number;
  defaultAuthority?: number;
  protectedTypes?: ContextCategory[];
  hogEpsilon?: number;
  uncertainty?: Partial<UncertaintyModel>;
  description?: string;
  publisher?: string;
  effectiveDate?: string;
  status?: ProfileStatus;
}

/** PAU Core 11.2 profile manifest: everything a reader needs to interpret a PAU value. */
export interface ProfileManifest {
  identity: {
    profileId: string;
    version: string;
    mode: AnalysisMode;
    publisher: string;
    effectiveDate: string | null;
    status: ProfileStatus;
    description: string | null;
  };
  baseline: {
    referenceSegmentClass: ContextCategory;
    normalizationConstant: number;
    statement: string;
  };
  taxonomy: {
    categories: ContextCategory[];
    protectedTypes: ContextCategory[];
  };
  weights: {
    formula: string;
    baseWeights: Record<ContextCategory, number>;
    defaultFactors: { relevance: number; density: number; authority: number };
    hogEpsilon: number;
  };
  uncertainty: UncertaintyModel & { statement: string };
  governance: {
    reviewTriggers: string[];
    limitations: string[];
  };
}

export interface NearDuplicateOptions {
  enabled?: boolean;
  threshold?: number;
  shingleSize?: number;
  maxComparisons?: number;
}

/**
 * Log-space standard deviations describing how much confidence each measurement method
 * deserves. Values are versioned engineering parameters, not measured error distributions.
 */
export interface UncertaintyModel {
  tokenSigma: Record<TokenCountMethod, number>;
  baseWeightSigma: number;
  providedFactorSigma: number;
  defaultedFactorSigma: number;
  utilitySigma: Record<UtilityMethod, number>;
  /** Standard deviations spanned by the reported interval. 1.96 approximates 95%. */
  coverage: number;
}

export interface PAUInterval {
  low: number;
  high: number;
  /** Relative (log-space) sigma used to produce the bounds. */
  sigma: number;
  coverage: number;
}

export interface TokenReconciliation {
  providerTotal: number;
  attributedTotal: number;
  /** Provider total minus harness attribution: chat template, schemas, and protocol wrappers. */
  unattributedTokens: number;
  unattributedRatio: number;
  reconciled: boolean;
  tolerance: number;
}

export interface InteractionIndex {
  /** Dimensionless 0-1 interaction pressure. Never added to the PAU total. */
  index: number;
  dimensionless: true;
  components: {
    occupancy: number;
    fragmentation: number;
    evidenceSpread: number;
    instructionConflict: number;
    redundancyInterference: number;
  };
  interpretation: string;
  statement: string;
}

export interface GovernanceRecord {
  segmentId: string;
  authority: AuthorityClass;
  mandatory: boolean;
  retentionLock: boolean;
  sensitivity: SensitivityClass;
  allowedTransformations: TransformationName[];
  basis: string;
}

export interface GovernanceLedger {
  records: GovernanceRecord[];
  lockedSegmentIds: string[];
  lockedTokens: number;
  lockedPAU: number;
  statement: string;
}

export interface ValidationIssue {
  /** JSON-path-style pointer to the offending value. */
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  /** Problems that prevent analysis. */
  errors: ValidationIssue[];
  /** Problems that degrade measurement quality or confidence but still allow analysis. */
  warnings: ValidationIssue[];
  segmentCount: number;
}

export interface EvictionEstimate {
  tolerance: number;
  method: EvictionMethod;
  evictablePAU: number;
  evictableTokens: number;
  evictableShare: number;
  pigEfficiency: number;
  estimatedQualityLoss: number;
  segmentIds: string[];
  protectedPAUExcluded: number;
  confidence: ScoreConfidence;
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
  tokenAccountingGrade: TokenAccountingGrade;
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
  pauInterval: PAUInterval;
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
  schemaVersion: "0.3";
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
  pauInterval: PAUInterval;
  /** Graded by the weakest segment: a total is never more trustworthy than its worst part. */
  tokenAccountingGrade: TokenAccountingGrade;
  tokenAccountingNote: string;
  tokenReconciliation: TokenReconciliation | null;
  rawUtilization: number | null;
  pauUtilization: number | null;
  pauUtilizationInterval: PAUInterval | null;
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
  eviction: EvictionEstimate;
  /** Nonlocal interaction pressure, reported alongside PAU rather than inside it. */
  interaction: InteractionIndex;
  /** What the system must preserve, derived independently of any measurement. */
  governance: GovernanceLedger;
  utilityEffectScope: EffectScope;
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
  /** Estimated quality-loss budget used for the evictable-PAU estimate. Defaults to 0.05. */
  evictionTolerance?: number;
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
  providerTokenTotal?: number;
  utilityEffectScope?: EffectScope;
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
  transformation: TransformationName;
  score: number;
  /**
   * Removable Load Value: expected savings weighted by the probability that quality stays
   * within tolerance, by measurement confidence, and by governance feasibility. Unlike a hog
   * score it is an action value, so it does not blow up when utility approaches zero.
   */
  removableLoadValue: number;
  qualityRiskProbability: number;
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
  /** Segments the governance ledger locked before any score was considered. */
  governanceLockedSegments: string[];
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
