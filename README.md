# PAU Profiler

**Pig Adjustable Units (PAU)** is a local-first, open-source context utilization profiler for AI agents and LLM applications.

Tokens tell you how much context is present. PAU adds an auditable accounting layer for the harder questions:

> What is consuming the context budget, what is being duplicated or replayed, which segments are creating disproportionate pressure, and what can the harness change safely?

**Live profiler:** https://rooftopdude.github.io/pau-profiler/  
**Specification:** [`spec/PAU-SPEC.md`](spec/PAU-SPEC.md)

The core library and browser profiler make no network requests. Analysis runs against the data you provide and returns a machine-readable **Context Receipt** with the full factor breakdown.

## Capabilities in 0.2

- PAU load, Pig Density, raw utilization, PAU utilization, and Context Health;
- deterministic structural analysis and explicitly labeled heuristic analysis;
- exact and local near-duplicate detection;
- separate accounting for in-request duplication and cross-turn replay;
- retention lifetime, age, replay PAU, and estimated retention tax;
- Context Hog Index (CHI), confidence labels, and per-segment explanations;
- protected-context gates for system, developer, and current-user content;
- OpenAI-style and Anthropic-style message adapters;
- coding, RAG, browser, basic, and heuristic measurement profiles;
- conservative, balanced, and aggressive optimization plans;
- run-to-run regression comparison;
- enforceable context budgets for CI and agent evaluations;
- multi-turn trace-series growth analysis;
- OpenTelemetry-friendly `pau.*` attributes;
- a zero-service CLI and a browser-only GitHub Pages profiler.

PAU remains an experimental measurement proposal. Reference weights are versioned engineering parameters, not universal measurements of literal model attention or cognition.

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

Analyze a PAU trace:

```bash
node bin/pau.mjs analyze examples/research-agent.json
```

Generate a protected-context-safe optimization plan:

```bash
node bin/pau.mjs plan examples/research-agent.json --policy balanced
```

Compare two agent runs:

```bash
node bin/pau.mjs compare \
  examples/research-agent.json \
  examples/optimized-agent.json
```

Enforce a budget:

```bash
node bin/pau.mjs check examples/research-agent.json \
  --max-raw-utilization 0.80 \
  --max-replay-overhead 0.35 \
  --max-hog-score 8 \
  --min-health 55
```

Convert OpenAI-style or Anthropic-style messages into a PAU trace:

```bash
node bin/pau.mjs convert examples/openai-messages.json --format openai --json
```

Every command supports `--json` for machine-readable output. Run `node bin/pau.mjs help` for the complete command surface.

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

## Utility and confidence

Each segment declares how utility was obtained:

- `provided`: supplied by an evaluator, controlled ablation, or upstream system;
- `heuristic`: generated from the visible relevance, density, authority, novelty, and profile factors;
- `none`: no utility claim is made.

The receipt also reports score confidence. Estimated token counts, heuristic utility, near-duplicate matches, inferred replay, and a missing context window reduce confidence. The browser and CLI surface these warnings rather than hiding them.

For high-confidence utility measurement, run controlled evaluations with and without a segment, measure the task-level impact, and pass the calibrated result as `utility`.

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

The reference profiles protect `system`, `developer`, and current `user` segments. Optimization plans never emit actions for protected segments.

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
6. **Protected context wins.** Optimization cannot override safety or policy gates.
7. **Compare outcomes, not just savings.** Efficiency work must preserve task performance.
8. **Harness-neutral by default.** Framework-specific behavior belongs in adapters.

## License

MIT.
