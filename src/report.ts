import {
  formatCompact,
  formatCount,
  formatInterval,
  formatPercent,
  formatSigned,
  markdownTable
} from "./format.js";
import type {
  AnalyzedSegment,
  BudgetResult,
  ContextReceipt,
  DisclosureTier,
  OptimizationPlan,
  ReceiptComparison
} from "./types.js";

export interface ReportOptions {
  /**
   * Controls how much is disclosed, following the PAU tiered transparency model.
   *
   * - `user`: aggregate composition only. No segment identifiers or source references.
   * - `developer`: per-source and per-segment metrics, profile version, hog alerts.
   * - `auditor`: everything the developer tier shows plus factor breakdown and uncertainty.
   */
  tier?: DisclosureTier;
  title?: string;
  plan?: OptimizationPlan;
  comparison?: ReceiptComparison;
  budget?: BudgetResult;
  /** Maximum segments listed in the hog table. Defaults to 8. */
  maxSegments?: number;
}

/**
 * Renders a Context Receipt as markdown suitable for a pull-request comment, a CI job
 * summary, or an incident review.
 *
 * The tier gate is the point of this function: the same receipt can be shown to an end user
 * and to an auditor without maintaining two analyses, and without an end-user view leaking
 * source references or segment identifiers.
 */
export function renderReceiptMarkdown(receipt: ContextReceipt, options: ReportOptions = {}): string {
  const tier = options.tier ?? "developer";
  const sections: string[] = [];

  sections.push(`## ${options.title ?? "PAU Context Receipt"}`);
  sections.push(headline(receipt, tier));
  sections.push(summaryTable(receipt, tier));

  if (options.budget) sections.push(budgetSection(options.budget));
  sections.push(compositionSection(receipt));
  sections.push(interactionSection(receipt, tier));

  if (tier !== "user") {
    sections.push(sourceSection(receipt));
    sections.push(hogSection(receipt, options.maxSegments ?? 8));
    sections.push(governanceSection(receipt));
  }

  sections.push(evictionSection(receipt, tier));
  if (options.plan) sections.push(planSection(options.plan, tier));
  if (options.comparison) sections.push(comparisonSection(options.comparison));

  if (tier === "auditor") sections.push(uncertaintySection(receipt));
  if (tier !== "user" && receipt.warnings.length > 0) sections.push(warningSection(receipt));

  sections.push(footer(receipt, tier));

  return sections.filter((section) => section.length > 0).join("\n\n") + "\n";
}

function headline(receipt: ContextReceipt, tier: DisclosureTier): string {
  const health = receipt.contextHealthScore;
  const marker = health >= 75 ? "healthy" : health >= 50 ? "elevated" : "degraded";
  const scope = tier === "user"
    ? "This run's context composition."
    : `Run ${receipt.runId ?? "(unidentified)"} measured at ${receipt.traceBoundary ?? "an undeclared boundary"}.`;
  return `**Context health ${health}/100 (${marker}).** ${scope}`;
}

function summaryTable(receipt: ContextReceipt, tier: DisclosureTier): string {
  const rows: string[][] = [
    ["Physical tokens", formatCount(receipt.totalTokens), formatPercent(receipt.rawUtilization)],
    [
      "Weighted load",
      `${formatCompact(receipt.totalPAU)} PAU`,
      formatPercent(receipt.pauUtilization)
    ],
    ["Duplicated context", formatPercent(receipt.duplicateTokenRatio), "of physical tokens"],
    [
      "Replay overhead",
      `${formatCount(receipt.replayTokens)} tokens`,
      formatPercent(receipt.replayOverheadRatio)
    ]
  ];

  if (tier !== "user") {
    rows.push([
      "PAU interval",
      formatInterval(receipt.pauInterval),
      `${receipt.pauInterval.coverage} sigma`
    ]);
    rows.push([
      "Accounting grade",
      receipt.tokenAccountingGrade,
      receipt.tokenAccountingNote
    ]);
    if (receipt.tokenReconciliation) {
      rows.push([
        "Unattributed tokens",
        formatCount(receipt.tokenReconciliation.unattributedTokens),
        `${formatPercent(receipt.tokenReconciliation.unattributedRatio)} of the provider total`
      ]);
    }
    rows.push([
      "Max hog score",
      `${receipt.maxHogScore.toFixed(1)}/10`,
      `${countHogs(receipt)} segment(s) at or above 6`
    ]);
  }

  if (receipt.pigEfficiency !== null) {
    rows.push(["Pig efficiency", formatPercent(receipt.pigEfficiency), "useful share of load"]);
  }

  return markdownTable(["Measure", "Value", "Context"], rows);
}

function compositionSection(receipt: ContextReceipt): string {
  const rows = receipt.categories.map((category) => [
    category.type,
    formatCount(category.tokens),
    formatPercent(category.tokenShare),
    formatCompact(category.pau),
    formatPercent(category.pauShare)
  ]);
  return [
    "### Composition",
    markdownTable(["Category", "Tokens", "Token share", "PAU", "PAU share"], rows)
  ].join("\n\n");
}

function interactionSection(receipt: ContextReceipt, tier: DisclosureTier): string {
  const interaction = receipt.interaction;
  const lines = [
    "### Interaction pressure",
    `**CII ${interaction.index.toFixed(2)}** (dimensionless). ${interaction.interpretation}`
  ];

  if (tier !== "user") {
    const components = interaction.components;
    lines.push(markdownTable(
      ["Component", "Value", "What it measures"],
      [
        ["Occupancy", components.occupancy.toFixed(2), "Share of the window in use; length degrades use on its own"],
        ["Fragmentation", components.fragmentation.toFixed(2), "Many small pieces cost more to reconcile"],
        ["Evidence spread", components.evidenceSpread.toFixed(2), "Distance between the pieces the task must combine"],
        ["Instruction conflict", components.instructionConflict.toFixed(2), "Competing high-authority sources"],
        ["Redundancy", components.redundancyInterference.toFixed(2), "Repeated material competing with itself"]
      ]
    ));
  }

  lines.push(interaction.statement);
  return lines.join("\n\n");
}

function governanceSection(receipt: ContextReceipt): string {
  const ledger = receipt.governance;
  const rows = ledger.records
    .filter((record) => record.retentionLock)
    .map((record) => [
      `\`${record.segmentId}\``,
      record.authority,
      record.sensitivity,
      record.allowedTransformations.join(", ")
    ]);

  const header = [
    "### Governance ledger",
    `${formatCount(ledger.lockedTokens)} tokens (${formatCompact(ledger.lockedPAU)} PAU) carry a `
    + "retention lock and are excluded from optimization by architecture, not by score."
  ];

  if (rows.length === 0) {
    return [...header, "No segment in this trace carries a retention lock."].join("\n\n");
  }

  return [
    ...header,
    markdownTable(["Segment", "Authority", "Sensitivity", "Permitted"], rows),
    ledger.statement
  ].join("\n\n");
}

function sourceSection(receipt: ContextReceipt): string {
  const rows = receipt.sources.slice(0, 10).map((source) => [
    source.source,
    formatCount(source.tokens),
    formatPercent(source.tokenShare),
    formatCount(source.replayTokens),
    formatPercent(source.duplicateTokenRatio),
    source.maxHogScore.toFixed(1)
  ]);
  return [
    "### Sources",
    markdownTable(
      ["Source", "Tokens", "Share", "Replay tokens", "Duplicated", "Max hog"],
      rows
    )
  ].join("\n\n");
}

function hogSection(receipt: ContextReceipt, limit: number): string {
  const ranked = [...receipt.segments]
    .sort((a, b) => b.effectiveHogScore - a.effectiveHogScore)
    .slice(0, limit);
  if (ranked.length === 0) return "";

  const rows = ranked.map((segment) => [
    `\`${segment.id}\``,
    segment.type,
    formatCount(segment.tokens),
    formatCompact(segment.pau),
    `${segment.effectiveHogScore.toFixed(1)} ${segment.hogSeverity}`,
    segment.scoreConfidence,
    segment.protected ? "protected" : primaryAction(segment)
  ]);

  return [
    "### Context hog ranking",
    markdownTable(
      ["Segment", "Type", "Tokens", "PAU", "Score", "Confidence", "Disposition"],
      rows
    ),
    "A hog score is an investigation priority, not authorization to delete context."
  ].join("\n\n");
}

function evictionSection(receipt: ContextReceipt, tier: DisclosureTier): string {
  const eviction = receipt.eviction;
  const lines = [
    "### Evictable load",
    `Within an estimated quality tolerance of ${formatPercent(eviction.tolerance, 0)}, about ` +
    `**${formatCompact(eviction.evictablePAU)} PAU** (${formatCount(eviction.evictableTokens)} tokens, ` +
    `${formatPercent(eviction.evictableShare)} of weighted load) looks removable, leaving a Pig Efficiency of ` +
    `${formatPercent(eviction.pigEfficiency)}.`
  ];

  if (tier !== "user") {
    lines.push(
      `Method: \`${eviction.method}\` at ${eviction.confidence} confidence. ` +
      `${formatCompact(eviction.protectedPAUExcluded)} PAU of protected context was excluded from consideration.`
    );
    if (eviction.segmentIds.length > 0) {
      lines.push(`Candidates: ${eviction.segmentIds.map((id) => `\`${id}\``).join(", ")}.`);
    }
  }

  lines.push(
    "This is an estimate derived from the declared utility model, not a measured ablation. " +
    "Confirm with controlled replay before enforcing it."
  );
  return lines.join("\n\n");
}

function planSection(plan: OptimizationPlan, tier: DisclosureTier): string {
  if (plan.actions.length === 0) {
    return ["### Optimization plan", `No ${plan.policy} actions were identified.`].join("\n\n");
  }

  const header = [
    "### Optimization plan",
    `Policy \`${plan.policy}\`: ${formatCount(plan.totalCurrentTokenSavings)} tokens in this request and ` +
    `${formatCount(plan.totalFutureReplayTokenSavings)} replay tokens across the run, projecting ` +
    `${formatCount(plan.projectedTotalTokens)} tokens at ${formatPercent(plan.projectedRawUtilization)} utilization.`
  ];

  if (tier === "user") return header.join("\n\n");

  const rows = plan.actions.slice(0, 8).map((action) => [
    `\`${action.segmentId}\``,
    action.action,
    formatCount(action.currentTokenSavings),
    formatCount(action.futureReplayTokenSavings),
    formatPercent(action.qualityRiskProbability, 0),
    action.confidence,
    action.reason
  ]);

  return [
    ...header,
    "Ranked by Removable Load Value: expected savings weighted by the probability that quality "
    + "stays within tolerance, by measurement confidence, and by governance feasibility.",
    markdownTable(
      ["Segment", "Action", "Now", "Replay", "P(safe)", "Confidence", "Rationale"],
      rows
    )
  ].join("\n\n");
}

function comparisonSection(comparison: ReceiptComparison): string {
  const rows = [
    metricRow("Physical tokens", comparison.metrics.totalTokens, 0),
    metricRow("Weighted load", comparison.metrics.totalPAU, 1),
    metricRow("Context health", comparison.metrics.contextHealthScore, 0),
    metricRow("Replay overhead", comparison.metrics.replayOverheadRatio, 3),
    metricRow("Duplicated context", comparison.metrics.duplicateTokenRatio, 3),
    metricRow("Max hog score", comparison.metrics.maxHogScore, 1)
  ];
  return [
    `### Comparison: ${comparison.verdict}`,
    markdownTable(["Metric", "Baseline", "Candidate", "Change"], rows),
    comparison.findings.map((finding) => `- ${finding}`).join("\n")
  ].join("\n\n");
}

function budgetSection(budget: BudgetResult): string {
  if (budget.passed) return "### Budget\n\nAll declared PAU budget thresholds passed.";
  const rows = budget.violations.map((violation) => [
    `\`${violation.metric}\``,
    String(violation.actual),
    String(violation.threshold),
    violation.message
  ]);
  return [
    "### Budget: FAILED",
    markdownTable(["Threshold", "Actual", "Limit", "Detail"], rows)
  ].join("\n\n");
}

function uncertaintySection(receipt: ContextReceipt): string {
  const interval = receipt.pauInterval;
  const lines = [
    "### Uncertainty",
    `Total weighted load is ${formatCompact(receipt.totalPAU)} PAU with a ` +
    `${formatInterval(interval)} PAU interval at ${interval.coverage} sigma ` +
    `(relative sigma ${(interval.sigma * 100).toFixed(1)}%).`,
    `Token counts: ${formatPercent(receipt.estimatedTokenRatio)} of physical tokens were estimated ` +
    "rather than counted by a model tokenizer.",
    "Interval width reflects declared measurement methods, not empirically calibrated error."
  ];
  return lines.join("\n\n");
}

function warningSection(receipt: ContextReceipt): string {
  return ["### Measurement warnings", receipt.warnings.map((w) => `- ${w}`).join("\n")].join("\n\n");
}

function footer(receipt: ContextReceipt, tier: DisclosureTier): string {
  if (tier === "user") {
    return "_Generated by PAU Profiler. Weighted load is an estimate of contextual pressure, " +
      "not a physical measurement._";
  }
  const parts = [
    `profile \`${receipt.profile}\``,
    `mode \`${receipt.analysisMode}\``,
    `schema \`${receipt.schemaVersion}\``
  ];
  if (receipt.model) parts.push(`model \`${receipt.model}\``);
  if (receipt.tokenizer) parts.push(`tokenizer \`${receipt.tokenizer}\``);
  if (receipt.turn !== undefined) parts.push(`turn ${receipt.turn}`);
  parts.push(`utility scope \`${receipt.utilityEffectScope}\``);
  parts.push(`accounting grade \`${receipt.tokenAccountingGrade}\``);
  return `_PAU Profiler - ${parts.join(", ")}. PAU values are comparable only within a profile version._`;
}

function metricRow(
  name: string,
  metric: { baseline: number | null; candidate: number | null; absolute: number | null },
  digits: number
): string[] {
  return [
    name,
    metric.baseline === null ? "n/a" : metric.baseline.toFixed(digits),
    metric.candidate === null ? "n/a" : metric.candidate.toFixed(digits),
    formatSigned(metric.absolute, digits)
  ];
}

function countHogs(receipt: ContextReceipt): number {
  return receipt.segments.filter((segment) => segment.effectiveHogScore >= 6).length;
}

function primaryAction(segment: AnalyzedSegment): string {
  return segment.recommendations[0] === undefined ? "retain" : "review";
}
