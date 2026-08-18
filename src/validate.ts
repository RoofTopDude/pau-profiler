import { contextCategories } from "./profile.js";
import type { PAUTrace, ValidationIssue, ValidationResult } from "./types.js";

const boundedFactors = ["relevance", "density", "authority"] as const;

/**
 * Structural and semantic validation of a PAU trace.
 *
 * Unlike analyzeTrace(), which throws on the first fatal problem, this collects every issue
 * so a harness author can fix a trace in one pass. Errors block analysis; warnings identify
 * measurements that will be degraded or labeled low-confidence.
 */
export function validatePAUTrace(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ path: "$", code: "not-an-object", message: "A PAU trace must be a JSON object." }],
      warnings: [],
      segmentCount: 0
    };
  }

  const trace = input as Partial<PAUTrace> & Record<string, unknown>;

  if (typeof trace.version !== "string" || trace.version.length === 0) {
    errors.push({ path: "$.version", code: "missing-version", message: "version is required." });
  }

  if (!Array.isArray(trace.segments)) {
    return {
      valid: false,
      errors: [
        ...errors,
        { path: "$.segments", code: "missing-segments", message: "segments must be an array." }
      ],
      warnings,
      segmentCount: 0
    };
  }

  if (trace.segments.length === 0) {
    warnings.push({
      path: "$.segments",
      code: "empty-trace",
      message: "The trace contains no segments, so every total will be zero."
    });
  }

  checkPositive(trace.contextWindow, "$.contextWindow", errors);
  if (trace.contextWindow === undefined) {
    warnings.push({
      path: "$.contextWindow",
      code: "no-context-window",
      message: "Without contextWindow, raw and PAU utilization cannot be reported."
    });
  }
  if (trace.analysisMode !== undefined && !["basic", "heuristic"].includes(String(trace.analysisMode))) {
    errors.push({
      path: "$.analysisMode",
      code: "invalid-analysis-mode",
      message: "analysisMode must be basic or heuristic."
    });
  }
  if (trace.traceBoundary === undefined) {
    warnings.push({
      path: "$.traceBoundary",
      code: "no-trace-boundary",
      message: "Declare traceBoundary so readers know where the measurement was taken."
    });
  }

  const ids = new Set<string>();
  let estimatedSegments = 0;

  trace.segments.forEach((raw, index) => {
    const path = `$.segments[${index}]`;
    if (typeof raw !== "object" || raw === null) {
      errors.push({ path, code: "invalid-segment", message: "Each segment must be an object." });
      return;
    }
    const segment = raw as unknown as Record<string, unknown>;

    const id = segment.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push({ path: `${path}.id`, code: "missing-id", message: "id is required and must be non-empty." });
    } else if (ids.has(id)) {
      errors.push({ path: `${path}.id`, code: "duplicate-id", message: `Duplicate segment id: ${id}.` });
    } else {
      ids.add(id);
    }

    if (typeof segment.type !== "string" || !contextCategories.includes(segment.type as never)) {
      errors.push({
        path: `${path}.type`,
        code: "invalid-type",
        message: `type must be one of: ${contextCategories.join(", ")}.`
      });
    }

    if (segment.tokens === undefined && segment.content === undefined) {
      errors.push({
        path,
        code: "no-token-source",
        message: "A segment must supply either tokens or content."
      });
    }
    if (segment.tokens === undefined && typeof segment.content === "string") estimatedSegments += 1;

    checkNonNegative(segment.tokens, `${path}.tokens`, errors);
    checkNonNegative(segment.replayCount, `${path}.replayCount`, errors);
    checkNonNegative(segment.turnAdded, `${path}.turnAdded`, errors);
    checkNonNegative(segment.turnLastSeen, `${path}.turnLastSeen`, errors);
    checkUnitRange(segment.duplicateRatio, `${path}.duplicateRatio`, errors);
    checkUnitRange(segment.utility, `${path}.utility`, errors);
    for (const factor of boundedFactors) {
      checkNonNegative(segment[factor], `${path}.${factor}`, errors);
    }

    if (
      typeof segment.turnAdded === "number"
      && typeof segment.turnLastSeen === "number"
      && segment.turnLastSeen < segment.turnAdded
    ) {
      warnings.push({
        path: `${path}.turnLastSeen`,
        code: "inverted-lifetime",
        message: "turnLastSeen precedes turnAdded; lifetime will be clamped."
      });
    }
  });

  if (estimatedSegments > 0) {
    warnings.push({
      path: "$.segments",
      code: "estimated-tokens",
      message: `${estimatedSegments} segment(s) will use fallback token estimates. `
        + "Supply exact tokens from the provider boundary for reliable accounting."
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    segmentCount: trace.segments.length
  };
}

function checkPositive(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push({ path, code: "not-positive", message: `${path} must be a positive finite number.` });
  }
}

function checkNonNegative(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push({ path, code: "not-non-negative", message: `${path} must be a non-negative finite number.` });
  }
}

function checkUnitRange(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push({ path, code: "not-unit-range", message: `${path} must be between 0 and 1.` });
  }
}
