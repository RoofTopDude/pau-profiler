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
  version: "0.1" | string;
  runId?: string;
  model?: string;
  provider?: string;
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

export interface AdjustmentBreakdown {
  baseWeight: number;
  relevance: number;
  density: number;
  authority: number;
  adjustmentFactor: number;
}

export interface AnalyzedSegment extends ContextSegmentInput {
  tokens: number;
  tokenCountMethod: "provided" | "custom" | "estimated";
  contentHash?: string;
  protected: boolean;
  duplicateRatio: number;
  replayCount: number;
  adjustments: AdjustmentBreakdown;
  pau: number;
  pigDensity: number;
  tokenShare: number;
  pauShare: number;
  utilityEstimate: number | null;
  utilityShare: number | null;
  structuralPressureScore: number;
  contextHogIndex: number | null;
  hogSeverity: HogSeverity;
  recommendations: string[];
}

export interface CategorySummary {
  type: ContextCategory;
  segments: number;
  tokens: number;
  tokenShare: number;
  pau: number;
  pauShare: number;
}

export interface ContextReceipt {
  schemaVersion: "0.1";
  profile: string;
  runId?: string;
  model?: string;
  provider?: string;
  turn?: number;
  contextWindow?: number;
  totalTokens: number;
  totalPAU: number;
  rawUtilization: number | null;
  pauUtilization: number | null;
  duplicateTokenRatio: number;
  replayTokens: number;
  replayOverheadRatio: number;
  usefulPAU: number | null;
  wastePAU: number | null;
  pigEfficiency: number | null;
  contextHealthScore: number;
  categories: CategorySummary[];
  segments: AnalyzedSegment[];
}

export type TokenCounter = (text: string, segment: ContextSegmentInput) => number;

export interface AnalyzeOptions {
  profile?: PAUProfile;
  tokenCounter?: TokenCounter;
}
