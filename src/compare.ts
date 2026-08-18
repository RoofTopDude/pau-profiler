import { round, safeRatio } from "./math.js";
import type {
  ContextReceipt,
  MetricDelta,
  NamedMetricDelta,
  ReceiptComparison
} from "./types.js";

export function compareReceipts(
  baseline: ContextReceipt,
  candidate: ContextReceipt
): ReceiptComparison {
  const metrics = {
    totalTokens: delta(baseline.totalTokens, candidate.totalTokens),
    totalPAU: delta(baseline.totalPAU, candidate.totalPAU),
    contextHealthScore: delta(baseline.contextHealthScore, candidate.contextHealthScore),
    replayOverheadRatio: delta(baseline.replayOverheadRatio, candidate.replayOverheadRatio),
    duplicateTokenRatio: delta(baseline.duplicateTokenRatio, candidate.duplicateTokenRatio),
    pigEfficiency: delta(baseline.pigEfficiency, candidate.pigEfficiency),
    maxHogScore: delta(baseline.maxHogScore, candidate.maxHogScore)
  };

  const categoryDeltas = compareNamed(
    baseline.categories.map((category) => ({ name: category.type, value: category.pau })),
    candidate.categories.map((category) => ({ name: category.type, value: category.pau }))
  );
  const sourceDeltas = compareNamed(
    baseline.sources.map((source) => ({ name: source.source, value: source.pau })),
    candidate.sources.map((source) => ({ name: source.source, value: source.pau }))
  );

  const findings = buildFindings(metrics, categoryDeltas, sourceDeltas);
  const positive = [
    signImprovement(metrics.totalTokens, false),
    signImprovement(metrics.totalPAU, false),
    signImprovement(metrics.contextHealthScore, true),
    signImprovement(metrics.replayOverheadRatio, false),
    signImprovement(metrics.duplicateTokenRatio, false),
    signImprovement(metrics.pigEfficiency, true),
    signImprovement(metrics.maxHogScore, false)
  ];
  const improved = positive.filter((value) => value > 0).length;
  const regressed = positive.filter((value) => value < 0).length;
  const verdict = improved > 0 && regressed === 0
    ? "improved"
    : regressed > 0 && improved === 0
      ? "regressed"
      : improved === 0 && regressed === 0
        ? "neutral"
        : "mixed";

  return { verdict, metrics, categoryDeltas, sourceDeltas, findings };
}

function delta(baseline: number | null, candidate: number | null): MetricDelta {
  if (baseline === null || candidate === null) {
    return { baseline, candidate, absolute: null, relative: null };
  }
  const absolute = candidate - baseline;
  return {
    baseline: round(baseline, 4),
    candidate: round(candidate, 4),
    absolute: round(absolute, 4),
    relative: baseline === 0 ? null : round(safeRatio(absolute, baseline), 4)
  };
}

function compareNamed(
  baseline: Array<{ name: string; value: number }>,
  candidate: Array<{ name: string; value: number }>
): NamedMetricDelta[] {
  const names = new Set([...baseline.map((item) => item.name), ...candidate.map((item) => item.name)]);
  const baselineMap = new Map(baseline.map((item) => [item.name, item.value]));
  const candidateMap = new Map(candidate.map((item) => [item.name, item.value]));
  return [...names]
    .map((name) => ({ name, ...delta(baselineMap.get(name) ?? 0, candidateMap.get(name) ?? 0) }))
    .sort((a, b) => Math.abs(b.absolute ?? 0) - Math.abs(a.absolute ?? 0));
}

function signImprovement(metric: MetricDelta, higherIsBetter: boolean): number {
  if (metric.absolute === null || Math.abs(metric.absolute) < 0.0001) return 0;
  const sign = metric.absolute > 0 ? 1 : -1;
  return higherIsBetter ? sign : -sign;
}

function buildFindings(
  metrics: ReceiptComparison["metrics"],
  categories: NamedMetricDelta[],
  sources: NamedMetricDelta[]
): string[] {
  const findings: string[] = [];
  if ((metrics.totalTokens.relative ?? 0) <= -0.05) {
    findings.push(`Physical context fell by ${formatPercent(Math.abs(metrics.totalTokens.relative ?? 0))}.`);
  } else if ((metrics.totalTokens.relative ?? 0) >= 0.05) {
    findings.push(`Physical context increased by ${formatPercent(metrics.totalTokens.relative ?? 0)}.`);
  }
  if ((metrics.replayOverheadRatio.absolute ?? 0) <= -0.03) {
    findings.push("Replay overhead materially improved.");
  } else if ((metrics.replayOverheadRatio.absolute ?? 0) >= 0.03) {
    findings.push("Replay overhead materially regressed.");
  }
  if ((metrics.contextHealthScore.absolute ?? 0) >= 5) {
    findings.push(`Context Health improved by ${metrics.contextHealthScore.absolute} points.`);
  } else if ((metrics.contextHealthScore.absolute ?? 0) <= -5) {
    findings.push(`Context Health declined by ${Math.abs(metrics.contextHealthScore.absolute ?? 0)} points.`);
  }

  const category = categories.find((item) => Math.abs(item.absolute ?? 0) > 0);
  if (category) findings.push(`Largest category PAU change: ${category.name} (${signed(category.absolute ?? 0)} PAU).`);
  const source = sources.find((item) => Math.abs(item.absolute ?? 0) > 0);
  if (source) findings.push(`Largest source PAU change: ${source.name} (${signed(source.absolute ?? 0)} PAU).`);
  if (findings.length === 0) findings.push("No material context utilization change was detected.");
  return findings;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
