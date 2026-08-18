# PAU Core Specification 0.2

## Status

Experimental open specification. PAU 0.2 defines transparent context-accounting and diagnostic primitives for AI and agent systems. It does not claim that reference weights are universal measurements of model attention, cognition, or task value.

## 1. Scope

PAU is intended to measure and explain the context presented to a model at a declared instrumentation boundary. Conforming implementations SHOULD prefer the final provider payload, because post-hoc transcripts can omit tool schemas, provider wrappers, compaction, injected policies, and replayed state.

PAU distinguishes four concerns:

1. **physical occupancy** - tokens in the current request;
2. **weighted contextual load** - PAU calculated from explicit factors;
3. **lifecycle overhead** - duplication, replay, age, and retention;
4. **estimated value** - utility supplied by evaluation or clearly labeled heuristics.

## 2. Terminology

- **Physical tokens (`T`)**: tokens physically present in one model request, counted by the target tokenizer when possible.
- **Context segment**: a provenance-preserving unit such as a policy block, user turn, tool result, retrieved document, source excerpt, memory item, or browser snapshot.
- **Pig Adjustment Factor (`PAF`)**: the explicit multiplicative factor applied to a segment.
- **Pig Adjustable Units (`PAU`)**: physical tokens multiplied by `PAF`.
- **Pig Density**: PAU per physical token.
- **Duplicate ratio (`d`)**: the fraction of a segment that repeats material already present in the same analyzed request.
- **Replay count (`r`)**: the number of additional turns in which the segment has been carried after its initial insertion.
- **Replay tokens**: `T * r`.
- **Replay PAU**: `PAU * r`.
- **Retention tax**: replay PAU discounted by estimated utility.
- **Utility (`u`)**: a bounded estimate of the segment's task contribution.
- **Pig Efficiency**: useful PAU divided by total PAU when utility exists.
- **Context Hog Index (`CHI`)**: a bounded 0-10 diagnostic comparing consumption share with utility share.
- **Structural pressure**: a deterministic 0-10 score used when utility is unavailable.
- **Context Receipt**: the machine-readable record of methods, factors, totals, warnings, scores, and provenance.

## 3. Context taxonomy

PAU Core 0.2 defines these categories:

```text
system, developer, user, history, tool, workspace, rag,
browser, memory, code, data, summary, other
```

An implementation MAY extend this taxonomy through a custom profile, but MUST preserve a stable mapping when results are compared.

## 4. Core equations

For segment `i`:

```text
PAF_i = B_i * R_i * D_i * A_i
PAU_i = T_i * PAF_i
PigDensity_i = PAU_i / T_i
```

Where:

- `B_i` is the category base weight;
- `R_i` is relevance;
- `D_i` is semantic or information density;
- `A_i` is authority or priority.

The **basic** measurement mode uses:

```text
PAF_i = B_i
```

The **heuristic** mode uses all four factors. Implementations MUST emit the factor values and profile identifier used to produce each result.

Run totals:

```text
TotalTokens = sum(T_i)
TotalPAU = sum(PAU_i)
RawUtilization = TotalTokens / ContextWindow
PAUUtilization = TotalPAU / ContextWindow
```

PAU utilization MAY exceed 1.0 because PAU is weighted load, not physical occupancy.

## 5. Physical token accounting

Each segment MUST identify its token-count method:

- `provided` - exact or upstream-supplied count;
- `custom` - calculated by a supplied tokenizer adapter;
- `estimated` - deterministic approximation.

Reports MUST NOT represent estimated counts as exact. A conforming implementation SHOULD include the tokenizer identity and declared trace boundary when known.

## 6. Duplication

Duplicate ratio describes repetition **inside the current request**. It MUST NOT include cross-turn replay.

Supported methods:

- `provided` - supplied upstream;
- `exact` - content hash equals a prior segment in the same request;
- `near` - local similarity exceeds a declared threshold;
- `none` - no duplicate evidence.

The reference near-duplicate detector normalizes text, constructs token shingles, and uses Jaccard similarity. Implementations MUST expose the threshold, shingle size, and comparison limit when near-duplicate results affect scoring.

Near-duplicate detection is evidence of overlap, not proof of semantic dispensability.

## 7. Replay and lifecycle

Replay describes persistence across requests or turns:

```text
ReplayTokens_i = T_i * r_i
ReplayPAU_i = PAU_i * r_i
```

`r_i` MAY be provided directly. When `turnAdded` and a current or last-seen turn are available:

```text
r_i = max(0, lastSeenTurn - turnAdded)
LifetimeTurns_i = lastSeenTurn - turnAdded + 1
AgeTurns_i = currentTurn - turnAdded
```

The receipt MUST identify replay as `provided`, `inferred`, or `none`.

If utility exists:

```text
RetentionTaxPAU_i = ReplayPAU_i * (1 - u_i)
```

Retention tax is a diagnostic estimate. It is not a billable token count.

## 8. Utility

Utility MUST be bounded to `[0,1]` and labeled with one of:

- `provided` - supplied by an evaluator, controlled ablation, or upstream process;
- `heuristic` - derived from disclosed factors;
- `none` - no utility estimate.

The reference heuristic is:

```text
DensityNorm = clamp(D / 1.5)
AuthorityNorm = clamp(A / 1.5)
Base = 0.65*clamp(R) + 0.20*DensityNorm + 0.15*AuthorityNorm
Novelty = 1 - 0.75*d
u = clamp(Base * Novelty)
```

Heuristic utility MUST be described as diagnostic, not causal. For empirical calibration, implementations SHOULD evaluate the task with and without a segment or use an appropriate attribution design across repeated tasks.

## 9. Useful load and Pig Efficiency

When utility is available:

```text
UsefulPAU = sum(PAU_i * u_i)
WastePAU = TotalPAU - UsefulPAU
PigEfficiency = UsefulPAU / TotalPAU
```

When no segment has utility, these values MUST be `null` or unavailable rather than fabricated.

## 10. Structural pressure

When utility share is unavailable, the reference implementation calculates:

```text
SizePressure = clamp(TokenShare / 0.25)
ReplayPressure = clamp(r / 3)
AgePressure = clamp(AgeTurns / 12), or 0 if unknown
WastePressure = max(d, ReplayPressure)

StructuralPressure = 10 * clamp(
  SizePressure * (0.48 + 0.38*WastePressure + 0.14*AgePressure)
)
```

This score ranks physically expensive, duplicated, replayed, or aging segments without claiming task utility.

## 11. Context Hog Index

When utility share exists:

```text
ConsumptionShare_i = max(TokenShare_i, PAUShare_i)
Ratio_i = ConsumptionShare_i / (UtilityShare_i + epsilon)
```

If `Ratio_i <= 1`, `CHI_i = 0`. Otherwise:

```text
ReplayMultiplier = 1 + 0.5*clamp(r_i / 3)
DuplicateMultiplier = 1 + 0.5*d_i
Excess = (Ratio_i - 1) * 0.35 * ReplayMultiplier * DuplicateMultiplier
CHI_i = 10 * (1 - exp(-Excess))
```

`effectiveHogScore` MUST be CHI when utility exists and structural pressure otherwise.

Reference classifications:

```text
0 <= score < 2   low
2 <= score < 4   watch
4 <= score < 6   medium
6 <= score < 8   high
8 <= score <=10  severe
```

A hog score identifies investigation priority. It MUST NOT be treated as autonomous deletion permission.

## 12. Score confidence

The reference confidence starts at 1.0 and applies these reductions:

```text
estimated tokens        -0.35
heuristic utility       -0.20
no utility              -0.12
near duplicate          -0.10
inferred replay         -0.05
missing context window  -0.05
```

```text
score >= 0.78  high
score >= 0.50  medium
otherwise      low
```

Alternative confidence systems MAY be used, but their method MUST be versioned and exposed.

## 13. Context Health Score

The reference score starts at 100 and applies bounded penalties:

```text
RawPenalty = 25 * clamp((RawUtilization - 0.5) / 0.5)
PAUPenalty = 20 * clamp((PAUUtilization - 0.5) / 0.75)
DuplicatePenalty = 25 * clamp(DuplicateTokenRatio)
ReplayPenalty = 20 * clamp(ReplayOverheadRatio)
HogPenalty = 10 * clamp(MaxHogScore / 10)

ContextHealth = round(clamp(
  100 - RawPenalty - PAUPenalty - DuplicatePenalty - ReplayPenalty - HogPenalty,
  0,
  100
))
```

Context Health is a composite operational signal. Comparisons are only valid when the same profile, boundary, tokenizer method, and score version are used.

## 14. Protection

The reference profiles protect `system`, `developer`, and current `user` context. A protected segment MAY receive size, PAU, replay, duplication, and hog scores, but a conforming reference optimizer MUST NOT emit an eviction or compression action for it.

Organizations SHOULD extend protection to safety policy, legal constraints, authorization state, current task requirements, and any context whose removal could violate operational controls.

## 15. Optimization plans

PAU optimization plans are advisory estimates. Valid action classes include:

```text
deduplicate
cache-reference
selective-retrieval
summarize-history
prune-stale
retain
```

An action SHOULD report:

- segment and source;
- policy and score threshold;
- confidence;
- current token and PAU opportunity;
- future replay opportunity;
- reason;
- protection state.

Savings estimates MUST NOT be represented as guaranteed model-quality-neutral reductions. Changes SHOULD be validated against task success, safety, latency, cost, and evaluator results.

## 16. Run comparison and budgets

Run comparisons SHOULD preserve the same tokenizer, context boundary, profile, model task, and evaluator. The reference comparison reports deltas for physical tokens, PAU, health, replay, duplication, efficiency, maximum hog score, categories, and sources.

Budget gates MAY enforce:

```text
maximum tokens
maximum raw utilization
maximum PAU utilization
maximum duplicate ratio
maximum replay overhead
maximum hog score
minimum context health
minimum Pig Efficiency
```

A budget failure SHOULD identify the actual value, threshold, and violated metric.

## 17. Context Receipt

A 0.2 receipt MUST expose at minimum:

```text
schema and profile version
analysis mode
trace identity and boundary when available
physical tokens and token methods
PAU totals and factor breakdowns
raw and PAU utilization when available
duplicate ratio and duplicate method
replay tokens, replay PAU, and replay method
protection state
utility value and method
Pig Efficiency when available
structural pressure / CHI / effective hog score
score confidence
category and source summaries
Context Health Score
warnings and recommendations
```

The receipt is the transparency primitive. A user SHOULD be able to answer “why did this score change?” without access to a proprietary backend.

## 18. Input adapters

Adapters MAY normalize provider or framework message formats into PAU segments. An adapter MUST preserve distinctions available in the source, including role, current-user status, tool identity, source identity, and content boundaries.

Adapters MUST NOT imply lifecycle data they cannot observe. Exact tokens, replay, retention, and evaluator utility should be supplied by the harness whenever available.

## 19. Privacy and security

Implementations SHOULD support metadata-only analysis using tokens, hashes, source identifiers, and lifecycle fields without retaining prompt content.

Browser and CLI implementations SHOULD run locally by default. Remote evaluators or telemetry exporters MUST be explicit adapters, with clear data-flow and retention documentation.

Context content can contain secrets, source code, personal data, or operational policy. Receipts and telemetry SHOULD avoid emitting raw content unless explicitly configured.

## 20. Comparability requirements

A published PAU result SHOULD include:

```text
profile id and version
analysis mode
trace boundary
tokenizer identity or estimation method
near-duplicate configuration
utility method
dataset or task definition for empirical utility
context window
model/provider when relevant
```

Results that differ on these dimensions SHOULD NOT be presented as directly comparable without qualification.

## 21. Conformance

A **PAU Core 0.2 conforming analyzer**:

1. preserves physical token totals separately from PAU;
2. exposes all adjustment factors;
3. separates duplication from replay;
4. labels token, duplicate, replay, and utility methods;
5. emits a Context Receipt;
6. protects configured policy-critical segments from automatic optimization;
7. versions profiles and formulas;
8. does not present heuristics as causal evidence.
