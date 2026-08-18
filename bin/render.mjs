import { formatCompact, formatCount, formatInterval, formatPercent } from "../dist/index.js";

const RULE = "-".repeat(72);

export function printReceipt(receipt) {
  const line = (label, value, note = "") =>
    console.log(`${label.padEnd(22)}${String(value).padEnd(24)}${note}`.trimEnd());

  console.log(`PAU CONTEXT RECEIPT${receipt.runId ? ` - ${receipt.runId}` : ""}`);
  console.log(RULE);
  line("Profile", receipt.profile, receipt.analysisMode);
  line("Physical tokens", formatCount(receipt.totalTokens), formatPercent(receipt.rawUtilization));
  line("Weighted load", `${formatCompact(receipt.totalPAU)} PAU`, formatPercent(receipt.pauUtilization));
  line("PAU interval", formatInterval(receipt.pauInterval), `${receipt.pauInterval.coverage} sigma`);
  line("Pig efficiency", formatPercent(receipt.pigEfficiency));
  line("Duplicated context", formatPercent(receipt.duplicateTokenRatio));
  line("Replay overhead", formatPercent(receipt.replayOverheadRatio), `${formatCount(receipt.replayTokens)} tokens`);
  line("Context health", `${receipt.contextHealthScore}/100`);
  line("Max hog score", `${receipt.maxHogScore.toFixed(1)}/10`);
  line("Accounting grade", receipt.tokenAccountingGrade, receipt.tokenAccountingNote);
  if (receipt.tokenReconciliation) {
    line(
      "Unattributed",
      `${formatCount(receipt.tokenReconciliation.unattributedTokens)} tokens`,
      `${formatPercent(receipt.tokenReconciliation.unattributedRatio)} of the provider total`
    );
  }
  line(
    "Interaction (CII)",
    receipt.interaction.index.toFixed(2),
    "dimensionless, reported alongside PAU"
  );
  line(
    "Governance locked",
    `${formatCount(receipt.governance.lockedTokens)} tokens`,
    `${receipt.governance.lockedSegmentIds.length} segment(s), not optimizable`
  );

  const eviction = receipt.eviction;
  line(
    "Evictable load",
    `${formatCompact(eviction.evictablePAU)} PAU`,
    `at ${formatPercent(eviction.tolerance, 0)} tolerance, ${eviction.confidence} confidence`
  );

  console.log("\nCOMPOSITION");
  console.log(RULE);
  for (const category of receipt.categories) {
    console.log(
      `${category.type.padEnd(12)}${formatCount(category.tokens).padStart(9)} tok  `
      + `${formatPercent(category.tokenShare).padStart(6)}  `
      + `${formatCompact(category.pau).padStart(8)} PAU  `
      + `${formatPercent(category.pauShare).padStart(6)}  ${bar(category.pauShare)}`
    );
  }

  const hogs = [...receipt.segments]
    .sort((a, b) => b.effectiveHogScore - a.effectiveHogScore)
    .slice(0, 5);
  if (hogs.length > 0) {
    console.log("\nTOP CONTEXT HOGS");
    console.log(RULE);
    for (const [index, segment] of hogs.entries()) {
      console.log(`${index + 1}. ${segment.id} [${segment.type}]${segment.protected ? " (protected)" : ""}`);
      console.log(
        `   ${formatCount(segment.tokens)} tokens | ${formatCompact(segment.pau)} PAU | `
        + `${segment.effectiveHogScore.toFixed(1)}/10 ${segment.hogSeverity} | ${segment.scoreConfidence} confidence`
      );
      if (segment.recommendations[0]) console.log(`   ${segment.recommendations[0]}`);
    }
  }

  printWarnings(receipt.warnings);
}

export function printPlan(plan) {
  console.log(`PAU OPTIMIZATION PLAN - ${plan.policy}`);
  console.log(RULE);
  console.log(`Current-context savings   ${formatCount(plan.totalCurrentTokenSavings)} tokens`);
  console.log(`Future replay savings     ${formatCount(plan.totalFutureReplayTokenSavings)} tokens`);
  console.log(`Projected context         ${formatCount(plan.projectedTotalTokens)} tokens`);
  console.log(`Projected PAU             ${formatCompact(plan.projectedTotalPAU)} PAU`);
  if (plan.governanceLockedSegments.length > 0) {
    console.log(`Governance-locked         ${plan.governanceLockedSegments.length} segment(s) excluded by authority`);
  }
  if (plan.actions.length === 0) {
    console.log("\nNo actions were identified under this policy.");
    return;
  }
  console.log("");
  for (const action of plan.actions.slice(0, 10)) {
    console.log(`${action.action.toUpperCase()} ${action.segmentId}`);
    console.log(
      `  save ${formatCount(action.currentTokenSavings)} now / `
      + `${formatCount(action.futureReplayTokenSavings)} replay tokens | ${action.confidence} confidence`
    );
    console.log(
      `  value ${formatCompact(action.removableLoadValue)} | `
      + `${formatPercent(action.qualityRiskProbability, 0)} chance quality holds | ${action.transformation}`
    );
    console.log(`  ${action.reason}`);
  }
}

export function printComparison(comparison) {
  console.log(`PAU COMPARISON - ${comparison.verdict.toUpperCase()}`);
  console.log(RULE);
  const metric = (label, delta, digits = 1) => {
    if (delta.baseline === null || delta.candidate === null) return;
    const change = delta.absolute >= 0 ? `+${delta.absolute.toFixed(digits)}` : delta.absolute.toFixed(digits);
    console.log(
      `${label.padEnd(22)}${delta.baseline.toFixed(digits).padStart(12)}`
      + `${delta.candidate.toFixed(digits).padStart(12)}${change.padStart(12)}`
    );
  };
  console.log(`${"METRIC".padEnd(22)}${"BASELINE".padStart(12)}${"CANDIDATE".padStart(12)}${"CHANGE".padStart(12)}`);
  metric("Physical tokens", comparison.metrics.totalTokens, 0);
  metric("Weighted load", comparison.metrics.totalPAU, 1);
  metric("Context health", comparison.metrics.contextHealthScore, 0);
  metric("Replay overhead", comparison.metrics.replayOverheadRatio, 3);
  metric("Duplicated context", comparison.metrics.duplicateTokenRatio, 3);
  metric("Max hog score", comparison.metrics.maxHogScore, 1);
  console.log("");
  for (const finding of comparison.findings) console.log(`- ${finding}`);
}

export function printSeries(series) {
  console.log("PAU TRACE SERIES");
  console.log(RULE);
  console.log(`Runs analyzed         ${series.points.length}`);
  console.log(`Peak physical tokens  ${formatCount(series.peakTokens)}`);
  console.log(`Peak weighted load    ${formatCompact(series.peakPAU)} PAU`);
  console.log(`Cumulative replay     ${formatCount(series.totalReplayTokens)} tokens`);
  console.log(`Average health        ${series.averageHealthScore}/100`);
  console.log(`Fastest growth        ${series.fastestGrowingCategory ?? "none detected"}`);
  console.log("");
  console.log(`${"TURN".padStart(6)}${"TOKENS".padStart(12)}${"PAU".padStart(12)}${"GROWTH".padStart(12)}${"HEALTH".padStart(9)}`);
  for (const point of series.points) {
    const growth = point.tokenGrowth === null
      ? "-"
      : `${point.tokenGrowth >= 0 ? "+" : ""}${formatCount(point.tokenGrowth)}`;
    console.log(
      `${String(point.turn ?? point.index).padStart(6)}`
      + `${formatCount(point.totalTokens).padStart(12)}`
      + `${formatCompact(point.totalPAU).padStart(12)}`
      + `${growth.padStart(12)}`
      + `${String(point.contextHealthScore).padStart(9)}`
    );
  }
}

export function printValidation(result) {
  console.log(result.valid ? "PAU TRACE: VALID" : "PAU TRACE: INVALID");
  console.log(RULE);
  console.log(`Segments              ${result.segmentCount}`);
  console.log(`Errors                ${result.errors.length}`);
  console.log(`Warnings              ${result.warnings.length}`);
  if (result.errors.length > 0) {
    console.log("\nERRORS");
    for (const issue of result.errors) console.log(`- ${issue.path}: ${issue.message}`);
  }
  if (result.warnings.length > 0) {
    console.log("\nWARNINGS");
    for (const issue of result.warnings) console.log(`- ${issue.path}: ${issue.message}`);
  }
}

export function printManifest(manifest) {
  console.log(`PAU PROFILE MANIFEST - ${manifest.identity.profileId}@${manifest.identity.version}`);
  console.log(RULE);
  console.log(`Mode                  ${manifest.identity.mode}`);
  console.log(`Publisher             ${manifest.identity.publisher}`);
  console.log(`Status                ${manifest.identity.status}`);
  if (manifest.identity.description) console.log(`Description           ${manifest.identity.description}`);
  console.log(`Formula               ${manifest.weights.formula}`);
  console.log(`Baseline class        ${manifest.baseline.referenceSegmentClass} @ ${manifest.baseline.normalizationConstant}`);
  console.log(`Protected types       ${manifest.taxonomy.protectedTypes.join(", ")}`);
  console.log("\nBASE WEIGHTS");
  for (const [category, weight] of Object.entries(manifest.weights.baseWeights)) {
    console.log(`  ${category.padEnd(12)}${weight.toFixed(2)}`);
  }
  console.log("\nLIMITATIONS");
  for (const limitation of manifest.governance.limitations) console.log(`- ${limitation}`);
}

export function printBudget(result) {
  console.log(result.passed ? "PAU BUDGET: PASS" : "PAU BUDGET: FAIL");
  console.log(RULE);
  if (result.violations.length === 0) {
    console.log("All declared thresholds were met.");
    return;
  }
  for (const violation of result.violations) {
    console.log(`- ${violation.message}`);
    console.log(`  ${violation.metric}: actual=${violation.actual} threshold=${violation.threshold}`);
  }
}

function printWarnings(warnings) {
  if (warnings.length === 0) return;
  console.log("\nWARNINGS");
  console.log(RULE);
  for (const warning of warnings) console.log(`- ${warning}`);
}

function bar(share, width = 18) {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)));
  return `${"#".repeat(filled)}${".".repeat(width - filled)}`;
}
