# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the major version is `0`,
minor releases may contain breaking changes to the receipt contract; those are always listed
under **Breaking**.

## 0.3.0

This release implements the measurement additions from the PAU framework review, alongside a
fix for a site deployment that was shipping without its library.

### Added — measurement architecture

- **Two ledgers: measurement and governance.** `receipt.governance` records authority class,
  sensitivity, retention locks, and permitted transformations, and is computed independently of
  every measured value. The optimizer consults permitted transformations *before* it looks at
  any score, so no measurement can make a locked segment actionable.

  This exists because the two questions have different answers. A safety constraint that fires
  in one run out of a thousand looks worthless to any evaluation over routine traffic — that is
  a fact about the traffic, not permission to delete the constraint. Folding authority into a
  measured weight invites exactly that error and creates a Goodhart target besides.

- **Token Accounting Grade (A-D).** Requiring exact per-segment counts states the right goal
  and the wrong requirement: providers do not uniformly expose their hidden serialization.
  Traces now carry a grade describing the evidence behind the count, and a trace is graded by
  its weakest segment — a comparison never implies more fidelity than its least reliable part.
- **Provider reconciliation.** Supply `providerTokenTotal` (or an OpenAI/Anthropic `usage`
  block, which the adapters now read) and the receipt reports the unattributed remainder: the
  chat template, tool schemas, and protocol wrapping the harness never saw. Reconciling upgrades
  the trace to grade A.
- **Context Interaction/Interference Index (CII).** Segment PAU is additive; contextual burden
  is not. Length degrades performance on its own even where retrieval is controlled, and the
  distance between pieces of evidence that must be combined introduces further bias. CII reports
  that nonlocal pressure from occupancy, fragmentation, evidence spread, instruction conflict,
  and redundancy. It is deliberately dimensionless and is **never added to the PAU total** —
  the evidence supports these effects existing, not an exchange rate between a spacing pattern
  and a token count.
- **Removable Load Value on every optimization action.** CHI puts utility in the denominator,
  so it destabilizes exactly where it flags hardest. RLV weights expected savings by the
  probability quality holds within tolerance, by confidence, and by governance feasibility,
  keeping utility in the numerator. Plans are now ranked by it; CHI remains for triage.
- **Effect scope on utility.** `utilityEffectScope` declares whether a utility number describes
  one call (`local`), a whole trajectory (`run`), or a policy over a task population (`policy`).
  These can differ in sign — context that barely affects one answer can change a tool choice
  that reshapes every later observation — so an unlabeled utility value is ambiguous.

### Added

- **Uncertainty intervals.** Every receipt and segment now carries a `pauInterval` with an
  explicit coverage factor. Sigmas are combined in quadrature from the declared measurement
  methods: estimated tokens, defaulted factors, and category base weights each widen the
  interval. Segment intervals are log-normal, because PAU is a product of non-negative
  factors; totals use the delta method so independent errors partially cancel rather than
  stacking worst cases.
- **Evictable PAU and Pig Efficiency at tolerance.** `receipt.eviction` reports the weighted
  load that could be removed while estimated quality stays within a tolerance, along with the
  candidate segments, the method used, and the protected load excluded from consideration.
  Configurable through `analyzeTrace(trace, { evictionTolerance })` or `--tolerance`.
  This is an estimate from the declared utility model, not a measured ablation.
- **`pigYield(runPAU, qualityScore)`** for outcome-per-load comparison across runs measured
  with the same evaluator.
- **Custom profiles.** `defineProfile()` builds a validated profile from a partial spec;
  unspecified categories inherit the core weights. Profiles can also be loaded from a JSON
  file with `--profile my-profile.json`.
- **Profile manifests.** `describeProfile()` renders the PAU Core profile manifest: baseline
  class, formula, weights, uncertainty model, review triggers, and stated limitations.
  Available from the CLI as `pau profile [name]`.
- **Structured validation.** `validatePAUTrace()` collects every problem in one pass instead
  of throwing on the first, separating errors that block analysis from warnings that only
  degrade confidence. Available as `pau validate`, which exits 2 on an invalid trace.
- **Markdown receipts with disclosure tiers.** `renderReceiptMarkdown()` implements the
  tiered transparency model: `user` receipts carry aggregate composition with no segment
  identifiers or source references, `developer` adds sources, hog ranking, and plan detail,
  and `auditor` adds uncertainty and measurement warnings.
- **New CLI commands:** `series` (multi-turn growth, previously library-only), `report`
  (markdown receipt), `validate`, and `profile`.
- **CLI ergonomics:** stdin support via `-`, config files (`pau.config.json` or `.paurc.json`,
  or `--config`), `--out` for writing to a file, `--markdown`, `--tier`, `--tolerance`, and
  `--version`.
- Multi-turn example traces in `examples/series/` and a reference `examples/pau.config.json`.
- Terminal output now includes a composition breakdown with category bars.

### Changed

- Terminology follows the review: Pig Density is documented as **Conditional Pig Density**,
  because a weight depends on the active task, surrounding context, duplication, position, and
  model profile rather than being intrinsic to a segment.
- The specification is now PAU Core 0.3, with new sections for the governance ledger, CII,
  effect scope, accounting grades, disclosure tiers, and release gates. Conformance now requires
  declaring effect scope and reporting uncertainty.
- **Breaking:** receipt `schemaVersion` is now `"0.3"`. The change is additive — existing
  fields keep their meaning — but consumers pinning the version string must update.
- Reference profiles are versioned `0.3`; PAU values are not comparable across profile
  versions.
- `PAUProfile` gained a required `uncertainty` model plus optional `description`,
  `publisher`, `effectiveDate`, and `status`. Code constructing a profile literal should use
  `defineProfile()` instead.
- Unknown profile names now list the known profiles in the error message.
- Trace schema is `pau-trace-0.3`. All new trace fields (`providerTokenTotal`,
  `utilityEffectScope`, segment `authorityClass` and `sensitivity`) are optional, so existing
  0.2 traces validate and analyze unchanged.

### Known gap

The measurement formula still includes the numeric `authority` factor
(`PAU = tokens x baseWeight x relevance x density x authority`). The review argues authority
should leave the measurement weight entirely now that governance is a separate ledger. That
change would alter every PAU value, so it is deliberately held for 0.4 rather than folded into
a release that already moves the receipt contract. The governance ledger is authoritative for
all retention and transformation decisions today; the residual authority factor affects only
the weighted-load number.

### Fixed

- **The published site no longer ships without its library.** `scripts/build-site.mjs` used
  `new URL(...).pathname`, which produced an invalid `C:\C:\...` path and failed on Windows.
  The script now resolves paths with `fileURLToPath` and verifies that `site-dist/lib/index.js`
  and `site-dist/index.html` exist before reporting success, so a site can no longer be
  published with a dead profiler.
- The site logo is a local asset rather than a `raw.githubusercontent.com` URL, removing an
  external runtime dependency from a page that advertises itself as local-first.
- Removed a layer of `!important` brand overrides by folding them into the base stylesheet,
  and deleted an unreferenced duplicate stylesheet.

## 0.2.0

- Context Hog Index, structural pressure scoring, and confidence labels.
- Separate accounting for in-request duplication and cross-turn replay.
- Exact and local near-duplicate detection.
- OpenAI-style and Anthropic-style message adapters.
- Coding, RAG, browser, basic, and heuristic measurement profiles.
- Conservative, balanced, and aggressive optimization plans.
- Run-to-run comparison, budget enforcement, and trace-series analysis.
- OpenTelemetry-friendly `pau.*` attributes.
- Browser profiler and CLI.
