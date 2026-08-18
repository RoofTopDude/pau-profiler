# Contributing

PAU is intended to be auditable and reproducible. Contributions are welcome across the measurement core, adapters, CLI, documentation, and local-first website.

Changes to scoring formulas, reference weights, or trace semantics should include:

1. a specification update;
2. tests demonstrating the behavior and important edge cases;
3. a profile or schema version change when the same input would produce materially different results;
4. a clear statement of whether a metric is deterministic, heuristic, or empirically calibrated;
5. migration notes when a public trace or receipt field changes.

Run the complete local validation before opening a pull request:

```bash
npm test
npm run build:site
npm pack --dry-run
```

## The two ledgers

PAU keeps measurement and governance separate, and contributions must preserve that boundary.

- The **measurement ledger** (tokens, PAU, replay, duplication, utility, uncertainty, CII) describes what context cost and what it appeared to contribute.
- The **governance ledger** (authority, sensitivity, retention locks, permitted transformations) describes what the system is obligated to preserve.

Governance constrains action; measurement never unlocks it. A change that lets a score make a locked segment actionable will not be accepted, however good the score is. If you are adding an optimization action, route it through the governance check before any score is read.

Similarly, interaction effects belong beside PAU, not inside it. CII is dimensionless on purpose: proposing a conversion from interaction pressure to token-equivalents needs empirical backing, not a plausible constant.

## Local-first

Keep the core package local-first. Hidden remote calls are not accepted. Model-backed evaluators, tokenizers, telemetry exporters, and hosted services belong in explicit adapters with documented data flow.

Website changes should remain functional without a backend, preserve keyboard access, support narrow screens, and avoid sending trace content off-device.
