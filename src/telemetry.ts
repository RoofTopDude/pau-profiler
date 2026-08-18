import type { AnalyzedSegment, ContextReceipt } from "./types.js";

export type TelemetryAttributes = Record<string, string | number | boolean>;

/**
 * Returns OpenTelemetry-friendly custom attributes.
 * The `pau.*` namespace is project-defined and is not an official OTel semantic convention.
 */
export function toTelemetryAttributes(receipt: ContextReceipt): TelemetryAttributes {
  const attributes: TelemetryAttributes = {
    "pau.schema.version": receipt.schemaVersion,
    "pau.profile": receipt.profile,
    "pau.analysis.mode": receipt.analysisMode,
    "pau.tokens.physical": receipt.totalTokens,
    "pau.load": receipt.totalPAU,
    "pau.duplicate_token_ratio": receipt.duplicateTokenRatio,
    "pau.replay.tokens": receipt.replayTokens,
    "pau.replay.load": receipt.replayPAU,
    "pau.replay.overhead_ratio": receipt.replayOverheadRatio,
    "pau.protected_token_ratio": receipt.protectedTokenRatio,
    "pau.estimated_token_ratio": receipt.estimatedTokenRatio,
    "pau.max_hog_score": receipt.maxHogScore,
    "pau.context_health_score": receipt.contextHealthScore
  };

  if (receipt.rawUtilization !== null) attributes["pau.utilization.raw"] = receipt.rawUtilization;
  if (receipt.pauUtilization !== null) attributes["pau.utilization.adjusted"] = receipt.pauUtilization;
  if (receipt.pigEfficiency !== null) attributes["pau.efficiency"] = receipt.pigEfficiency;
  if (receipt.usefulPAU !== null) attributes["pau.useful_load"] = receipt.usefulPAU;
  if (receipt.wastePAU !== null) attributes["pau.waste_load"] = receipt.wastePAU;
  if (receipt.runId !== undefined) attributes["pau.run.id"] = receipt.runId;
  if (receipt.model !== undefined) attributes["gen_ai.request.model"] = receipt.model;
  if (receipt.provider !== undefined) attributes["pau.provider"] = receipt.provider;
  if (receipt.tokenizer !== undefined) attributes["pau.tokenizer"] = receipt.tokenizer;
  if (receipt.traceBoundary !== undefined) attributes["pau.trace.boundary"] = receipt.traceBoundary;
  if (receipt.turn !== undefined) attributes["pau.turn"] = receipt.turn;

  return attributes;
}

export function toSegmentTelemetryAttributes(segment: AnalyzedSegment): TelemetryAttributes {
  const attributes: TelemetryAttributes = {
    "pau.segment.id": segment.id,
    "pau.segment.type": segment.type,
    "pau.segment.protected": segment.protected,
    "pau.segment.tokens": segment.tokens,
    "pau.segment.token_count_method": segment.tokenCountMethod,
    "pau.segment.load": segment.pau,
    "pau.segment.density": segment.pigDensity,
    "pau.segment.token_share": segment.tokenShare,
    "pau.segment.load_share": segment.pauShare,
    "pau.segment.duplicate_ratio": segment.duplicateRatio,
    "pau.segment.duplicate_method": segment.duplicateMethod,
    "pau.segment.replay_count": segment.replayCount,
    "pau.segment.replay_count_method": segment.replayCountMethod,
    "pau.segment.replay_tokens": segment.replayTokens,
    "pau.segment.replay_load": segment.replayPAU,
    "pau.segment.structural_pressure": segment.structuralPressureScore,
    "pau.segment.effective_hog_score": segment.effectiveHogScore,
    "pau.segment.hog_severity": segment.hogSeverity,
    "pau.segment.score_confidence": segment.scoreConfidence,
    "pau.segment.utility_method": segment.utilityMethod
  };

  if (segment.source !== undefined) attributes["pau.segment.source"] = segment.source;
  if (segment.duplicateOf !== undefined) attributes["pau.segment.duplicate_of"] = segment.duplicateOf;
  if (segment.contextHogIndex !== null) attributes["pau.segment.hog_index"] = segment.contextHogIndex;
  if (segment.utilityEstimate !== null) attributes["pau.segment.utility"] = segment.utilityEstimate;
  if (segment.retentionTaxPAU !== null) attributes["pau.segment.retention_tax_load"] = segment.retentionTaxPAU;
  if (segment.lifetimeTurns !== null) attributes["pau.segment.lifetime_turns"] = segment.lifetimeTurns;
  if (segment.ageTurns !== null) attributes["pau.segment.age_turns"] = segment.ageTurns;
  return attributes;
}
