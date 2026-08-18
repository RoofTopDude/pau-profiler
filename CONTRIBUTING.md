# Contributing

PAU is intended to be auditable. Changes to scoring formulas, reference weights, or trace semantics should include:

1. a specification update;
2. tests that demonstrate the behavior;
3. a profile version change when results would change for the same input;
4. a clear statement of whether a metric is deterministic, heuristic, or empirically calibrated.

Please avoid introducing hidden remote calls into the core package. Model- or service-backed evaluators belong in explicit adapters.
