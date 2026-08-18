import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTrace,
  analyzeTraceSeries,
  anthropicToTrace,
  basicProfile,
  buildOptimizationPlan,
  compareReceipts,
  estimateTokens,
  evaluateBudget,
  getContextHogs,
  heuristicProfile,
  normalizeTrace,
  openAIToTrace,
  toSegmentTelemetryAttributes,
  toTelemetryAttributes
} from "../dist/index.js";

test("basic profile produces deterministic category-weighted PAU", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 1000,
    analysisMode: "basic",
    segments: [
      { id: "s", type: "system", tokens: 100 },
      { id: "t", type: "tool", tokens: 100 }
    ]
  }, { profile: basicProfile });

  assert.equal(receipt.schemaVersion, "0.2");
  assert.equal(receipt.totalTokens, 200);
  assert.equal(receipt.totalPAU, 230);
  assert.equal(receipt.rawUtilization, 0.2);
  assert.equal(receipt.pauUtilization, 0.23);
  assert.equal(receipt.pigEfficiency, null);
  assert.equal(receipt.segments[0].protected, true);
});

test("exact duplicate detection is distinct from cross-turn replay", () => {
  const content = "same tool payload";
  const receipt = analyzeTrace({
    version: "0.2",
    analysisMode: "basic",
    segments: [
      { id: "a", type: "tool", content },
      { id: "b", type: "tool", content }
    ]
  }, { profile: basicProfile });

  assert.equal(receipt.segments[0].duplicateRatio, 0);
  assert.equal(receipt.segments[1].duplicateRatio, 1);
  assert.equal(receipt.segments[1].duplicateMethod, "exact");
  assert.equal(receipt.segments[1].duplicateOf, "a");
  assert.equal(receipt.segments[1].replayCount, 0);
  assert.ok(receipt.duplicateTokenRatio > 0);
});

test("near duplicate detector identifies locally similar payloads", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    segments: [
      { id: "a", type: "tool", content: "customer id status amount region created at owner account" },
      { id: "b", type: "tool", content: "customer id status amount region created at owner account metadata" }
    ]
  }, { nearDuplicates: { threshold: 0.6, shingleSize: 2 } });

  assert.equal(receipt.segments[1].duplicateMethod, "near");
  assert.equal(receipt.segments[1].duplicateOf, "a");
  assert.ok(receipt.segments[1].duplicateRatio >= 0.6);
});

test("replay count and lifetime can be inferred from turn metadata", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    turn: 7,
    segments: [{ id: "x", type: "memory", tokens: 100, turnAdded: 3 }]
  });
  const segment = receipt.segments[0];
  assert.equal(segment.replayCount, 4);
  assert.equal(segment.replayCountMethod, "inferred");
  assert.equal(segment.lifetimeTurns, 5);
  assert.equal(segment.ageTurns, 4);
  assert.equal(segment.replayTokens, 400);
});

test("low-utility large tool output is ranked as a context hog", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 100000,
    analysisMode: "heuristic",
    segments: [
      { id: "system", type: "system", tokens: 8000, utility: 1, protected: true },
      { id: "tool-hog", type: "tool", tokens: 30000, utility: 0.05, replayCount: 3, duplicateRatio: 0.5 },
      { id: "rag-good", type: "rag", tokens: 10000, utility: 0.9 }
    ]
  }, { profile: heuristicProfile });

  const hog = receipt.segments.find((segment) => segment.id === "tool-hog");
  const system = receipt.segments.find((segment) => segment.id === "system");
  assert.ok(hog.contextHogIndex > system.contextHogIndex);
  assert.ok(hog.contextHogIndex >= 8);
  assert.ok(hog.recommendations.some((recommendation) => recommendation.includes("selective retrieval")));
  assert.ok(receipt.sources.some((source) => source.source === "tool"));
});

test("caller can provide an exact tokenizer adapter", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    segments: [{ id: "x", type: "other", content: "abc" }]
  }, { tokenCounter: () => 42 });

  assert.equal(receipt.totalTokens, 42);
  assert.equal(receipt.segments[0].tokenCountMethod, "custom");
  assert.equal(receipt.estimatedTokenRatio, 0);
});

test("fallback token estimate is deterministic and non-zero", () => {
  assert.equal(estimateTokens("hello world"), estimateTokens("hello world"));
  assert.ok(estimateTokens("hello world") > 0);
  assert.equal(estimateTokens(""), 0);
});

test("OpenAI adapter maps the current user separately from history and tools", () => {
  const trace = openAIToTrace({
    model: "example",
    messages: [
      { role: "system", content: "policy" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "tool", name: "search", content: "large result" },
      { role: "user", content: "current question" }
    ]
  }, { contextWindow: 128000 });

  assert.deepEqual(trace.segments.map((segment) => segment.type), ["system", "history", "history", "tool", "user"]);
  assert.equal(trace.model, "example");
  assert.equal(trace.contextWindow, 128000);
});

test("Anthropic adapter splits tool result blocks from text", () => {
  const trace = anthropicToTrace({
    system: "policy",
    messages: [
      { role: "assistant", content: [{ type: "tool_use", name: "read", input: { path: "a" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }, { type: "text", text: "continue" }] }
    ]
  });

  assert.ok(trace.segments.some((segment) => segment.type === "tool"));
  assert.ok(trace.segments.some((segment) => segment.type === "user"));
  assert.equal(normalizeTrace(trace).segments.length, trace.segments.length);
});

test("optimization plan never targets protected context", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 100000,
    segments: [
      { id: "policy", type: "system", tokens: 30000, utility: 0.1, protected: true },
      { id: "dump", type: "tool", tokens: 30000, utility: 0.05, replayCount: 3, duplicateRatio: 0.7 }
    ]
  });
  const plan = buildOptimizationPlan(receipt, "balanced");
  assert.ok(plan.actions.some((action) => action.segmentId === "dump"));
  assert.ok(plan.actions.every((action) => action.segmentId !== "policy"));
  assert.ok(plan.totalCurrentTokenSavings > 0);
  assert.ok(plan.projectedTotalTokens < receipt.totalTokens);
});

test("budget evaluator returns actionable violations", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 1000,
    segments: [{ id: "huge", type: "tool", tokens: 900, utility: 0, replayCount: 4 }]
  });
  const budget = evaluateBudget(receipt, { maxReplayOverheadRatio: 0.2, minContextHealthScore: 80 });
  assert.equal(budget.passed, false);
  assert.ok(budget.violations.length >= 1);
});

test("receipt comparison identifies a cleaner candidate", () => {
  const baseline = analyzeTrace({
    version: "0.2",
    contextWindow: 100000,
    segments: [{ id: "tool", type: "tool", tokens: 50000, utility: 0.1, replayCount: 3, duplicateRatio: 0.5 }]
  });
  const candidate = analyzeTrace({
    version: "0.2",
    contextWindow: 100000,
    segments: [{ id: "tool", type: "tool", tokens: 10000, utility: 0.8 }]
  });
  const comparison = compareReceipts(baseline, candidate);
  assert.equal(comparison.verdict, "improved");
  assert.ok(comparison.metrics.totalTokens.absolute < 0);
  assert.ok(comparison.findings.length > 0);
});

test("trace series reports growth and fastest-growing category", () => {
  const series = analyzeTraceSeries([
    { version: "0.2", turn: 1, segments: [{ id: "a", type: "history", tokens: 100 }] },
    { version: "0.2", turn: 2, segments: [{ id: "a", type: "history", tokens: 300 }] }
  ]);
  assert.equal(series.points[1].tokenGrowth, 200);
  assert.equal(series.fastestGrowingCategory, "history");
});

test("context hog helper excludes protected segments by default", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    segments: [
      { id: "protected", type: "system", tokens: 50000, utility: 0, protected: true },
      { id: "tool", type: "tool", tokens: 50000, utility: 0, replayCount: 3, duplicateRatio: 1 }
    ]
  });
  const hogs = getContextHogs(receipt, { minScore: 1 });
  assert.ok(hogs.every((segment) => !segment.protected));
  assert.ok(hogs.some((segment) => segment.id === "tool"));
});

test("telemetry export includes receipt and segment metrics", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    runId: "r1",
    model: "m1",
    segments: [{ id: "x", type: "tool", tokens: 100, utility: 0.5 }]
  });
  const root = toTelemetryAttributes(receipt);
  const segment = toSegmentTelemetryAttributes(receipt.segments[0]);
  assert.equal(root["pau.run.id"], "r1");
  assert.equal(root["gen_ai.request.model"], "m1");
  assert.equal(segment["pau.segment.id"], "x");
  assert.equal(segment["pau.segment.utility_method"], "provided");
});
