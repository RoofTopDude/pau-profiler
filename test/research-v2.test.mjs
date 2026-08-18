import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTrace,
  basicProfile,
  buildGovernanceLedger,
  buildOptimizationPlan,
  describeGrade,
  gradeForSegment,
  isTransformationAllowed,
  normalizeTrace,
  reconcileTokens,
  weakestGrade
} from "../dist/index.js";

const trace = {
  version: "0.2",
  runId: "research-v2",
  contextWindow: 100_000,
  turn: 5,
  analysisMode: "heuristic",
  segments: [
    { id: "system.policy", type: "system", source: "runtime", tokens: 5000, utility: 0.95 },
    { id: "developer.rules", type: "developer", source: "app", tokens: 3000, utility: 0.9 },
    { id: "user.request", type: "user", source: "chat", tokens: 900, utility: 1 },
    { id: "history.older", type: "history", source: "conversation", tokens: 9000, utility: 0.4, turnAdded: 1 },
    { id: "tool.dump", type: "tool", source: "github", tokens: 22000, utility: 0.04, relevance: 0.25, replayCount: 4, duplicateRatio: 0.5, turnAdded: 1 },
    { id: "rag.docs", type: "rag", source: "index", tokens: 7000, utility: 0.85, relevance: 0.9 }
  ]
};

// --- Token accounting grade -------------------------------------------------

test("accounting grade reflects the evidence actually available", () => {
  assert.equal(gradeForSegment("provided", true), "A");
  assert.equal(gradeForSegment("provided", false), "B");
  assert.equal(gradeForSegment("custom", false), "C");
  assert.equal(gradeForSegment("estimated", false), "D");
  assert.ok(describeGrade("D").includes("Approximate"));
});

test("a trace is graded by its weakest segment", () => {
  assert.equal(weakestGrade(["A", "A", "B"]), "B");
  assert.equal(weakestGrade(["A", "D", "B"]), "D");
  assert.equal(weakestGrade(["A"]), "A");
});

test("declared tokens without a provider total grade B, not A", () => {
  const receipt = analyzeTrace(trace);
  assert.equal(receipt.tokenAccountingGrade, "B");
  assert.equal(receipt.tokenReconciliation, null);
});

test("estimated tokens drag the whole trace down to grade D", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    analysisMode: "basic",
    segments: [
      { id: "a", type: "user", tokens: 500 },
      { id: "b", type: "tool", content: "some tool output that has to be estimated" }
    ]
  }, { profile: basicProfile });

  assert.equal(receipt.tokenAccountingGrade, "D");
  assert.equal(receipt.segments[0].tokenAccountingGrade, "B");
  assert.equal(receipt.segments[1].tokenAccountingGrade, "D");
});

test("reconciliation exposes tokens the harness never attributed", () => {
  const result = reconcileTokens(55_500, 56_400);
  assert.equal(result.unattributedTokens, 900);
  assert.equal(result.reconciled, true);

  const wide = reconcileTokens(40_000, 55_000);
  assert.equal(wide.reconciled, false, "a 27% gap is not a reconciliation");
  assert.equal(reconcileTokens(1000, undefined), null);
});

test("a reconciled provider total upgrades the trace to grade A", () => {
  const attributed = trace.segments.reduce((total, segment) => total + segment.tokens, 0);
  const receipt = analyzeTrace({ ...trace, providerTokenTotal: attributed + 400 });

  assert.equal(receipt.tokenAccountingGrade, "A");
  assert.equal(receipt.tokenReconciliation.unattributedTokens, 400);
});

test("provider usage blocks are picked up by the message adapters", () => {
  const normalized = normalizeTrace({
    messages: [
      { role: "system", content: "policy" },
      { role: "user", content: "do the thing" }
    ],
    usage: { prompt_tokens: 4321 }
  }, { format: "openai" });

  assert.equal(normalized.providerTokenTotal, 4321);
});

// --- Context Interaction/Interference Index ---------------------------------

test("CII is dimensionless and reports every component", () => {
  const receipt = analyzeTrace(trace);
  const interaction = receipt.interaction;

  assert.equal(interaction.dimensionless, true);
  assert.ok(interaction.index >= 0 && interaction.index <= 1);
  for (const value of Object.values(interaction.components)) {
    assert.ok(value >= 0 && value <= 1, "every component stays in [0,1]");
  }
  assert.ok(interaction.statement.includes("not convertible"));
});

test("CII is never folded into the PAU total", () => {
  const receipt = analyzeTrace(trace);
  const summed = receipt.segments.reduce((total, segment) => total + segment.pau, 0);
  assert.ok(Math.abs(receipt.totalPAU - summed) < 0.5, "PAU stays additive over segments");
  assert.ok(receipt.interaction.index > 0, "and CII is reported separately");
});

test("higher occupancy raises interaction pressure", () => {
  const roomy = analyzeTrace({ ...trace, contextWindow: 400_000 });
  const cramped = analyzeTrace({ ...trace, contextWindow: 50_000 });
  assert.ok(cramped.interaction.components.occupancy > roomy.interaction.components.occupancy);
  assert.ok(cramped.interaction.index > roomy.interaction.index);
});

test("competing instruction sources register as conflict", () => {
  const single = analyzeTrace({
    version: "0.2",
    contextWindow: 50_000,
    segments: [
      { id: "s1", type: "system", source: "runtime", tokens: 100 },
      { id: "u", type: "user", source: "chat", tokens: 100 }
    ]
  });
  const competing = analyzeTrace({
    version: "0.2",
    contextWindow: 50_000,
    segments: [
      { id: "s1", type: "system", source: "runtime", tokens: 100 },
      { id: "s2", type: "system", source: "injected-policy", tokens: 100 },
      { id: "s3", type: "developer", source: "plugin", tokens: 100 },
      { id: "u", type: "user", source: "chat", tokens: 100 }
    ]
  });

  assert.equal(single.interaction.components.instructionConflict, 0);
  assert.ok(competing.interaction.components.instructionConflict > 0);
});

// --- Governance ledger ------------------------------------------------------

test("governance classifies authority independently of measured value", () => {
  const receipt = analyzeTrace(trace);
  const byId = new Map(receipt.governance.records.map((record) => [record.segmentId, record]));

  assert.equal(byId.get("system.policy").authority, "mandatory-policy");
  assert.equal(byId.get("developer.rules").authority, "application-instruction");
  assert.equal(byId.get("user.request").authority, "current-user");
  assert.equal(byId.get("tool.dump").authority, "untrusted-external");
  assert.equal(byId.get("history.older").authority, "advisory");
});

test("mandatory policy permits retention and nothing else", () => {
  const receipt = analyzeTrace(trace);
  const ledger = receipt.governance;

  assert.deepEqual(
    ledger.records.find((record) => record.segmentId === "system.policy").allowedTransformations,
    ["retain"]
  );
  assert.equal(isTransformationAllowed(ledger, "system.policy", "evict"), false);
  assert.equal(isTransformationAllowed(ledger, "system.policy", "summarize"), false);
  assert.equal(isTransformationAllowed(ledger, "system.policy", "retain"), true);
  assert.equal(isTransformationAllowed(ledger, "tool.dump", "evict"), true);
});

test("a rarely-useful safety segment stays locked regardless of its score", () => {
  // The scenario the two-ledger split exists for: a constraint that almost never fires will
  // look worthless to any evaluation over routine traffic. That must not unlock deletion.
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 60_000,
    analysisMode: "heuristic",
    segments: [
      { id: "system.rare-safety-rule", type: "system", source: "safety", tokens: 9000, utility: 0.001, relevance: 0.01 },
      { id: "user.request", type: "user", source: "chat", tokens: 500, utility: 1 },
      { id: "tool.payload", type: "tool", source: "api", tokens: 12000, utility: 0.3 }
    ]
  });

  const record = receipt.governance.records.find((entry) => entry.segmentId === "system.rare-safety-rule");
  assert.equal(record.retentionLock, true);
  assert.equal(record.mandatory, true);
  assert.deepEqual(record.allowedTransformations, ["retain"]);

  const plan = buildOptimizationPlan(receipt, "aggressive");
  assert.ok(!plan.actions.some((action) => action.segmentId === "system.rare-safety-rule"));
  assert.ok(plan.governanceLockedSegments.includes("system.rare-safety-rule"));
  assert.ok(!receipt.eviction.segmentIds.includes("system.rare-safety-rule"));
});

test("the governance ledger totals locked load", () => {
  const receipt = analyzeTrace(trace);
  assert.equal(receipt.governance.lockedTokens, 8900);
  assert.ok(receipt.governance.lockedPAU > 0);
  assert.deepEqual(
    receipt.governance.lockedSegmentIds.sort(),
    ["developer.rules", "system.policy", "user.request"]
  );
});

test("an explicit authorityClass overrides the category default", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 50_000,
    segments: [
      { id: "memory.pinned", type: "memory", tokens: 2000, authorityClass: "mandatory-policy" },
      { id: "system.demoted", type: "system", tokens: 2000, authorityClass: "advisory" }
    ]
  });
  const byId = new Map(receipt.governance.records.map((record) => [record.segmentId, record]));

  assert.equal(byId.get("memory.pinned").retentionLock, true);
  assert.equal(byId.get("system.demoted").authority, "advisory");
  assert.equal(byId.get("system.demoted").retentionLock, false);
});

test("sensitivity defaults to internal and is carried through", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    segments: [
      { id: "a", type: "memory", tokens: 100 },
      { id: "b", type: "memory", tokens: 100, sensitivity: "regulated" }
    ]
  });
  const byId = new Map(receipt.governance.records.map((record) => [record.segmentId, record]));
  assert.equal(byId.get("a").sensitivity, "internal");
  assert.equal(byId.get("b").sensitivity, "regulated");
});

test("the ledger can be built directly from working segments", () => {
  const ledger = buildGovernanceLedger(
    [{ input: { id: "x", type: "tool" }, tokens: 100, pau: 80, protected: false }],
    basicProfile
  );
  assert.equal(ledger.records[0].authority, "untrusted-external");
  assert.equal(ledger.lockedTokens, 0);
  assert.ok(ledger.statement.includes("never from a measured score"));
});

// --- Removable Load Value ---------------------------------------------------

test("every action carries a removable load value and a governance transformation", () => {
  const receipt = analyzeTrace(trace);
  const plan = buildOptimizationPlan(receipt, "balanced");

  assert.ok(plan.actions.length > 0);
  for (const action of plan.actions) {
    assert.ok(Number.isFinite(action.removableLoadValue));
    assert.ok(action.removableLoadValue >= 0);
    assert.ok(action.qualityRiskProbability >= 0 && action.qualityRiskProbability <= 1);
    assert.ok(typeof action.transformation === "string");
  }
});

test("actions are ranked by removable load value", () => {
  const plan = buildOptimizationPlan(analyzeTrace(trace), "balanced");
  for (let index = 1; index < plan.actions.length; index += 1) {
    assert.ok(
      plan.actions[index - 1].removableLoadValue >= plan.actions[index].removableLoadValue,
      "the plan must be sorted by action value"
    );
  }
});

test("RLV stays finite where a hog ratio would diverge", () => {
  // Utility approaching zero is exactly where a cost/utility ratio becomes unstable. RLV puts
  // utility in the numerator instead, so the same segment produces a bounded, confident value.
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 80_000,
    analysisMode: "heuristic",
    segments: [
      { id: "user.request", type: "user", tokens: 500, utility: 1 },
      { id: "tool.worthless", type: "tool", source: "api", tokens: 30000, utility: 0.0000001, relevance: 0.01, replayCount: 3 }
    ]
  });

  const action = buildOptimizationPlan(receipt, "balanced").actions
    .find((entry) => entry.segmentId === "tool.worthless");

  assert.ok(action, "a near-zero-utility payload should still produce an action");
  assert.ok(Number.isFinite(action.removableLoadValue));
  assert.ok(action.qualityRiskProbability > 0.9, "removing worthless context is low risk");
});

test("high-value context yields a low removal probability", () => {
  const receipt = analyzeTrace({
    version: "0.2",
    contextWindow: 60_000,
    analysisMode: "heuristic",
    segments: [
      { id: "user.request", type: "user", tokens: 400, utility: 1 },
      { id: "rag.decisive", type: "rag", source: "index", tokens: 20000, utility: 0.98, relevance: 0.99, replayCount: 2 },
      { id: "tool.noise", type: "tool", source: "api", tokens: 20000, utility: 0.02, relevance: 0.05, replayCount: 2 }
    ]
  });
  const plan = buildOptimizationPlan(receipt, "aggressive");
  const decisive = plan.actions.find((entry) => entry.segmentId === "rag.decisive");
  const noise = plan.actions.find((entry) => entry.segmentId === "tool.noise");

  assert.ok(noise, "the low-value payload should be actionable");
  if (decisive) {
    assert.ok(
      decisive.qualityRiskProbability < noise.qualityRiskProbability,
      "removing decisive evidence must look riskier than removing noise"
    );
  }
});

// --- Effect scope -----------------------------------------------------------

test("utility effect scope defaults to local and is preserved when declared", () => {
  assert.equal(analyzeTrace(trace).utilityEffectScope, "local");
  assert.equal(analyzeTrace({ ...trace, utilityEffectScope: "run" }).utilityEffectScope, "run");
  assert.equal(analyzeTrace({ ...trace, utilityEffectScope: "policy" }).utilityEffectScope, "policy");
});
