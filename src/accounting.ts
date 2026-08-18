import { round, safeRatio } from "./math.js";
import type {
  AnalyzedSegment,
  TokenAccountingGrade,
  TokenCountMethod,
  TokenReconciliation
} from "./types.js";

/**
 * Token Accounting Grade.
 *
 * The original PAU compliance language required exact per-segment token counts under the
 * tokenizer actually used. That is the right target and the wrong requirement: providers do
 * not uniformly expose their hidden serialization, so a harness can rarely prove segment-level
 * exactness. Grading the evidence is more honest than asserting precision that is unavailable.
 *
 * - `A` Provider aggregate reconciles with harness segment attribution.
 * - `B` Exact counts from a declared local tokenizer and serialization.
 * - `C` Provider-equivalent tokenizer estimate; hidden template differences are possible.
 * - `D` Approximate tokenizer or modality conversion.
 */
export function gradeForSegment(
  method: TokenCountMethod,
  providerReconciled: boolean
): TokenAccountingGrade {
  if (method === "provided") return providerReconciled ? "A" : "B";
  if (method === "custom") return "C";
  return "D";
}

const gradeOrder: Record<TokenAccountingGrade, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * A trace is graded by its weakest segment. A comparison must never imply higher fidelity
 * than the least reliable measurement it contains.
 */
export function weakestGrade(grades: TokenAccountingGrade[]): TokenAccountingGrade {
  return grades.reduce<TokenAccountingGrade>(
    (worst, grade) => (gradeOrder[grade] > gradeOrder[worst] ? grade : worst),
    "A"
  );
}

export function describeGrade(grade: TokenAccountingGrade): string {
  switch (grade) {
    case "A": return "Provider aggregate reconciles with segment attribution.";
    case "B": return "Exact counts from a declared local tokenizer and serialization.";
    case "C": return "Provider-equivalent tokenizer estimate; hidden template differences possible.";
    default: return "Approximate tokenizer or modality conversion; treat totals as indicative.";
  }
}

/**
 * Compares what the harness attributed to segments against what the provider reported.
 *
 * The gap is the interesting number: it is the chat template, tool schemas, protocol wrappers,
 * and anything else the harness never saw. Reporting it keeps unattributed context visible
 * instead of silently absorbing it into the segment totals.
 */
export function reconcileTokens(
  attributedTokens: number,
  providerTotal: number | undefined,
  tolerance = 0.02
): TokenReconciliation | null {
  if (providerTotal === undefined) return null;
  const difference = providerTotal - attributedTokens;
  const relativeDifference = safeRatio(Math.abs(difference), providerTotal);
  return {
    providerTotal,
    attributedTotal: attributedTokens,
    unattributedTokens: difference,
    unattributedRatio: round(safeRatio(difference, providerTotal)),
    reconciled: relativeDifference <= tolerance,
    tolerance
  };
}

export function segmentGrades(
  segments: Array<{ tokenCountMethod: TokenCountMethod }>,
  providerReconciled: boolean
): TokenAccountingGrade[] {
  return segments.map((segment) => gradeForSegment(segment.tokenCountMethod, providerReconciled));
}

export function gradeDistribution(
  segments: AnalyzedSegment[]
): Record<TokenAccountingGrade, number> {
  const distribution: Record<TokenAccountingGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const segment of segments) distribution[segment.tokenAccountingGrade] += segment.tokens;
  return distribution;
}
