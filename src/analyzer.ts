import { fingerprint } from "./hash.js";
import { round, safeRatio } from "./math.js";
import { heuristicProfile, profileFor } from "./profile.js";
import { findNearDuplicateMatches } from "./similarity.js";
import { countTokens } from "./tokenizer.js";
import {
  buildWarnings,
  computeContextHogIndex,
  computeHealthScore,
  computeStructuralPressure,
  confidenceFor,
  positiveFactor,
  recommendationsFor,
  resolveAge,
  resolveDuplicate,
  resolveLifetime,
  resolveNearDuplicateOptions,
  resolveReplay,
  resolveUtility,
  severityFor,
  sum,
  summarizeCategories,
  summarizeSources,
  validateTrace,
  type WorkingSegment
} from "./analysis-internals.js";
import type { AnalyzeOptions, AnalyzedSegment, ContextReceipt, PAUTrace } from "./types.js";

export function analyzeTrace(trace: PAUTrace, options: AnalyzeOptions = {}): ContextReceipt {
  validateTrace(trace);
  const profile = options.profile ?? profileFor(trace.analysisMode ?? heuristicProfile.mode);
  const nearDuplicateOptions = resolveNearDuplicateOptions(options.nearDuplicates);
  const nearMatches = nearDuplicateOptions.enabled
    ? findNearDuplicateMatches(trace.segments, nearDuplicateOptions)
    : new Map();
  const seenHashes = new Map<string, string>();

  const working: WorkingSegment[] = trace.segments.map((input) => {
    const counted = countTokens(input, options.tokenCounter);
    const contentHash = input.contentHash ?? (input.content !== undefined ? fingerprint(input.content) : undefined);
    const exactDuplicateOf = contentHash ? seenHashes.get(contentHash) : undefined;
    if (contentHash && exactDuplicateOf === undefined) seenHashes.set(contentHash, input.id);
    const nearMatch = nearMatches.get(input.id);
    const duplicate = resolveDuplicate(input, exactDuplicateOf, nearMatch);
    const replay = resolveReplay(input, trace.turn);
    const lifetimeTurns = resolveLifetime(input, trace.turn);
    const ageTurns = resolveAge(input, trace.turn);

    const baseWeight = profile.baseWeights[input.type];
    if (baseWeight === undefined) throw new Error(`Unsupported context category: ${String(input.type)}`);
    const relevance = positiveFactor(input.relevance ?? profile.defaultRelevance, `${input.id}.relevance`);
    const density = positiveFactor(input.density ?? profile.defaultDensity, `${input.id}.density`);
    const authority = positiveFactor(input.authority ?? profile.defaultAuthority, `${input.id}.authority`);
    const adjustmentFactor = profile.mode === "basic"
      ? baseWeight
      : baseWeight * relevance * density * authority;
    const pau = counted.tokens * adjustmentFactor;
    const isProtected = input.protected ?? profile.protectedTypes.includes(input.type);
    const utility = resolveUtility(input, profile, relevance, density, authority, duplicate.ratio);

    const result: WorkingSegment = {
      input,
      tokens: counted.tokens,
      tokenCountMethod: counted.method,
      protected: isProtected,
      duplicateRatio: duplicate.ratio,
      duplicateMethod: duplicate.method,
      replayCount: replay.count,
      replayCountMethod: replay.method,
      lifetimeTurns,
      ageTurns,
      baseWeight,
      relevance,
      density,
      authority,
      adjustmentFactor,
      pau,
      utilityEstimate: utility.value,
      utilityMethod: utility.method
    };
    if (contentHash !== undefined) result.contentHash = contentHash;
    if (duplicate.duplicateOf !== undefined) result.duplicateOf = duplicate.duplicateOf;
    return result;
  });

  const totalTokens = sum(working.map((segment) => segment.tokens));
  const totalPAU = sum(working.map((segment) => segment.pau));
  const utilityMassTotal = sum(working.map((segment) =>
    segment.utilityEstimate === null ? 0 : segment.pau * segment.utilityEstimate
  ));
  const hasUtility = working.some((segment) => segment.utilityEstimate !== null);

  const segments: AnalyzedSegment[] = working.map((segment) => {
    const tokenShare = safeRatio(segment.tokens, totalTokens);
    const pauShare = safeRatio(segment.pau, totalPAU);
    const utilityShare = segment.utilityEstimate === null || utilityMassTotal === 0
      ? null
      : (segment.pau * segment.utilityEstimate) / utilityMassTotal;
    const structuralPressureScore = computeStructuralPressure(
      tokenShare,
      segment.duplicateRatio,
      segment.replayCount,
      segment.ageTurns
    );
    const contextHogIndex = utilityShare === null
      ? null
      : computeContextHogIndex(
        tokenShare,
        pauShare,
        utilityShare,
        segment.duplicateRatio,
        segment.replayCount,
        profile.hogEpsilon
      );
    const effectiveHogScore = contextHogIndex ?? structuralPressureScore;
    const replayTokens = segment.tokens * segment.replayCount;
    const replayPAU = segment.pau * segment.replayCount;
    const retentionTaxPAU = segment.utilityEstimate === null
      ? null
      : replayPAU * (1 - segment.utilityEstimate);

    const analyzed: AnalyzedSegment = {
      ...segment.input,
      tokens: segment.tokens,
      tokenCountMethod: segment.tokenCountMethod,
      protected: segment.protected,
      duplicateRatio: round(segment.duplicateRatio),
      duplicateMethod: segment.duplicateMethod,
      replayCount: segment.replayCount,
      replayCountMethod: segment.replayCountMethod,
      lifetimeTurns: segment.lifetimeTurns,
      ageTurns: segment.ageTurns,
      adjustments: {
        baseWeight: round(segment.baseWeight),
        relevance: round(segment.relevance),
        density: round(segment.density),
        authority: round(segment.authority),
        adjustmentFactor: round(segment.adjustmentFactor)
      },
      pau: round(segment.pau, 2),
      pigDensity: round(segment.adjustmentFactor),
      replayTokens,
      replayPAU: round(replayPAU, 2),
      retentionTaxPAU: retentionTaxPAU === null ? null : round(retentionTaxPAU, 2),
      tokenShare: round(tokenShare),
      pauShare: round(pauShare),
      utilityEstimate: segment.utilityEstimate === null ? null : round(segment.utilityEstimate),
      utilityMethod: segment.utilityMethod,
      utilityShare: utilityShare === null ? null : round(utilityShare),
      structuralPressureScore: round(structuralPressureScore, 2),
      contextHogIndex: contextHogIndex === null ? null : round(contextHogIndex, 2),
      effectiveHogScore: round(effectiveHogScore, 2),
      hogSeverity: severityFor(effectiveHogScore),
      scoreConfidence: confidenceFor(segment, trace.contextWindow),
      recommendations: recommendationsFor(segment, contextHogIndex, structuralPressureScore)
    };
    if (segment.contentHash !== undefined) analyzed.contentHash = segment.contentHash;
    if (segment.duplicateOf !== undefined) analyzed.duplicateOf = segment.duplicateOf;
    return analyzed;
  });

  const replayTokens = sum(segments.map((segment) => segment.replayTokens));
  const replayPAU = sum(segments.map((segment) => segment.replayPAU));
  const duplicateTokens = sum(working.map((segment) => segment.tokens * segment.duplicateRatio));
  const duplicateTokenRatio = safeRatio(duplicateTokens, totalTokens);
  const replayOverheadRatio = safeRatio(replayTokens, totalTokens + replayTokens);
  const protectedTokens = sum(working.filter((segment) => segment.protected).map((segment) => segment.tokens));
  const estimatedTokens = sum(working.filter((segment) => segment.tokenCountMethod === "estimated").map((segment) => segment.tokens));
  const rawUtilization = trace.contextWindow === undefined ? null : safeRatio(totalTokens, trace.contextWindow);
  const pauUtilization = trace.contextWindow === undefined ? null : safeRatio(totalPAU, trace.contextWindow);
  const usefulPAU = hasUtility ? sum(working.map((segment) => segment.pau * (segment.utilityEstimate ?? 0))) : null;
  const wastePAU = usefulPAU === null ? null : totalPAU - usefulPAU;
  const pigEfficiency = usefulPAU === null ? null : safeRatio(usefulPAU, totalPAU);
  const maxHogScore = segments.reduce((max, segment) => Math.max(max, segment.effectiveHogScore), 0);

  const receipt: ContextReceipt = {
    schemaVersion: "0.2",
    profile: `${profile.id}@${profile.version}`,
    analysisMode: profile.mode,
    totalTokens,
    totalPAU: round(totalPAU, 2),
    rawUtilization: rawUtilization === null ? null : round(rawUtilization),
    pauUtilization: pauUtilization === null ? null : round(pauUtilization),
    duplicateTokenRatio: round(duplicateTokenRatio),
    replayTokens,
    replayPAU: round(replayPAU, 2),
    replayOverheadRatio: round(replayOverheadRatio),
    protectedTokenRatio: round(safeRatio(protectedTokens, totalTokens)),
    estimatedTokenRatio: round(safeRatio(estimatedTokens, totalTokens)),
    usefulPAU: usefulPAU === null ? null : round(usefulPAU, 2),
    wastePAU: wastePAU === null ? null : round(wastePAU, 2),
    pigEfficiency: pigEfficiency === null ? null : round(pigEfficiency),
    maxHogScore: round(maxHogScore, 2),
    contextHealthScore: computeHealthScore(
      rawUtilization,
      pauUtilization,
      duplicateTokenRatio,
      replayOverheadRatio,
      segments
    ),
    categories: summarizeCategories(segments, totalTokens, totalPAU),
    sources: summarizeSources(segments, totalTokens, totalPAU),
    warnings: buildWarnings(trace, segments, rawUtilization),
    segments
  };

  if (trace.runId !== undefined) receipt.runId = trace.runId;
  if (trace.model !== undefined) receipt.model = trace.model;
  if (trace.provider !== undefined) receipt.provider = trace.provider;
  if (trace.tokenizer !== undefined) receipt.tokenizer = trace.tokenizer;
  if (trace.traceBoundary !== undefined) receipt.traceBoundary = trace.traceBoundary;
  if (trace.turn !== undefined) receipt.turn = trace.turn;
  if (trace.contextWindow !== undefined) receipt.contextWindow = trace.contextWindow;

  return receipt;
}
