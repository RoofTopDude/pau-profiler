import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTrace,
  basicProfile,
  heuristicProfile,
  estimateTokens
} from "../dist/index.js";

test("basic profile produces deterministic category-weighted PAU", () => {
  const receipt = analyzeTrace({
    version: "0.1",
    contextWindow: 1000,
    analysisMode: "basic",
    segments: [
      { id: "s", type: "system", tokens: 100 },
      { id: "t", type: "tool", tokens: 100 }
    ]
  }, { profile: basicProfile });

  assert.equal(receipt.totalTokens, 200);
  assert.equal(receipt.totalPAU, 230);
  assert.equal(receipt.rawUtilization, 0.2);
  assert.equal(receipt.pauUtilization, 0.23);
  assert.equal(receipt.pigEfficiency, null);
  assert.equal(receipt.segments[0].protected, true);
});

test("exact repeated content is marked as duplicate and replayed", () => {
  const content = "same tool payload";
  const receipt = analyzeTrace({
    version: "0.1",
    analysisMode: "basic",
    segments: [
      { id: "a", type: "tool", content },
      { id: "b", type: "tool", content }
    ]
  }, { profile: basicProfile });

  assert.equal(receipt.segments[0].duplicateRatio, 0);
  assert.equal(receipt.segments[1].duplicateRatio, 1);
  assert.equal(receipt.segments[1].replayCount, 1);
  assert.ok(receipt.duplicateTokenRatio > 0);
  assert.ok(receipt.replayTokens > 0);
});

test("low-utility large tool output is ranked as a context hog", () => {
  const receipt = analyzeTrace({
    version: "0.1",
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
  assert.ok(hog.recommendations.some((r) => r.includes("selective retrieval")));
});

test("caller can provide an exact tokenizer adapter", () => {
  const receipt = analyzeTrace({
    version: "0.1",
    segments: [{ id: "x", type: "other", content: "abc" }]
  }, { tokenCounter: () => 42 });

  assert.equal(receipt.totalTokens, 42);
  assert.equal(receipt.segments[0].tokenCountMethod, "custom");
});

test("fallback token estimate is deterministic and non-zero", () => {
  assert.equal(estimateTokens("hello world"), estimateTokens("hello world"));
  assert.ok(estimateTokens("hello world") > 0);
  assert.equal(estimateTokens(""), 0);
});

test("health score remains bounded", () => {
  const receipt = analyzeTrace({
    version: "0.1",
    contextWindow: 1000,
    segments: [{ id: "huge", type: "tool", tokens: 5000, utility: 0, replayCount: 10, duplicateRatio: 1 }]
  });
  assert.ok(receipt.contextHealthScore >= 0);
  assert.ok(receipt.contextHealthScore <= 100);
});

test("context hog helper excludes protected segments by default", async () => {
  const { getContextHogs } = await import("../dist/index.js");
  const receipt = analyzeTrace({
    version: "0.1",
    segments: [
      { id: "protected", type: "system", tokens: 50000, utility: 0, protected: true },
      { id: "tool", type: "tool", tokens: 50000, utility: 0, replayCount: 3, duplicateRatio: 1 }
    ]
  });
  const hogs = getContextHogs(receipt, { minScore: 1 });
  assert.ok(hogs.every((segment) => !segment.protected));
  assert.ok(hogs.some((segment) => segment.id === "tool"));
});

test("telemetry export includes receipt and segment metrics", async () => {
  const { toTelemetryAttributes, toSegmentTelemetryAttributes } = await import("../dist/index.js");
  const receipt = analyzeTrace({
    version: "0.1",
    runId: "r1",
    model: "m1",
    segments: [{ id: "x", type: "tool", tokens: 100, utility: 0.5 }]
  });
  const root = toTelemetryAttributes(receipt);
  const segment = toSegmentTelemetryAttributes(receipt.segments[0]);
  assert.equal(root["pau.run.id"], "r1");
  assert.equal(root["gen_ai.request.model"], "m1");
  assert.equal(segment["pau.segment.id"], "x");
});
