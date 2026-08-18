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
    "pau.tokens.physical": receipt.totalTokens,
    "pau.load": receipt.totalPAU,
    "pau.duplicate_token_ratio": receipt.duplicateTokenRatio,
    "pau.replay.tokens": receipt.replayTokens,
    "pau.replay.overhead_ratio": receipt.replayOverheadRatio,
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
  if (receipt.turn !== undefined) attributes["pau.turn"] = receipt.turn;

  return attributes;
}

export function toSegmentTelemetryAttributes(segment: AnalyzedSegment): TelemetryAttributes {
  const attributes: TelemetryAttributes = {
    "pau.segment.id": segment.id,
    "pau.segment.type": segment.type,
    "pau.segment.protected": segment.protected,
    "pau.segment.tokens": segment.tokens,
    "pau.segment.load": segment.pau,
    "pau.segment.density": segment.pigDensity,
    "pau.segment.token_share": segment.tokenShare,
    "pau.segment.load_share": segment.pauShare,
    "pau.segment.duplicate_ratio": segment.duplicateRatio,
    "pau.segment.replay_count": segment.replayCount,
    "pau.segment.structural_pressure": segment.structuralPressureScore,
    "pau.segment.hog_severity": segment.hogSeverity
  };

  if (segment.source !== undefined) attributes["pau.segment.source"] = segment.source;
  if (segment.contextHogIndex !== null) attributes["pau.segment.hog_index"] = segment.contextHogIndex;
  if (segment.utilityEstimate !== null) attributes["pau.segment.utility"] = segment.utilityEstimate;
  return attributes;
}
