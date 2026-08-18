# PAU Profiler

[![CI](https://github.com/RoofTopDude/pau-profiler/actions/workflows/ci.yml/badge.svg)](https://github.com/RoofTopDude/pau-profiler/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![Spec](https://img.shields.io/badge/spec-PAU%20Core%200.3-8b5cf6.svg)](spec/PAU-SPEC.md)

**Pig Adjustable Units (PAU)** is a local-first, open-source context utilization profiler for AI agents and LLM applications.

Tokens tell you how much context is present. PAU adds an auditable accounting layer for the harder questions:

> What is consuming the context budget, what is being duplicated or replayed, which segments are creating disproportionate pressure, and what can the harness change safely?

**Live profiler:** https://rooftopdude.github.io/pau-profiler/  
**Specification:** [`spec/PAU-SPEC.md`](spec/PAU-SPEC.md)

The core library and browser profiler make no network requests. Analysis runs against the data you provide and returns a machine-readable **Context Receipt** with the full factor breakdown.

## Quick start

```bash
npm install
npm test

# Where is the context going?
node bin/pau.mjs analyze examples/research-agent.json

# What can safely change?
node bin/pau.mjs plan examples/research-agent.json --policy balanced

# Fail a build when the harness regresses.
node bin/pau.mjs check examples/research-agent.json --max-hog-score 7 --min-health 65
```

## What it measures

PAU keeps four questions apart instead of collapsing them into one number.

| Question | Answer |
| --- | --- |
| What physically occupies the window? | Tokens, per segment and per source, with an accounting grade |
| How much decision pressure is that? | PAU, with an uncertainty interval |
| What keeps accumulating? | Duplication, replay, retention tax, lifetime |
| What is the system obliged to keep? | The governance ledger, computed independently of any score |

### Two ledgers

The measurement ledger records what context cost and what it appeared to contribute. The **governance ledger** records what the system must preserve: authority class, sensitivity, retention locks, and permitted transformations. They are computed independently and combined only at the policy layer, in one direction — governance constrains action, measurement never unlocks it.

This matters more than it may sound. A safety constraint that fires in one run out of a thousand looks worthless to any evaluation over routine traffic. That is a fact about the traffic, not permission to delete the constraint. The optimizer consults permitted transformations *before* it reads any score, so no measurement can make a locked segment actionable.

### Capabilities in 0.3

- PAU load, Conditional Pig Density, raw and PAU utilization, and Context Health;
- **uncertainty intervals** on every segment and total, propagated from declared measurement methods;
- **Token Accounting Grade (A-D)** and provider reconciliation, exposing tokens the harness never attributed;
- **governance ledger** with authority classes, retention locks, and permitted transformations;
- **Context Interaction/Interference Index (CII)** for nonlocal burden, reported alongside PAU and never added to it;
- **evictable PAU and Pig Efficiency at a declared quality tolerance**;
- **Removable Load Value** ranking for optimization actions, stable where a hog ratio diverges;
- Context Hog Index for triage, with confidence labels and per-segment explanations;
- exact and local near-duplicate detection, kept separate from cross-turn replay;
- **effect scope** labeling (`local`, `run`, `policy`) on every utility claim;
- **markdown receipts with disclosure tiers** for end users, developers, and auditors;
- **custom profiles** and PAU Core profile manifests;
- **structured trace validation** that collects every problem in one pass;
- OpenAI-style and Anthropic-style message adapters, including provider `usage` blocks;
- coding, RAG, browser, basic, and heuristic measurement profiles;
- run-to-run regression comparison and multi-turn trace-series growth analysis;
- enforceable context budgets for CI, with config-file support;
- OpenTelemetry-friendly `pau.*` attributes;
- a zero-service CLI and a browser-only GitHub Pages profiler.

PAU remains an experimental measurement proposal. Reference weights are versioned engineering parameters, not universal measurements of literal model attention or cognition. It is not ready for billing, contractual service levels, or cross-system scorecards; see [release gates](spec/PAU-SPEC.md#211-release-gates).

## Install and build

```bash
npm install
npm test
```

Build the package:

```bash
npm run build
```

Build the static website:

```bash
npm run build:site
```

The website is written to `site-dist/` and can be served by any static host.

## CLI

| Command | Purpose |
| --- | --- |
| `analyze` | Context receipt: load, composition, hogs, evictable PAU |
| `plan` | Governance-safe optimization plan ranked by Removable Load Value |
| `compare` | Run-to-run regression comparison |
| `check` | Enforce budget thresholds; exits 2 on violation |
| `series` | Multi-turn growth and replay accumulation |
| `report` | Markdown receipt for a PR comment or job summary |
| `validate` | Structural validation; exits 2 when invalid |
| `profile` | PAU Core profile manifest |
| `convert` | Normalize provider messages into a PAU trace |

```bash
# Any path may be "-" to read from stdin.
cat payload.json | node bin/pau.mjs analyze - --format openai --context-window 128000

# Watch context accumulate across an agent loop.
node bin/pau.mjs series examples/series/turn-*.json

# A markdown receipt for a pull-request comment.
node bin/pau.mjs report trace.json --tier developer --out receipt.md

# What does this profile actually mean?
node bin/pau.mjs profile coding
```

Every command supports `--json`; most support `--markdown` with `--tier user|developer|auditor`. Run `node bin/pau.mjs help` for the complete surface.

### Configuration

Repeating threshold flags across CI jobs gets unwieldy, so the CLI reads `pau.config.json` or `.paurc.json` from the working directory, or an explicit `--config` path. Flags always override the file.

```json
{
  "profile": "coding",
  "contextWindow": 128000,
  "policy": "balanced",
  "tier": "developer",
  "evictionTolerance": 0.05,
  "budget": {
    "maxRawUtilization": 0.8,
    "maxReplayOverheadRatio": 0.35,
    "maxHogScore": 8,
    "minContextHealthScore": 55
  }
}
```

## Library API

```ts
import {
  analyzeTrace,
  buildOptimizationPlan,
  compareReceipts,
  evaluateBudget,
  normalizeTrace,
  getProfile
} from "pau-profiler";

const trace = normalizeTrace(openAIRequest, {
  format: "openai",
  runId: "run-42",
  model: "example-model",
  contextWindow: 128_000,
  analysisMode: "heuristic"
});

const receipt = analyzeTrace(trace, {
  profile: getProfile("coding"),
  nearDuplicates: {
    enabled: true,
    threshold: 0.82,
    shingleSize: 4,
    maxComparisons: 20_000
  }
});

const plan = buildOptimizationPlan(receipt, "balanced");
const budget = evaluateBudget(receipt, {
  maxRawUtilization: 0.8,
  maxReplayOverheadRatio: 0.3,
  maxHogScore: 8,
  minContextHealthScore: 60
});
```

### Custom profiles

Unspecified categories inherit the core weights, so adjusting one dimension does not require restating the taxonomy.

```ts
import { defineProfile, describeProfile } from "pau-profiler";

const supportProfile = defineProfile({
  id: "acme-support",
  version: "1.0",
  baseWeights: { tool: 0.5, memory: 1.3 },
  description: "Support agents: CRM history matters more than raw tool payloads."
});

// The manifest is what makes a PAU number interpretable by someone else.
console.log(describeProfile(supportProfile));
```

### Markdown receipts

```ts
import { renderReceiptMarkdown } from "pau-profiler";

// The user tier withholds segment identifiers and source references by construction,
// so an end-user surface cannot leak them by passing the wrong options.
const forUser = renderReceiptMarkdown(receipt, { tier: "user" });
const forAudit = renderReceiptMarkdown(receipt, { tier: "auditor", plan, budget });
```

### Validation

```ts
import { validatePAUTrace } from "pau-profiler";

const result = validatePAUTrace(candidate);
if (!result.valid) {
  // Every problem at once, rather than throwing on the first.
  for (const issue of result.errors) console.error(`${issue.path}: ${issue.message}`);
}
```

## Measurement model

For segment `i`:

```text
PAU_i = tokens_i * baseWeight_i * relevance_i * density_i * authority_i
```

The basic profile uses only `tokens * baseWeight`. Heuristic profiles use every explicit factor.

```text
Raw utilization = total physical tokens / context window
PAU utilization = total PAU / context window
Pig Density = segment PAU / segment tokens
Replay tokens = segment tokens * replay count
Replay PAU = segment PAU * replay count
```

PAU utilization may exceed 100% because it is weighted load, not physical occupancy.

### Uncertainty

Every PAU value carries an interval. Sigmas are combined in quadrature from the measurement methods actually used: estimated tokens widen it, defaulted factors widen it, and the category base weight contributes a floor because it is itself an engineering parameter.

Segment intervals are log-normal, because PAU is a product of non-negative factors. Totals use the delta method, so independent segment errors partially cancel rather than stacking worst cases — adding each segment's worst case would describe the world where every segment is wrong in the same direction at once.

```text
39.6k PAU [34.1k-45.8k at 1.96 sigma]
```

### Token accounting grades

Requiring exact per-segment counts states the right goal and the wrong requirement: providers do not uniformly expose their hidden serialization. PAU grades the evidence instead.

| Grade | Evidence |
| --- | --- |
| `A` | Provider aggregate reconciles with segment attribution |
| `B` | Exact counts from a declared local tokenizer |
| `C` | Provider-equivalent tokenizer estimate |
| `D` | Approximate tokenizer or modality conversion |

A trace is graded by its **weakest** segment. Supply `providerTokenTotal` and the receipt also reports the unattributed remainder — the chat template, tool schemas, and protocol wrapping the harness never saw:

```text
Accounting grade      A       Provider aggregate reconciles with segment attribution.
Unattributed          1,350 tokens    1.7% of the provider total
```

### Interaction pressure is not additive

Segment PAU is additive by construction. Contextual burden is not: input length degrades performance on its own even where retrieval is controlled, and the distance between pieces of evidence that must be combined introduces further bias. Neither is a property of any single segment, so neither belongs in a per-segment multiplier.

CII reports that pressure separately, from occupancy, fragmentation, evidence spread, instruction conflict, and redundancy. It is deliberately **dimensionless and never added to the PAU total** — the evidence supports these effects existing, not an exchange rate between a spacing pattern and a token count.

### Duplication is not replay

PAU 0.2 deliberately separates:

- **duplicate ratio**: repeated material inside the current model request;
- **replay count**: how many additional turns a segment has been carried forward.

A segment can be unique in the current request but still create substantial replay cost across an agent loop. Combining those concepts would hide the cause of the overhead.

### Context Hog Index

A large segment is not automatically a context hog. In heuristic mode, CHI compares the larger of token share and PAU share with the segment's utility share, then increases investigation priority when duplication or replay is present. Results are bounded to 0-10.

When utility is unavailable, PAU reports a deterministic **structural pressure score** based on size, duplication, replay, and age. `effectiveHogScore` is CHI when utility exists and structural pressure otherwise.

Suggested labels:

| Score | Classification |
|---:|---|
| `<2` | low |
| `2-<4` | watch |
| `4-<6` | medium |
| `6-<8` | high |
| `>=8` | severe |

A hog score is an investigation priority, not authorization to delete context.

### Why CHI does not drive automation

CHI puts utility in the denominator, so as positive utility approaches zero the ratio destabilizes — precisely among the segments it flags hardest. It stays useful for triage and is not used on its own to authorize removal.

Action selection uses **Removable Load Value** instead:

```text
RLV(d) = expected savings
       x P(quality loss <= d)
       x confidence
       x governance feasibility
```

Utility sits in the numerator through the probability term, so the quantity stays bounded where a ratio diverges. Governance feasibility is zero for any transformation the ledger forbids, regardless of measured utility.

## Utility and confidence

Each segment declares how utility was obtained:

- `provided`: supplied by an evaluator, controlled ablation, or upstream system;
- `heuristic`: generated from the visible relevance, density, authority, novelty, and profile factors;
- `none`: no utility claim is made.

The receipt also reports score confidence. Estimated token counts, heuristic utility, near-duplicate matches, inferred replay, and a missing context window reduce confidence. The browser and CLI surface these warnings rather than hiding them.

For high-confidence utility measurement, run controlled evaluations with and without a segment, measure the task-level impact, and pass the calibrated result as `utility`.

### Utility is not one causal quantity

Declare what a utility number actually describes with `utilityEffectScope`:

| Scope | Intervention | Meaning |
| --- | --- | --- |
| `local` | Remove a segment in one invocation | Effect on that model call |
| `run` | Intervene and rerun the trajectory | Total effect including changed actions |
| `policy` | Compare policies over a task population | Production decision effect |

These can differ in magnitude and in sign. A passage may barely affect the immediate answer while changing a tool selection that reshapes every later observation. Values from different scopes are not comparable.

## Input formats

### Native PAU trace

```json
{
  "version": "0.2",
  "runId": "agent-turn-42",
  "model": "example-model",
  "contextWindow": 128000,
  "turn": 7,
  "analysisMode": "heuristic",
  "segments": [
    {
      "id": "system.core",
      "type": "system",
      "tokens": 7200,
      "protected": true,
      "utility": 0.98
    },
    {
      "id": "tool.github.repository-dump",
      "type": "tool",
      "source": "github",
      "tokens": 18400,
      "turnAdded": 3,
      "duplicateRatio": 0.44,
      "relevance": 0.28,
      "utility": 0.12
    }
  ]
}
```

See [`schema/pau-trace.schema.json`](schema/pau-trace.schema.json).

### Message adapters

`normalizeTrace()` accepts:

- a native PAU trace;
- an OpenAI-style `messages` array or request object;
- an Anthropic-style request with top-level `system` and content blocks;
- a generic role/content message array.

Adapters preserve role, source, tool identity, and current-user protection where the input makes those distinctions available. Harness-native traces remain preferable because they can include exact tokens, turn lifetime, replay count, and evaluator utility.

## Exact tokenization

The core package intentionally has no model-tokenizer dependency. For production use, record token counts at the provider boundary or supply a tokenizer adapter:

```ts
const receipt = analyzeTrace(trace, {
  tokenCounter: (text, segment) => tokenizerFor(segment).encode(text).length
});
```

If neither is available, PAU uses a deterministic estimate and marks `tokenCountMethod: "estimated"`.

## Harness integration

Instrument the final context assembly boundary immediately before a provider call:

```text
Agent state / tools / retrieval / history
                 |
                 v
          Context assembler
                 |
                 v
          PAU instrumentation
                 |----> Context Receipt
                 |----> Budget / regression gate
                 |----> Optimization recommendation
                 v
          Provider adapter
                 |
                 v
               Model
```

This boundary matters. A reconstructed transcript cannot reliably reveal provider-added schemas, tool definitions, compaction, or replay behavior.

### Blacksite-style adapter

```ts
const segments = assembledContext.map((item) => ({
  id: item.id,
  type: mapContextType(item.kind),
  source: item.toolName ?? item.workspacePath,
  content: item.text,
  tokens: item.tokenCount,
  turnAdded: item.turnAdded,
  turnLastSeen: turn,
  protected: item.isPolicy || item.isCurrentUserInput,
  utility: evaluatorResults.get(item.id)?.utility
}));

const receipt = analyzeTrace({
  version: "0.2",
  runId,
  model,
  provider,
  tokenizer,
  traceBoundary: "final-provider-payload",
  contextWindow,
  turn,
  analysisMode: "basic",
  segments
});

runtimeEvents.emit("context.receipt", receipt);
```

Start with basic mode to establish reproducible physical accounting. Add evaluator-derived utility selectively, then compare optimized runs against the baseline.

## Optimization safety

Retention is decided by the governance ledger, not by a score. Each segment carries an authority class that determines which transformations are permitted at all:

| Authority class | Permitted |
| --- | --- |
| `mandatory-policy` | `retain` |
| `application-instruction` | `retain`, `reposition` |
| `current-user` | `retain`, `reposition` |
| `advisory` | all |
| `untrusted-external` | all |

The optimizer checks this **before** it reads any score, so a low utility estimate can never unlock an action. Retrieved documents and tool output are classified `untrusted-external` regardless of instruction-like content, and are never promoted by their content or their score.

Plans are advisory. They estimate opportunity from current measurements and recommend mechanisms such as deduplication, cache references, selective retrieval, bounded history summaries, and stale-context re-retrieval. Validate changes against task success, safety, latency, cost, and quality before enforcing them automatically.

## CI regression gate

`evaluateBudget()` and `pau check` can fail builds when a harness regresses:

```yaml
- name: PAU context budget
  run: >-
    node bin/pau.mjs check artifacts/candidate-trace.json
    --max-raw-utilization 0.80
    --max-replay-overhead 0.25
    --max-hog-score 7.5
    --min-health 65
```

`compareReceipts()` identifies run-level and category/source deltas so a pull request can explain *why* contextual load changed.

## Telemetry

```ts
import {
  analyzeTrace,
  toSegmentTelemetryAttributes,
  toTelemetryAttributes
} from "pau-profiler";

const receipt = analyzeTrace(trace);
span.setAttributes(toTelemetryAttributes(receipt));

for (const segment of receipt.segments) {
  emitEvent("pau.segment", toSegmentTelemetryAttributes(segment));
}
```

The `pau.*` namespace is project-defined in 0.2 and is not an official OpenTelemetry semantic convention.

## Privacy and transparency

- Core analysis is local and dependency-light.
- The GitHub Pages profiler performs analysis in the browser.
- No prompts, source code, or traces are uploaded by the application.
- Every factor, method, warning, and recommendation is represented in the receipt.
- Users may omit content and provide only tokens, hashes, provenance, and measurement metadata.

## Design principles

1. **Transparent before clever.** Formulas and factor provenance are inspectable.
2. **Physical tokens remain physical tokens.** PAU never relabels weighted load as occupancy.
3. **Duplication and replay stay separate.** They require different harness fixes.
4. **Profiles are versioned.** A scoring change requires a profile version change.
5. **Utility is labeled.** Heuristic utility is never presented as causal evidence.
6. **Governance outranks measurement.** Retention is decided by what context *is*, not by how it scored. Measurement constrains nothing on its own.
7. **Compare outcomes, not just savings.** Efficiency work must preserve task performance.
8. **Harness-neutral by default.** Framework-specific behavior belongs in adapters.
9. **Additive where it is additive.** Interaction effects are real but not per-segment, so they are reported beside PAU rather than folded into it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local validation loop and the extra bar that applies to scoring changes, [CHANGELOG.md](CHANGELOG.md) for release history, and [SECURITY.md](SECURITY.md) for the privacy posture and disclosure process.

## License

MIT.
