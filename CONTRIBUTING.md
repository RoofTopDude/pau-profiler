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

Keep the core package local-first. Hidden remote calls are not accepted. Model-backed evaluators, tokenizers, telemetry exporters, and hosted services belong in explicit adapters with documented data flow.

Website changes should remain functional without a backend, preserve keyboard access, support narrow screens, and avoid sending trace content off-device.
