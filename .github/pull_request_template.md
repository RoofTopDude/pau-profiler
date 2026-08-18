## What does this change?

<!-- One or two sentences. Link the issue if there is one. -->

## Type of change

- [ ] Bug fix
- [ ] New capability
- [ ] Measurement or scoring change
- [ ] Documentation or specification
- [ ] Website

## If this changes measurement

Scoring changes alter what a PAU number means, so they need more than passing tests.

- [ ] The specification in `spec/PAU-SPEC.md` is updated.
- [ ] The profile version is bumped, or the same input still produces the same result.
- [ ] The metric is explicitly labeled deterministic, heuristic, or calibrated.
- [ ] `CHANGELOG.md` records the change, with migration notes for any contract change.

## Verification

```bash
npm test
npm run build:site
npm pack --dry-run
```

- [ ] The commands above pass locally.
- [ ] New behavior has tests covering the important edge cases.
- [ ] No hidden network calls were introduced; the core stays local-first.
- [ ] Protected context still cannot be auto-evicted by an optimization score.
