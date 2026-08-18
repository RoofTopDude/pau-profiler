# PAU Profiler

**Pig Adjustable Units (PAU)** is an experimental, open-source context utilization accounting framework for AI and agent systems.

Tokens tell you how much context is present. PAU is designed to help answer a different engineering question:

> Which parts of the context window are consuming budget, being replayed, duplicated, or contributing disproportionately little value?

The project is deliberately transparent. Every score is derived from visible inputs and versioned formulas. The core package makes no network requests.

## What v0.1 does

- normalizes context into provenance-preserving segments;
- records or estimates token counts;
- calculates PAU load and Pig Density by segment and category;
- tracks exact duplication and replay overhead;
- protects system/developer/current-user context by default;
- calculates a structural pressure score without semantic AI evaluation;
- optionally calculates heuristic utility, Pig Efficiency, and Context Hog Index (CHI);
- emits a machine-readable **Context Receipt** explaining every factor;
- provides a zero-service CLI for JSON traces.

PAU 0.1 is an engineering proposal, not a claim that the reference weights measure literal model attention. See [`spec/PAU-SPEC.md`](spec/PAU-SPEC.md).

## Install

```bash
npm install
npm run build
```

Run the bundled example:

```bash
npm run example
```

Or:

```bash
node bin/pau.mjs analyze examples/research-agent.json
```

Machine-readable output:

```bash
node bin/pau.mjs analyze examples/research-agent.json --json
```

## Minimal API

```ts
import { analyzeTrace } from "pau-profiler";

const receipt = analyzeTrace({
  version: "0.1",
  runId: "agent-turn-42",
  contextWindow: 128_000,
  analysisMode: "heuristic",
  segments: [
    {
      id: "system.core",
      type: "system",
      tokens: 8_000,
      protected: true,
      utility: 0.98
    },
    {
      id: "github.repository-dump",
      type: "tool",
      source: "github",
      tokens: 18_400,
      replayCount: 4,
      duplicateRatio: 0.44,
      relevance: 0.28,
      utility: 0.12
    }
  ]
});

console.log(receipt.contextHealthScore);
console.log(receipt.segments[1].contextHogIndex);
```

## Exact tokenization

The core package has no model-tokenizer dependency. For production use, pass token counts from your harness or provide a tokenizer adapter:

```ts
const receipt = analyzeTrace(trace, {
  tokenCounter: (text, segment) => tokenizerFor(segment).encode(text).length
});
```

If neither is provided, PAU uses a deterministic approximation and marks the segment with `tokenCountMethod: "estimated"`.

## PAU measurement

For segment `i`:

```text
PAU_i = tokens_i * baseWeight_i * relevance_i * density_i * authority_i
```

The `basic` profile only uses `tokens * baseWeight`. The `heuristic` profile uses all factors.

```text
Raw utilization = total tokens / context window
PAU utilization = total PAU / context window
Pig Density = PAU / tokens
```

PAU utilization may exceed 100% because it represents weighted load, not physical occupancy.

## Context Hog Index

A context hog is not simply a large segment. CHI looks for segments whose consumption is high relative to their estimated utility and increases the ranking when duplication or replay is present.

The reference implementation uses the larger of token share and PAU share as consumption, compares it with utility share, then applies a bounded 0-10 transform. The complete formula is public in the specification and source.

Suggested labels:

| CHI | Classification |
|---:|---|
| `<2` | low |
| `2-<4` | watch |
| `4-<6` | medium |
| `6-<8` | high |
| `>=8` | severe |

CHI is an investigation priority, **not permission to delete context**.

## Basic vs. heuristic analysis

### Basic

Deterministic structural analysis. No utility estimate is invented.

Useful for:

- physical context composition;
- category-weighted PAU;
- replay accounting;
- exact duplicate detection;
- structural pressure;
- local/private analysis.

### Heuristic

Adds explicit relevance, density, authority, and utility factors. When `utility` is omitted, the reference implementation generates a labeled proxy. Those values are not causal measurements.

For high-confidence utility measurement, use controlled ablation or task evaluation and pass the resulting calibrated `utility` values into the trace.

## Trace format

```json
{
  "version": "0.1",
  "runId": "run-123",
  "contextWindow": 128000,
  "analysisMode": "heuristic",
  "segments": [
    {
      "id": "tool.github.14",
      "type": "tool",
      "source": "github",
      "tokens": 18420,
      "replayCount": 4,
      "duplicateRatio": 0.44,
      "utility": 0.12
    }
  ]
}
```

See [`schema/pau-trace.schema.json`](schema/pau-trace.schema.json).

## Harness integration pattern

Instrument the final context assembly boundary immediately before a model/provider call:

```text
Agent state / tools / retrieval / history
                 |
                 v
          Context assembler
                 |
                 v
          PAU instrumentation
                 |
                 +--> Context Receipt
                 |
                 v
          Provider adapter
                 |
                 v
               Model
```

This is important: the profiler should measure the **actual model payload**, not reconstruct context from logs later.

### Blacksite-style adapter

A harness can map its internal context objects into PAU segments without coupling itself to the scoring engine:

```ts
const segments = assembledContext.map((item) => ({
  id: item.id,
  type: mapBlacksiteContextType(item.kind),
  source: item.toolName ?? item.workspacePath,
  content: item.text,
  tokens: item.tokenCount,
  turnAdded: item.turnAdded,
  replayCount: item.replayCount,
  protected: item.isPolicy || item.isCurrentUserInput
}));

const receipt = analyzeTrace({
  version: "0.1",
  runId,
  model,
  provider,
  contextWindow,
  turn,
  analysisMode: "basic",
  segments
});

runtimeEvents.emit("context.receipt", receipt);
```

Start in `basic` mode. Once the harness has evaluator evidence, attach calibrated utility/relevance values and move specific dashboards or experiments to `heuristic` mode.

## Safety and optimization policy

`system`, `developer`, and `user` segments are protected by the reference profile. A PAU-based optimizer should treat protection as a hard policy gate:

```ts
if (!segment.protected && segment.contextHogIndex >= 7) {
  // candidate for summarization, selective retrieval, or eviction policy
}
```

Do not automatically remove policy or safety-critical context because it looks expensive.

## Context Receipt

The receipt is the transparency primitive. It records:

```text
profile/version
physical tokens
PAU load
raw utilization
PAU utilization
duplicate-token ratio
replay tokens and ratio
Pig Efficiency when utility exists
Context Health Score
category summaries
per-segment factors
Context Hog scores
recommendations
protection state
```

This makes "why did this run score badly?" answerable without a proprietary backend.

## Roadmap

- model-specific tokenizer adapters;
- OpenTelemetry semantic conventions and exporter;
- run-over-run replay accounting;
- semantic duplicate adapters;
- task-evaluator and controlled-ablation adapters;
- CI regression command (`pau benchmark`);
- browser-based local-first profiler;
- visualization package for context flame graphs;
- calibrated profiles for coding, RAG, browser, and research agents.

## Design principles

1. **Transparent before clever.** Formulas and factors are inspectable.
2. **Local-first.** Core analysis does not upload context.
3. **Profiles are versioned.** Changing weights changes the profile version.
4. **Physical tokens remain physical tokens.** PAU never pretends weighted load is token count.
5. **Utility is labeled.** Heuristic utility is not presented as causal evidence.
6. **Protected context wins.** Optimization cannot override policy gates.
7. **Harness-neutral.** The core consumes a trace contract rather than framework-specific state.

## License

MIT.

## Telemetry export

The package includes a dependency-free attribute mapper for adding PAU measurements to an existing telemetry span or event:

```ts
import { analyzeTrace, toTelemetryAttributes } from "pau-profiler";

const receipt = analyzeTrace(trace);
span.setAttributes(toTelemetryAttributes(receipt));
```

The `pau.*` attribute namespace in v0.1 is project-defined; it is **not** represented as an official OpenTelemetry semantic convention.
