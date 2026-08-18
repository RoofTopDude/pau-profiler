import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTrace,
  basicProfile,
  buildOptimizationPlan,
  compareReceipts,
  defaultUncertaintyModel,
  defineProfile,
  describeProfile,
  estimateEvictablePAU,
  formatCompact,
  formatInterval,
  getProfile,
  heuristicProfile,
  markdownTable,
  pigYield,
  renderReceiptMarkdown,
  segmentSigma,
  totalInterval,
  validatePAUTrace
} from "../dist/index.js";

const referenceTrace = {
  version: "0.2",
  runId: "test-run",
  traceBoundary: "final-provider-payload",
  contextWindow: 100_000,
  turn: 6,
  analysisMode: "heuristic",
  segments: [
    { id: "system.policy", type: "system", source: "runtime", tokens: 5000, utility: 0.95, protected: true },
    { id: "user.request", type: "user", source: "chat", tokens: 1000, utility: 1 },
    { id: "tool.dump", type: "tool", source: "github", tokens: 20000, utility: 0.05, relevance: 0.3, replayCount: 4, turnAdded: 2 },
    { id: "rag.docs", type: "rag", source: "index", tokens: 8000, utility: 0.8, relevance: 0.9 }
  ]
};

test("uncertainty widens when tokens are estimated rather than counted", () => {
  const model = defaultUncertaintyModel;
  const exact = segmentSigma({
    pau: 100,
    tokenCountMethod: "provided",
    utilityMethod: "provided",
    relevanceProvided: true,
    densityProvided: true,
    authorityProvided: true,
    appliesFactors: true
  }, model);
  const estimated = segmentSigma({
    pau: 100,
    tokenCountMethod: "estimated",
    utilityMethod: "heuristic",
    relevanceProvided: false,
    densityProvided: false,
    authorityProvided: false,
    appliesFactors: true
  }, model);

  assert.ok(estimated > exact, "estimated tokens must carry more uncertainty than provided tokens");
  assert.ok(exact > 0, "the base weight is itself an engineering parameter, so sigma is never zero");
});

test("basic mode carries less uncertainty because no factors are applied", () => {
  const withFactors = segmentSigma({
    pau: 100,
    tokenCountMethod: "provided",
    utilityMethod: "none",
    relevanceProvided: false,
    densityProvided: false,
    authorityProvided: false,
    appliesFactors: true
  }, defaultUncertaintyModel);
  const withoutFactors = segmentSigma({
    pau: 100,
    tokenCountMethod: "provided",
    utilityMethod: "none",
    relevanceProvided: false,
    densityProvided: false,
    authorityProvided: false,
    appliesFactors: false
  }, defaultUncertaintyModel);

  assert.ok(withoutFactors < withFactors);
});

test("receipt reports a PAU interval that brackets the point estimate", () => {
  const receipt = analyzeTrace(referenceTrace);

  assert.ok(receipt.pauInterval.low < receipt.totalPAU);
  assert.ok(receipt.pauInterval.high > receipt.totalPAU);
  assert.equal(receipt.pauInterval.coverage, 1.96);
  assert.ok(receipt.pauUtilizationInterval !== null);
  assert.ok(receipt.pauUtilizationInterval.low < receipt.pauUtilization);

  for (const segment of receipt.segments) {
    assert.ok(segment.pauInterval.low <= segment.pau);
    assert.ok(segment.pauInterval.high >= segment.pau);
  }
});

test("total interval is narrower than adding every segment worst case", () => {
  const contributions = [
    { pau: 1000, sigma: 0.2 },
    { pau: 1000, sigma: 0.2 },
    { pau: 1000, sigma: 0.2 },
    { pau: 1000, sigma: 0.2 }
  ];
  const combined = totalInterval(contributions, defaultUncertaintyModel);
  const naiveSpread = contributions.reduce(
    (total, item) => total + item.pau * item.sigma * defaultUncertaintyModel.coverage,
    0
  );

  assert.ok(combined.high - 4000 < naiveSpread, "independent errors must partially cancel");
  assert.ok(combined.low >= 0);
});

test("no context window means no utilization interval", () => {
  const receipt = analyzeTrace({ ...referenceTrace, contextWindow: undefined });
  assert.equal(receipt.pauUtilizationInterval, null);
  assert.ok(receipt.pauInterval.high > 0);
});

test("evictable PAU never proposes protected context", () => {
  const receipt = analyzeTrace(referenceTrace);
  const protectedIds = receipt.segments
    .filter((segment) => segment.protected)
    .map((segment) => segment.id);

  assert.ok(protectedIds.length > 0);
  for (const id of receipt.eviction.segmentIds) {
    assert.ok(!protectedIds.includes(id), `${id} is protected and must not be an eviction candidate`);
  }
  assert.ok(receipt.eviction.protectedPAUExcluded > 0);
});

test("evictable PAU targets the low-utility payload first", () => {
  const receipt = analyzeTrace(referenceTrace);
  assert.ok(receipt.eviction.segmentIds.includes("tool.dump"));
  assert.ok(receipt.eviction.estimatedQualityLoss <= receipt.eviction.tolerance);
  assert.equal(receipt.eviction.method, "provided-utility");
});

test("a wider tolerance never frees less load than a narrow one", () => {
  const receipt = analyzeTrace(referenceTrace);
  const narrow = estimateEvictablePAU(receipt, 0.01);
  const wide = estimateEvictablePAU(receipt, 0.4);

  assert.ok(wide.evictablePAU >= narrow.evictablePAU);
  assert.ok(wide.pigEfficiency <= narrow.pigEfficiency);
});

test("eviction falls back to structural ranking with no utility signal", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 50_000,
    analysisMode: "basic",
    segments: [
      { id: "system.policy", type: "system", tokens: 2000 },
      { id: "tool.noise", type: "tool", tokens: 18000, replayCount: 5, turnAdded: 1 }
    ]
  }, { profile: basicProfile });

  assert.equal(receipt.eviction.method, "structural");
  assert.equal(receipt.eviction.confidence, "low");
});

test("eviction tolerance is configurable through analyze options", () => {
  const tight = analyzeTrace(referenceTrace, { evictionTolerance: 0.01 });
  const loose = analyzeTrace(referenceTrace, { evictionTolerance: 0.5 });

  assert.equal(tight.eviction.tolerance, 0.01);
  assert.equal(loose.eviction.tolerance, 0.5);
  assert.ok(loose.eviction.evictablePAU >= tight.eviction.evictablePAU);
});

test("pig yield is null for an empty run and scales with quality", () => {
  assert.equal(pigYield(0, 0.9), null);
  assert.equal(pigYield(10_000, 0.8), 0.08);
});

test("custom profiles inherit core defaults and validate their inputs", () => {
  const profile = defineProfile({
    id: "acme-support",
    version: "1.0",
    baseWeights: { tool: 0.5 },
    protectedTypes: ["system"],
    description: "Support agents."
  });

  assert.equal(profile.baseWeights.tool, 0.5);
  assert.equal(profile.baseWeights.system, 1.5, "unspecified categories inherit core weights");
  assert.deepEqual(profile.protectedTypes, ["system"]);
  assert.equal(profile.uncertainty.coverage, 1.96);

  assert.throws(() => defineProfile({ id: "bad", version: "1.0", baseWeights: { nope: 1 } }), /unknown category/);
  assert.throws(() => defineProfile({ id: "bad", version: "1.0", baseWeights: { tool: -1 } }), /non-negative/);
  assert.throws(() => defineProfile({ id: "", version: "1.0" }), /requires an id/);
});

test("a custom profile changes the resulting PAU", () => {
  const profile = defineProfile({ id: "tool-heavy", version: "1.0", baseWeights: { tool: 2 } });
  const trace = {
    version: "0.2",
    analysisMode: "heuristic",
    segments: [{ id: "t", type: "tool", tokens: 1000 }]
  };

  assert.equal(analyzeTrace(trace, { profile }).totalPAU, 2000);
  assert.equal(analyzeTrace(trace, { profile: heuristicProfile }).totalPAU, 800);
});

test("profile manifest exposes everything needed to interpret a PAU value", () => {
  const manifest = describeProfile(getProfile("coding"));

  assert.equal(manifest.identity.profileId, "pau-coding");
  assert.equal(manifest.baseline.referenceSegmentClass, "user");
  assert.ok(manifest.weights.formula.includes("relevance_i"));
  assert.equal(manifest.weights.baseWeights.code, 1.35);
  assert.ok(manifest.taxonomy.categories.includes("browser"));
  assert.ok(manifest.governance.limitations.length > 0);
  assert.ok(manifest.uncertainty.statement.length > 0);

  const basic = describeProfile(basicProfile);
  assert.equal(basic.weights.formula, "PAU_i = tokens_i * baseWeight_i");
});

test("unknown profile names fail with the list of known profiles", () => {
  assert.throws(() => getProfile("nonexistent"), /Known profiles/);
});

test("validation collects every problem instead of throwing on the first", () => {
  const result = validatePAUTrace({
    segments: [
      { id: "a", type: "system", tokens: 10 },
      { id: "a", type: "system", tokens: 10 },
      { id: "b", type: "not-a-category", tokens: 10 },
      { id: "c", type: "tool" },
      { id: "d", type: "tool", tokens: -5 },
      { id: "e", type: "tool", tokens: 10, utility: 4 }
    ]
  });

  assert.equal(result.valid, false);
  assert.equal(result.segmentCount, 6);
  const codes = result.errors.map((issue) => issue.code);
  assert.ok(codes.includes("missing-version"));
  assert.ok(codes.includes("duplicate-id"));
  assert.ok(codes.includes("invalid-type"));
  assert.ok(codes.includes("no-token-source"));
  assert.ok(codes.includes("not-non-negative"));
  assert.ok(codes.includes("not-unit-range"));
});

test("a valid trace still reports quality warnings", () => {
  const result = validatePAUTrace({
    version: "0.2",
    segments: [{ id: "a", type: "user", content: "hello there" }]
  });

  assert.equal(result.valid, true);
  const codes = result.warnings.map((issue) => issue.code);
  assert.ok(codes.includes("no-context-window"));
  assert.ok(codes.includes("estimated-tokens"));
  assert.ok(codes.includes("no-trace-boundary"));
});

test("validation rejects non-objects", () => {
  assert.equal(validatePAUTrace([]).valid, false);
  assert.equal(validatePAUTrace(null).valid, false);
  assert.equal(validatePAUTrace("{}").valid, false);
});

test("the user disclosure tier withholds segment identifiers and sources", () => {
  const receipt = analyzeTrace(referenceTrace);
  const markdown = renderReceiptMarkdown(receipt, { tier: "user" });

  assert.ok(markdown.includes("Composition"));
  assert.ok(!markdown.includes("tool.dump"), "segment ids must not reach an end-user receipt");
  assert.ok(!markdown.includes("### Sources"));
  assert.ok(!markdown.includes("github"));
  assert.ok(!markdown.includes(receipt.runId));
});

test("the developer tier exposes segments, sources, and hog ranking", () => {
  const receipt = analyzeTrace(referenceTrace);
  const markdown = renderReceiptMarkdown(receipt, {
    tier: "developer",
    plan: buildOptimizationPlan(receipt, "balanced")
  });

  assert.ok(markdown.includes("tool.dump"));
  assert.ok(markdown.includes("### Sources"));
  assert.ok(markdown.includes("### Context hog ranking"));
  assert.ok(markdown.includes("### Optimization plan"));
  assert.ok(markdown.includes(receipt.profile));
});

test("the auditor tier adds uncertainty and measurement warnings", () => {
  const receipt = analyzeTrace(referenceTrace);
  const markdown = renderReceiptMarkdown(receipt, { tier: "auditor" });

  assert.ok(markdown.includes("### Uncertainty"));
  assert.ok(markdown.includes("sigma"));
});

test("markdown reports embed budget and comparison sections when supplied", () => {
  const baseline = analyzeTrace(referenceTrace);
  const candidate = analyzeTrace({
    ...referenceTrace,
    segments: referenceTrace.segments.filter((segment) => segment.id !== "tool.dump")
  });
  const markdown = renderReceiptMarkdown(candidate, {
    comparison: compareReceipts(baseline, candidate),
    budget: { passed: false, violations: [{ metric: "maxHogScore", actual: 9, threshold: 7, message: "Too high." }] }
  });

  assert.ok(markdown.includes("### Budget: FAILED"));
  assert.ok(markdown.includes("### Comparison"));
  assert.ok(markdown.includes("Too high."));
});

test("markdown tables stay well formed with no trailing whitespace", () => {
  const receipt = analyzeTrace(referenceTrace);
  const markdown = renderReceiptMarkdown(receipt, { tier: "auditor" });

  for (const line of markdown.split("\n")) {
    assert.equal(line, line.trimEnd(), `line has trailing whitespace: ${JSON.stringify(line)}`);
    if (line.startsWith("|")) assert.ok(line.endsWith("|"), `malformed table row: ${line}`);
  }
  assert.ok(markdown.endsWith("\n"));
});

test("formatters avoid false precision and handle nulls", () => {
  assert.equal(formatCompact(39_564.83), "39.6k");
  assert.equal(formatCompact(1_250), "1.25k");
  assert.equal(formatCompact(2_400_000), "2.4M");
  assert.equal(formatCompact(null), "n/a");
  assert.equal(formatInterval(null), "n/a");
  assert.equal(formatInterval({ low: 1, high: 1, sigma: 0, coverage: 1.96 }), "exact");
  assert.equal(markdownTable(["a"], [["1"]]), "| a |\n| --- |\n| 1 |");
});
