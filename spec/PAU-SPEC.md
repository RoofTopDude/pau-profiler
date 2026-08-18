# PAU Core Specification 0.3

## Status

Experimental open specification. PAU 0.3 defines transparent context-accounting and diagnostic primitives for AI and agent systems. It does not claim that reference weights are universal measurements of model attention, cognition, or task value.

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
- **Conditional Pig Density**: PAU per physical token. It is conditional because a weight depends on the active task, the surrounding context, duplication, position, and the model profile, rather than being an intrinsic property of the segment.
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
- **Token Accounting Grade**: an A-D grade describing the evidence behind a token count.
- **Governance ledger**: the record of authority, sensitivity, retention locks, and permitted transformations, computed independently of any measurement.
- **CII**: Context Interaction/Interference Index, a dimensionless estimate of nonlocal contextual burden reported alongside PAU.
- **Removable Load Value (RLV)**: expected savings weighted by the probability that quality stays within tolerance, by confidence, and by governance feasibility.
- **Effect scope**: whether a utility claim refers to one call (`local`), a whole trajectory (`run`), or a policy over a task population (`policy`).

## 3. Context taxonomy

PAU Core 0.3 defines these categories:

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
ConditionalPigDensity_i = PAU_i / T_i
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

### 5.1 Token Accounting Grade

Requiring exact per-segment token counts states the right goal and the wrong requirement. Providers do not uniformly expose their hidden serialization, so a harness can seldom prove segment-level exactness. PAU 0.3 therefore grades the available evidence instead of asserting precision it cannot demonstrate.

| Grade | Evidence | Interpretation |
| --- | --- | --- |
| `A` | Provider aggregate reconciles with harness segment attribution | Provider-verified accounting |
| `B` | Exact counts from a declared local tokenizer and serialization | Exact for client-side serialization |
| `C` | Provider-equivalent tokenizer estimate | Hidden template differences possible |
| `D` | Approximate tokenizer or modality conversion | Approximate only |

A trace grade MUST be the weakest grade among its segments. A comparison MUST NOT imply higher fidelity than the least reliable measurement it contains.

### 5.2 Provider reconciliation

Where the provider reports an aggregate input-token count, an implementation SHOULD record it as `providerTokenTotal` and report the reconciliation:

```text
UnattributedTokens = ProviderTotal - sum(T_i)
```

The remainder is the chat template, tool schemas, and protocol wrapping that the harness never saw. Reporting it keeps unattributed context visible rather than silently absorbed into segment totals.

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

### 11.1 CHI is a triage index, not a control law

CHI places utility in the denominator. As positive utility approaches zero the ratio becomes unstable, so small evaluator perturbations produce large ranking changes — and that instability is worst precisely among the segments the index flags hardest.

CHI therefore remains suitable for operator triage and MUST NOT be used on its own to authorize automated removal. For action selection, PAU 0.3 defines **Removable Load Value**:

```text
RLV_i(d) = ExpectedSavings_i
         x P(quality loss <= d | evidence)
         x Confidence_i
         x ActionFeasibility_i
```

Utility appears in the numerator through the probability term, so the quantity stays bounded where a ratio diverges. `ActionFeasibility_i` is zero for any transformation the governance ledger forbids, irrespective of measured utility. Savings SHOULD remain multidimensional — tokens, PAU, latency, and cost — rather than collapsing infrastructure economics into PAU.

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

## 14a. Governance ledger

PAU 0.3 keeps two ledgers and computes them independently.

- The **measurement ledger** records tokens, PAU, replay, duplication, estimated utility, uncertainty, and interaction pressure. It answers what context cost and what it appeared to contribute.
- The **governance ledger** records authority, mandatory status, sensitivity, retention locks, and permitted transformations. It answers what the system is obligated to preserve.

They are combined only at the policy layer, and only in one direction: governance constrains action, and measurement never unlocks it.

This separation exists because the two questions have different answers. A safety constraint that activates in one run out of a thousand will look worthless to any counterfactual evaluation over routine traffic. That is a fact about the traffic, not a licence to delete the constraint. Folding authority into the measured weight invites exactly that error, and creates a Goodhart target besides.

An implementation MUST classify each segment into an authority class:

| Authority class | Permitted transformations |
| --- | --- |
| `mandatory-policy` | `retain` |
| `application-instruction` | `retain`, `reposition` |
| `current-user` | `retain`, `reposition` |
| `advisory` | all |
| `untrusted-external` | all |

A conforming optimizer MUST consult permitted transformations **before** any score is considered, so that no measurement can make a locked segment actionable. Retrieved documents and tool output MUST be classified as `untrusted-external` regardless of instruction-like content, and MUST NOT be promoted to a higher authority by their content or their score.

## 14b. Context Interaction/Interference Index

Segment PAU is additive by construction. Contextual burden is not: input length degrades performance on its own even where retrieval is controlled, and the distance between pieces of evidence that must be combined introduces further bias. Neither effect is a property of any single segment, so neither belongs in a per-segment multiplier.

CII is therefore reported **alongside** PAU and MUST NOT be added to it:

```text
CII = f(occupancy, fragmentation, evidence spread,
        instruction conflict, redundancy interference)
```

CII MUST be dimensionless and bounded to `[0,1]`. An implementation MUST NOT convert CII into token-equivalents: the evidence supports the existence of these effects, not a universal exchange rate between a spacing pattern and a token count. Every component MUST be reported so a reader can see which pressure drove the value.

## 14c. Effect scope

Utility is not a single causal quantity. An implementation MUST declare the scope a utility estimate refers to:

| Scope | Intervention | Meaning |
| --- | --- | --- |
| `local` | Remove or replace a segment in one invocation | Effect on that model call |
| `run` | Intervene and rerun the downstream trajectory | Total effect including changed actions |
| `policy` | Compare context policies over a task population | Production decision effect |

These can differ in magnitude and in sign. Context that barely affects one answer may change a tool selection that reshapes every later observation. An unlabeled utility number is ambiguous and MUST NOT be compared across scopes.

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

A 0.3 receipt MUST expose at minimum:

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
token accounting grade and provider reconciliation when available
PAU uncertainty interval and coverage
governance ledger: authority, sensitivity, retention locks, permitted transformations
Context Interaction/Interference Index and its components
utility effect scope
evictable PAU at the declared tolerance
warnings and recommendations
```

### 17.1 Disclosure tiers

A receipt MAY be rendered at different disclosure levels from one analysis:

| Audience | Discloses | Withholds |
| --- | --- | --- |
| End user | Aggregate composition, totals, whether memory/retrieval/tools were used, major omissions | Segment identifiers, source references, run identity |
| Developer | Per-source and per-segment metrics, profile version, hog ranking, governance ledger, plan detail | Secrets and regulated payloads unless authorized |
| Operator / auditor | The developer view plus uncertainty, measurement warnings, and full lineage | Content remains subject to least privilege |

Tiering MUST be enforced by the renderer rather than left to the caller: an end-user surface must not be able to leak segment identifiers by passing the wrong options.

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

A **PAU Core 0.3 conforming analyzer**:

1. preserves physical token totals separately from PAU;
2. exposes all adjustment factors;
3. separates duplication from replay;
4. labels token, duplicate, replay, and utility methods;
5. reports a Token Accounting Grade, and grades a trace by its weakest segment;
6. maintains a governance ledger independent of measurement, and consults it before any score when selecting actions;
7. reports CII separately from PAU and never adds it to the PAU total;
8. declares the effect scope of every utility claim;
9. reports an uncertainty interval or an ordinal confidence class;
10. emits a Context Receipt;
11. protects configured policy-critical segments from automatic optimization;
12. versions profiles and formulas;
13. does not present heuristics as causal evidence.

### 21.1 Release gates

The bar for observability use is lower than the bar for consequential use. PAU MUST NOT be used for billing, contractual service levels, or cross-system scorecards until it demonstrates independent reproducibility, cross-model and cross-domain calibration behavior, accounting-error characterization, uncertainty coverage, resistance to profile gaming, and controlled non-inferiority evidence.

PAU makes no claim to metrological traceability. Its path to legitimacy is empirical reproducibility and measurement discipline, not analogy to a physical unit.
