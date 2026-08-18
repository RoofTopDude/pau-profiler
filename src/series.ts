import { analyzeTrace } from "./analyzer.js";
import { round } from "./math.js";
import type {
  AnalyzeOptions,
  ContextReceipt,
  PAUTrace,
  TraceSeriesAnalysis,
  TraceSeriesPoint
} from "./types.js";

export function analyzeTraceSeries(
  traces: PAUTrace[],
  options: AnalyzeOptions = {}
): TraceSeriesAnalysis {
  const receipts = traces.map((trace) => analyzeTrace(trace, options));
  const points: TraceSeriesPoint[] = receipts.map((receipt, index) => {
    const previous = receipts[index - 1];
    const point: TraceSeriesPoint = {
      index,
      turn: receipt.turn ?? null,
      totalTokens: receipt.totalTokens,
      totalPAU: receipt.totalPAU,
      replayTokens: receipt.replayTokens,
      contextHealthScore: receipt.contextHealthScore,
      tokenGrowth: previous ? receipt.totalTokens - previous.totalTokens : null,
      pauGrowth: previous ? round(receipt.totalPAU - previous.totalPAU, 2) : null
    };
    if (receipt.runId !== undefined) point.runId = receipt.runId;
    return point;
  });

  return {
    receipts,
    points,
    peakTokens: Math.max(0, ...receipts.map((receipt) => receipt.totalTokens)),
    peakPAU: Math.max(0, ...receipts.map((receipt) => receipt.totalPAU)),
    totalReplayTokens: receipts.reduce((total, receipt) => total + receipt.replayTokens, 0),
    averageHealthScore: receipts.length === 0
      ? 0
      : round(receipts.reduce((total, receipt) => total + receipt.contextHealthScore, 0) / receipts.length, 2),
    fastestGrowingCategory: fastestGrowingCategory(receipts)
  };
}

function fastestGrowingCategory(receipts: ContextReceipt[]): string | null {
  if (receipts.length < 2) return null;
  const first = receipts[0];
  const last = receipts[receipts.length - 1];
  if (!first || !last) return null;
  const firstMap = new Map(first.categories.map((category) => [category.type, category.tokens]));
  let best: { name: string; growth: number } | null = null;
  for (const category of last.categories) {
    const growth = category.tokens - (firstMap.get(category.type) ?? 0);
    if (!best || growth > best.growth) best = { name: category.type, growth };
  }
  return best && best.growth > 0 ? best.name : null;
}
