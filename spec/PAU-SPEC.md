# PAU Core Specification 0.1

## Status

Experimental open specification. PAU 0.1 defines transparent context accounting primitives for AI and agent systems. It does not claim that heuristic weights are universal measures of model cognition or attention.

## 1. Terminology

- **Physical tokens**: tokens physically present in a model request, counted by the target model tokenizer when available.
- **Context segment**: a provenance-preserving unit of context such as a system instruction, user turn, tool result, retrieved document, source file, or browser snapshot.
- **Pig Adjustment Factor (PAF)**: an explicit multiplicative weighting applied to a segment.
- **Pig Adjustable Units (PAU)**: physical tokens multiplied by PAF.
- **Pig Density**: PAU per physical token.
- **Replay tokens**: tokens attributable to carrying the same segment across additional turns.
- **Pig Efficiency**: useful PAU divided by total PAU when a utility estimate exists.
- **Context Hog Index (CHI)**: a 0-10 heuristic score indicating consumption disproportionate to estimated utility.

## 2. Core equation

For context segment i:

```text
PAU_i = T_i * B_i * R_i * D_i * A_i
```

where:

- `T_i` is token count.
- `B_i` is the category base weight.
- `R_i` is relevance.
- `D_i` is semantic/information density.
- `A_i` is authority or priority.

The **basic** profile uses only `T_i * B_i`. The **heuristic** profile uses all explicit factors. Every factor MUST be included in the output receipt.

## 3. Reference category weights

| Category | Weight |
|---|---:|
| system | 1.50 |
| developer | 1.40 |
| user | 1.30 |
| history | 0.90 |
| tool | 0.80 |
| workspace | 0.90 |
| rag | 0.70 |
| browser | 0.70 |
| memory | 1.10 |
| code | 1.20 |
| data | 0.90 |
| summary | 1.00 |
| other | 1.00 |

These are calibration defaults, not empirical constants. Implementations SHOULD version any changed profile.

## 4. Utilization

```text
Raw utilization = total physical tokens / context window
PAU utilization = total PAU / context window
Pig Density_i = PAU_i / T_i
```

PAU utilization may exceed 100 percent because PAU is a weighted load measure, not physical occupancy.

## 5. Duplicate and replay accounting

A segment may provide `duplicateRatio` in [0,1]. If omitted, the reference implementation detects exact duplicate content fingerprints within the analyzed request. This is deliberately conservative and does not claim semantic duplicate detection.

`replayCount` is the number of additional model turns on which the segment was re-injected after its first inclusion.

```text
Replay tokens_i = T_i * replayCount_i
Replay overhead ratio = replay tokens / (current physical tokens + replay tokens)
```

## 6. Utility

Utility is explicitly distinct from size and PAU load. A caller MAY provide a calibrated `utility` value in [0,1]. In heuristic mode, if utility is missing, the reference implementation derives a labeled proxy from relevance, density, authority, and novelty. Basic mode does not fabricate utility.

Heuristic utility values MUST NOT be represented as causal findings. Causal utility requires controlled ablation or another validated attribution method.

## 7. Context Hog Index

Let:

```text
C_i = max(tokenShare_i, pauShare_i)
U_i = utilityShare_i
Q_i = C_i / (U_i + epsilon)
```

When `Q_i <= 1`, CHI is zero. Otherwise the reference transform is:

```text
CHI_i = 10 * (1 - exp(-0.35 * (Q_i - 1) * replayMultiplier * duplicateMultiplier))
```

with:

```text
replayMultiplier = 1 + 0.5 * clamp(replayCount / 3, 0, 1)
duplicateMultiplier = 1 + 0.5 * duplicateRatio
```

Suggested labels:

| CHI | Label |
|---:|---|
| <2 | low |
| 2-<4 | watch |
| 4-<6 | medium |
| 6-<8 | high |
| >=8 | severe |

CHI is intended to rank investigation targets. It is not proof that a segment can safely be removed.

## 8. Protected context

Segments marked `protected: true` are observable but MUST NOT be automatically evicted by a PAU optimizer. The reference profile protects system, developer, and current user context by default. Integrators SHOULD extend protection to safety, compliance, policy, and application-critical state.

## 9. Context receipt

Every analysis SHOULD emit a receipt containing:

- profile id/version;
- total physical tokens and PAU;
- utilization values;
- duplicate and replay ratios;
- efficiency metrics when available;
- category summaries;
- every segment's factors, PAU, density, shares, scores, and protection state.

The goal is reproducibility: a developer should be able to answer **why a score was produced** without access to a proprietary scoring service.

## 10. Comparability

PAU measurements are comparable only when the tokenizer, trace boundary, metric profile, and factor-generation method are compatible. Reports SHOULD preserve this metadata.

## 11. Empirical calibration

A production PAU profile SHOULD eventually be calibrated against task outcomes. Recommended experiments compare baseline runs to controlled context ablations or compressions and measure task success, evaluator quality, latency, cost, and tool behavior. Empirical calibration is outside the deterministic PAU Core 0.1 calculation.
