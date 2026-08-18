import { clamp, round, safeRatio } from "./math.js";
import type {
  AnalyzeOptions,
  AnalyzedSegment,
  CategorySummary,
  ContextCategory,
  ContextSegmentInput,
  DuplicateMethod,
  HogSeverity,
  PAUProfile,
  PAUTrace,
  ReplayCountMethod,
  ScoreConfidence,
  SourceSummary,
  TokenCountMethod,
  UtilityMethod
} from "./types.js";

export interface WorkingSegment {
  input: ContextSegmentInput;
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
  baseWeight: number;
  relevance: number;
  density: number;
  authority: number;
  adjustmentFactor: number;
  pau: number;
  utilityEstimate: number | null;
  utilityMethod: UtilityMethod;
}

export function validateTrace(trace: PAUTrace): void {
  if (!trace || typeof trace !== "object") throw new Error("Trace must be an object.");
  if (!Array.isArray(trace.segments)) throw new Error("Trace segments must be an array.");
  if (trace.contextWindow !== undefined && (!Number.isFinite(trace.contextWindow) || trace.contextWindow <= 0)) {
    throw new Error("contextWindow must be a positive finite number.");
  }
  const ids = new Set<string>();
  for (const segment of trace.segments) {
    if (!segment.id) throw new Error("Every segment requires a non-empty id.");
    if (ids.has(segment.id)) throw new Error(`Duplicate segment id: ${segment.id}`);
    ids.add(segment.id);
  }
}

export function resolveNearDuplicateOptions(value: AnalyzeOptions["nearDuplicates"]): Required<NonNullable<Exclude<AnalyzeOptions["nearDuplicates"], boolean>>> {
  if (value === false) return { enabled: false, threshold: 0.78, shingleSize: 3, maxComparisons: 2_000 };
  if (value === true || value === undefined) return { enabled: true, threshold: 0.78, shingleSize: 3, maxComparisons: 2_000 };
  return {
    enabled: value.enabled ?? true,
    threshold: value.threshold ?? 0.78,
    shingleSize: value.shingleSize ?? 3,
    maxComparisons: value.maxComparisons ?? 2_000
  };
}

export function resolveDuplicate(
  input: ContextSegmentInput,
  exactDuplicateOf: string | undefined,
  nearMatch: { duplicateOf: string; similarity: number } | undefined
): { ratio: number; method: DuplicateMethod; duplicateOf?: string } {
  if (input.duplicateRatio !== undefined) {
    const result: { ratio: number; method: DuplicateMethod; duplicateOf?: string } = {
      ratio: clamp(input.duplicateRatio),
      method: "provided"
    };
    if (exactDuplicateOf !== undefined) result.duplicateOf = exactDuplicateOf;
    else if (nearMatch !== undefined) result.duplicateOf = nearMatch.duplicateOf;
    return result;
  }
  if (exactDuplicateOf !== undefined) {
    return { ratio: 1, method: "exact", duplicateOf: exactDuplicateOf };
  }
  if (nearMatch !== undefined) {
    return { ratio: clamp(nearMatch.similarity), method: "near", duplicateOf: nearMatch.duplicateOf };
  }
  return { ratio: 0, method: "none" };
}

export function resolveReplay(input: ContextSegmentInput, currentTurn: number | undefined): { count: number; method: ReplayCountMethod } {
  if (input.replayCount !== undefined) {
    return { count: normalizeReplayCount(input.replayCount, input.id), method: "provided" };
  }
  if (input.turnAdded !== undefined) {
    const lastSeen = input.turnLastSeen ?? currentTurn;
    if (lastSeen !== undefined && lastSeen >= input.turnAdded) {
      return { count: Math.max(0, Math.floor(lastSeen - input.turnAdded)), method: "inferred" };
    }
  }
  return { count: 0, method: "none" };
}

export function resolveLifetime(input: ContextSegmentInput, currentTurn: number | undefined): number | null {
  if (input.turnAdded === undefined) return null;
  const lastSeen = input.turnLastSeen ?? currentTurn ?? input.turnAdded;
  if (lastSeen < input.turnAdded) return 1;
  return Math.floor(lastSeen - input.turnAdded + 1);
}

export function resolveAge(input: ContextSegmentInput, currentTurn: number | undefined): number | null {
  if (input.turnAdded === undefined || currentTurn === undefined) return null;
  return Math.max(0, Math.floor(currentTurn - input.turnAdded));
}

export function positiveFactor(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return value;
}

function normalizeReplayCount(value: number, id: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${id}.replayCount must be a non-negative finite number.`);
  return Math.floor(value);
}

export function resolveUtility(
  input: ContextSegmentInput,
  profile: PAUProfile,
  relevance: number,
  density: number,
  authority: number,
  duplicateRatio: number
): { value: number | null; method: UtilityMethod } {
  if (input.utility !== undefined) return { value: clamp(input.utility), method: "provided" };
  if (profile.mode === "basic") return { value: null, method: "none" };

  const densityNorm = clamp(density / 1.5);
  const authorityNorm = clamp(authority / 1.5);
  const base = 0.65 * clamp(relevance) + 0.2 * densityNorm + 0.15 * authorityNorm;
  const novelty = 1 - (0.75 * duplicateRatio);
  return { value: clamp(base * novelty), method: "heuristic" };
}

export function computeStructuralPressure(
  tokenShare: number,
  duplicateRatio: number,
  replayCount: number,
  ageTurns: number | null
): number {
  const sizePressure = clamp(tokenShare / 0.25);
  const replayPressure = clamp(replayCount / 3);
  const agePressure = ageTurns === null ? 0 : clamp(ageTurns / 12);
  const wastePressure = Math.max(duplicateRatio, replayPressure);
  return 10 * clamp(sizePressure * (0.48 + 0.38 * wastePressure + 0.14 * agePressure));
}

export function computeContextHogIndex(
  tokenShare: number,
  pauShare: number,
  utilityShare: number,
  duplicateRatio: number,
  replayCount: number,
  epsilon: number
): number {
  const consumptionShare = Math.max(tokenShare, pauShare);
  const ratio = consumptionShare / (utilityShare + epsilon);
  if (ratio <= 1) return 0;
  const replayMultiplier = 1 + 0.5 * clamp(replayCount / 3);
  const duplicateMultiplier = 1 + 0.5 * duplicateRatio;
  const excess = (ratio - 1) * 0.35 * replayMultiplier * duplicateMultiplier;
  return 10 * (1 - Math.exp(-excess));
}

export function severityFor(score: number): HogSeverity {
  if (score >= 8) return "severe";
  if (score >= 6) return "high";
  if (score >= 4) return "medium";
  if (score >= 2) return "watch";
  return "low";
}

export function confidenceFor(segment: WorkingSegment, contextWindow: number | undefined): ScoreConfidence {
  let score = 1;
  if (segment.tokenCountMethod === "estimated") score -= 0.35;
  if (segment.utilityMethod === "heuristic") score -= 0.2;
  if (segment.utilityMethod === "none") score -= 0.12;
  if (segment.duplicateMethod === "near") score -= 0.1;
  if (segment.replayCountMethod === "inferred") score -= 0.05;
  if (contextWindow === undefined) score -= 0.05;
  if (score >= 0.78) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

export function recommendationsFor(
  segment: WorkingSegment,
  contextHogIndex: number | null,
  structuralPressureScore: number
): string[] {
  const recommendations: string[] = [];
  if (segment.protected) {
    recommendations.push("Protected context: report size, but do not automatically evict or compress.");
  }
  if (segment.duplicateRatio >= 0.35) {
    recommendations.push("Deduplicate repeated content or retain a stable reference instead of replaying the full segment.");
  }
  if (segment.replayCount >= 2) {
    recommendations.push("Use delta prompting, caching, or summarized state to reduce replay overhead across turns.");
  }
  if ((segment.ageTurns ?? 0) >= 6 && (segment.utilityEstimate ?? segment.relevance) < 0.55) {
    recommendations.push("This segment is aging with limited estimated value; require an explicit retention reason.");
  }
  const effectiveScore = contextHogIndex ?? structuralPressureScore;
  if (!segment.protected && effectiveScore >= 6 && ["tool", "workspace", "rag", "browser", "data"].includes(segment.input.type)) {
    recommendations.push("Prefer selective retrieval or targeted excerpts over retaining the full source payload.");
  }
  if (!segment.protected && effectiveScore >= 4 && segment.input.type === "history") {
    recommendations.push("Consider turn summarization or bounded history retention.");
  }
  if (!segment.protected && effectiveScore >= 5 && segment.input.type === "code") {
    recommendations.push("Retain symbol-level excerpts and dependency context rather than entire files when possible.");
  }
  return recommendations;
}

export function computeHealthScore(
  rawUtilization: number | null,
  pauUtilization: number | null,
  duplicateTokenRatio: number,
  replayOverheadRatio: number,
  segments: AnalyzedSegment[]
): number {
  const rawPenalty = rawUtilization === null ? 0 : 25 * clamp((rawUtilization - 0.5) / 0.5);
  const pauPenalty = pauUtilization === null ? 0 : 20 * clamp((pauUtilization - 0.5) / 0.75);
  const duplicatePenalty = 25 * clamp(duplicateTokenRatio);
  const replayPenalty = 20 * clamp(replayOverheadRatio);
  const maxHog = segments.reduce((max, segment) => Math.max(max, segment.effectiveHogScore), 0);
  const hogPenalty = 10 * clamp(maxHog / 10);
  return Math.round(clamp(100 - rawPenalty - pauPenalty - duplicatePenalty - replayPenalty - hogPenalty, 0, 100));
}

export function summarizeCategories(
  segments: AnalyzedSegment[],
  totalTokens: number,
  totalPAU: number
): CategorySummary[] {
  const map = new Map<ContextCategory, { segments: number; tokens: number; pau: number; replayTokens: number; maxHogScore: number }>();
  for (const segment of segments) {
    const current = map.get(segment.type) ?? { segments: 0, tokens: 0, pau: 0, replayTokens: 0, maxHogScore: 0 };
    current.segments += 1;
    current.tokens += segment.tokens;
    current.pau += segment.pau;
    current.replayTokens += segment.replayTokens;
    current.maxHogScore = Math.max(current.maxHogScore, segment.effectiveHogScore);
    map.set(segment.type, current);
  }
  return [...map.entries()]
    .map(([type, value]) => ({
      type,
      segments: value.segments,
      tokens: value.tokens,
      tokenShare: round(safeRatio(value.tokens, totalTokens)),
      pau: round(value.pau, 2),
      pauShare: round(safeRatio(value.pau, totalPAU)),
      replayTokens: value.replayTokens,
      maxHogScore: round(value.maxHogScore, 2)
    }))
    .sort((a, b) => b.pau - a.pau);
}

export function summarizeSources(
  segments: AnalyzedSegment[],
  totalTokens: number,
  totalPAU: number
): SourceSummary[] {
  const map = new Map<string, {
    segments: number;
    tokens: number;
    pau: number;
    replayTokens: number;
    duplicateTokens: number;
    maxHogScore: number;
  }>();
  for (const segment of segments) {
    const source = segment.source ?? segment.type;
    const current = map.get(source) ?? {
      segments: 0,
      tokens: 0,
      pau: 0,
      replayTokens: 0,
      duplicateTokens: 0,
      maxHogScore: 0
    };
    current.segments += 1;
    current.tokens += segment.tokens;
    current.pau += segment.pau;
    current.replayTokens += segment.replayTokens;
    current.duplicateTokens += segment.tokens * segment.duplicateRatio;
    current.maxHogScore = Math.max(current.maxHogScore, segment.effectiveHogScore);
    map.set(source, current);
  }
  return [...map.entries()]
    .map(([source, value]) => ({
      source,
      segments: value.segments,
      tokens: value.tokens,
      tokenShare: round(safeRatio(value.tokens, totalTokens)),
      pau: round(value.pau, 2),
      pauShare: round(safeRatio(value.pau, totalPAU)),
      replayTokens: value.replayTokens,
      duplicateTokenRatio: round(safeRatio(value.duplicateTokens, value.tokens)),
      maxHogScore: round(value.maxHogScore, 2)
    }))
    .sort((a, b) => b.pau - a.pau);
}

export function buildWarnings(trace: PAUTrace, segments: AnalyzedSegment[], rawUtilization: number | null): string[] {
  const warnings: string[] = [];
  const estimated = segments.filter((segment) => segment.tokenCountMethod === "estimated").length;
  const heuristic = segments.filter((segment) => segment.utilityMethod === "heuristic").length;
  const near = segments.filter((segment) => segment.duplicateMethod === "near").length;
  const protectedHogs = segments.filter((segment) => segment.protected && segment.effectiveHogScore >= 6).length;

  if (trace.contextWindow === undefined) warnings.push("No contextWindow was provided; utilization percentages are unavailable.");
  if (rawUtilization !== null && rawUtilization > 1) warnings.push("Physical context exceeds the declared context window.");
  if (estimated > 0) warnings.push(`${estimated} segment(s) use fallback token estimates rather than a model tokenizer.`);
  if (heuristic > 0) warnings.push(`${heuristic} segment(s) use heuristic utility; Context Hog scores are diagnostic, not causal.`);
  if (near > 0) warnings.push(`${near} near-duplicate segment(s) were identified using local shingle similarity.`);
  if (protectedHogs > 0) warnings.push(`${protectedHogs} protected segment(s) are large or inefficient; inspect them, but do not auto-evict them.`);
  return warnings;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
