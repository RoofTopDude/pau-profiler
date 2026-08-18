import { fingerprint } from "./hash.js";
import { clamp, round, safeRatio } from "./math.js";
import { heuristicProfile, profileFor } from "./profile.js";
import { countTokens } from "./tokenizer.js";
import type {
  AnalyzeOptions,
  AnalyzedSegment,
  CategorySummary,
  ContextCategory,
  ContextReceipt,
  ContextSegmentInput,
  HogSeverity,
  PAUProfile,
  PAUTrace
} from "./types.js";

interface WorkingSegment {
  input: ContextSegmentInput;
  tokens: number;
  tokenCountMethod: "provided" | "custom" | "estimated";
  contentHash?: string;
  protected: boolean;
  duplicateRatio: number;
  replayCount: number;
  baseWeight: number;
  relevance: number;
  density: number;
  authority: number;
  adjustmentFactor: number;
  pau: number;
  utilityEstimate: number | null;
}

export function analyzeTrace(trace: PAUTrace, options: AnalyzeOptions = {}): ContextReceipt {
  validateTrace(trace);
  const profile = options.profile ?? profileFor(trace.analysisMode ?? heuristicProfile.mode);
  const seenHashes = new Map<string, number>();

  const working: WorkingSegment[] = trace.segments.map((input) => {
    const counted = countTokens(input, options.tokenCounter);
    const contentHash = input.contentHash ?? (input.content !== undefined ? fingerprint(input.content) : undefined);
    const seenCount = contentHash ? (seenHashes.get(contentHash) ?? 0) : 0;
    if (contentHash) seenHashes.set(contentHash, seenCount + 1);

    const duplicateRatio = clamp(input.duplicateRatio ?? (seenCount > 0 ? 1 : 0));
    const replayCount = normalizeReplayCount(input.replayCount ?? seenCount, input.id);
    const baseWeight = profile.baseWeights[input.type];
    const relevance = positiveFactor(input.relevance ?? profile.defaultRelevance, `${input.id}.relevance`);
    const density = positiveFactor(input.density ?? profile.defaultDensity, `${input.id}.density`);
    const authority = positiveFactor(input.authority ?? profile.defaultAuthority, `${input.id}.authority`);
    const adjustmentFactor = profile.mode === "basic"
      ? baseWeight
      : baseWeight * relevance * density * authority;
    const pau = counted.tokens * adjustmentFactor;
    const isProtected = input.protected ?? profile.protectedTypes.includes(input.type);
    const utilityEstimate = resolveUtility(input, profile, relevance, density, authority, duplicateRatio);

    const result: WorkingSegment = {
      input,
      tokens: counted.tokens,
      tokenCountMethod: counted.method,
      protected: isProtected,
      duplicateRatio,
      replayCount,
      baseWeight,
      relevance,
      density,
      authority,
      adjustmentFactor,
      pau,
      utilityEstimate
    };
    if (contentHash !== undefined) result.contentHash = contentHash;
    return result;
  });

  const totalTokens = sum(working.map((s) => s.tokens));
  const totalPAU = sum(working.map((s) => s.pau));
  const utilityMassTotal = sum(working.map((s) =>
    s.utilityEstimate === null ? 0 : s.pau * s.utilityEstimate
  ));
  const hasUtility = working.some((s) => s.utilityEstimate !== null);

  const segments: AnalyzedSegment[] = working.map((s) => {
    const tokenShare = safeRatio(s.tokens, totalTokens);
    const pauShare = safeRatio(s.pau, totalPAU);
    const utilityShare = s.utilityEstimate === null || utilityMassTotal === 0
      ? null
      : (s.pau * s.utilityEstimate) / utilityMassTotal;
    const structuralPressureScore = computeStructuralPressure(tokenShare, s.duplicateRatio, s.replayCount);
    const contextHogIndex = utilityShare === null
      ? null
      : computeContextHogIndex(tokenShare, pauShare, utilityShare, s.duplicateRatio, s.replayCount, profile.hogEpsilon);
    const severity = severityFor(contextHogIndex ?? structuralPressureScore);

    const segment: AnalyzedSegment = {
      ...s.input,
      tokens: s.tokens,
      tokenCountMethod: s.tokenCountMethod,
      protected: s.protected,
      duplicateRatio: round(s.duplicateRatio),
      replayCount: s.replayCount,
      adjustments: {
        baseWeight: round(s.baseWeight),
        relevance: round(s.relevance),
        density: round(s.density),
        authority: round(s.authority),
        adjustmentFactor: round(s.adjustmentFactor)
      },
      pau: round(s.pau, 2),
      pigDensity: round(s.adjustmentFactor),
      tokenShare: round(tokenShare),
      pauShare: round(pauShare),
      utilityEstimate: s.utilityEstimate === null ? null : round(s.utilityEstimate),
      utilityShare: utilityShare === null ? null : round(utilityShare),
      structuralPressureScore: round(structuralPressureScore, 2),
      contextHogIndex: contextHogIndex === null ? null : round(contextHogIndex, 2),
      hogSeverity: severity,
      recommendations: recommendationsFor(s, contextHogIndex, structuralPressureScore)
    };
    if (s.contentHash !== undefined) segment.contentHash = s.contentHash;
    return segment;
  });

  const replayTokens = sum(working.map((s) => s.tokens * s.replayCount));
  const duplicateTokens = sum(working.map((s) => s.tokens * s.duplicateRatio));
  const duplicateTokenRatio = safeRatio(duplicateTokens, totalTokens);
  const replayOverheadRatio = safeRatio(replayTokens, totalTokens + replayTokens);
  const rawUtilization = trace.contextWindow === undefined ? null : safeRatio(totalTokens, trace.contextWindow);
  const pauUtilization = trace.contextWindow === undefined ? null : safeRatio(totalPAU, trace.contextWindow);
  const usefulPAU = hasUtility ? sum(working.map((s) => s.pau * (s.utilityEstimate ?? 0))) : null;
  const wastePAU = usefulPAU === null ? null : totalPAU - usefulPAU;
  const pigEfficiency = usefulPAU === null ? null : safeRatio(usefulPAU, totalPAU);

  const receipt: ContextReceipt = {
    schemaVersion: "0.1",
    profile: `${profile.id}@${profile.version}`,
    totalTokens,
    totalPAU: round(totalPAU, 2),
    rawUtilization: rawUtilization === null ? null : round(rawUtilization),
    pauUtilization: pauUtilization === null ? null : round(pauUtilization),
    duplicateTokenRatio: round(duplicateTokenRatio),
    replayTokens,
    replayOverheadRatio: round(replayOverheadRatio),
    usefulPAU: usefulPAU === null ? null : round(usefulPAU, 2),
    wastePAU: wastePAU === null ? null : round(wastePAU, 2),
    pigEfficiency: pigEfficiency === null ? null : round(pigEfficiency),
    contextHealthScore: computeHealthScore(
      rawUtilization,
      pauUtilization,
      duplicateTokenRatio,
      replayOverheadRatio,
      segments
    ),
    categories: summarizeCategories(segments, totalTokens, totalPAU),
    segments
  };

  if (trace.runId !== undefined) receipt.runId = trace.runId;
  if (trace.model !== undefined) receipt.model = trace.model;
  if (trace.provider !== undefined) receipt.provider = trace.provider;
  if (trace.turn !== undefined) receipt.turn = trace.turn;
  if (trace.contextWindow !== undefined) receipt.contextWindow = trace.contextWindow;

  return receipt;
}

function validateTrace(trace: PAUTrace): void {
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

function positiveFactor(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return value;
}

function normalizeReplayCount(value: number, id: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${id}.replayCount must be a non-negative finite number.`);
  return Math.floor(value);
}

function resolveUtility(
  input: ContextSegmentInput,
  profile: PAUProfile,
  relevance: number,
  density: number,
  authority: number,
  duplicateRatio: number
): number | null {
  if (input.utility !== undefined) return clamp(input.utility);
  if (profile.mode === "basic") return null;

  const densityNorm = clamp(density / 1.5);
  const authorityNorm = clamp(authority / 1.5);
  const base = 0.65 * clamp(relevance) + 0.2 * densityNorm + 0.15 * authorityNorm;
  const novelty = 1 - (0.75 * duplicateRatio);
  return clamp(base * novelty);
}

function computeStructuralPressure(tokenShare: number, duplicateRatio: number, replayCount: number): number {
  const sizePressure = clamp(tokenShare / 0.25);
  const replayPressure = clamp(replayCount / 3);
  const wastePressure = Math.max(duplicateRatio, replayPressure);
  return 10 * clamp(sizePressure * (0.55 + 0.45 * wastePressure));
}

function computeContextHogIndex(
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

function severityFor(score: number): HogSeverity {
  if (score >= 8) return "severe";
  if (score >= 6) return "high";
  if (score >= 4) return "medium";
  if (score >= 2) return "watch";
  return "low";
}

function recommendationsFor(
  s: WorkingSegment,
  contextHogIndex: number | null,
  structuralPressureScore: number
): string[] {
  const recommendations: string[] = [];
  if (s.protected) {
    recommendations.push("Protected context: report size, but do not automatically evict or compress.");
  }
  if (s.duplicateRatio >= 0.5) {
    recommendations.push("Deduplicate repeated content or retain a stable reference instead of replaying the full segment.");
  }
  if (s.replayCount >= 2) {
    recommendations.push("Use delta prompting, caching, or summarized state to reduce replay overhead across turns.");
  }
  const effectiveScore = contextHogIndex ?? structuralPressureScore;
  if (!s.protected && effectiveScore >= 6 && ["tool", "workspace", "rag", "browser"].includes(s.input.type)) {
    recommendations.push("Prefer selective retrieval or targeted excerpts over retaining the full source payload.");
  }
  if (!s.protected && effectiveScore >= 4 && s.input.type === "history") {
    recommendations.push("Consider turn summarization or bounded history retention.");
  }
  return recommendations;
}

function computeHealthScore(
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
  const maxHog = segments.reduce((max, s) => Math.max(max, s.contextHogIndex ?? s.structuralPressureScore), 0);
  const hogPenalty = 10 * clamp(maxHog / 10);
  return Math.round(clamp(100 - rawPenalty - pauPenalty - duplicatePenalty - replayPenalty - hogPenalty, 0, 100));
}

function summarizeCategories(
  segments: AnalyzedSegment[],
  totalTokens: number,
  totalPAU: number
): CategorySummary[] {
  const map = new Map<ContextCategory, { segments: number; tokens: number; pau: number }>();
  for (const segment of segments) {
    const current = map.get(segment.type) ?? { segments: 0, tokens: 0, pau: 0 };
    current.segments += 1;
    current.tokens += segment.tokens;
    current.pau += segment.pau;
    map.set(segment.type, current);
  }
  return [...map.entries()]
    .map(([type, value]) => ({
      type,
      segments: value.segments,
      tokens: value.tokens,
      tokenShare: round(safeRatio(value.tokens, totalTokens)),
      pau: round(value.pau, 2),
      pauShare: round(safeRatio(value.pau, totalPAU))
    }))
    .sort((a, b) => b.pau - a.pau);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
