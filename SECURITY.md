# Security and privacy

## Reporting a vulnerability

Report suspected vulnerabilities through
[GitHub's private vulnerability reporting](https://github.com/RoofTopDude/pau-profiler/security/advisories/new).
Please do not open a public issue for a security problem.

Include the version, a description of the impact, and a minimal reproduction. Do not include
real prompts, credentials, customer data, or proprietary system instructions in the report — a
metadata-only trace is almost always sufficient to reproduce a PAU problem.

You can expect an acknowledgement within a few days, and an assessment of whether the report is
accepted, along with a fix timeline, once it has been reviewed.

## Supported versions

This project is pre-1.0. Only the latest minor release receives fixes.

| Version | Supported |
| --- | --- |
| 0.3.x | Yes |
| < 0.3 | No |

## The threat model that matters here

PAU traces are unusually sensitive artifacts. A trace can contain the full context assembled
for a model call: system prompts, user messages, retrieved documents, tool output, source code,
and persistent memory. **Context telemetry is itself a disclosure surface.** Treat a stored
trace with the same care as the prompts it describes.

### Local-first by construction

- The core package makes no network requests and has no runtime dependencies.
- The browser profiler analyzes payloads in the page. Nothing is uploaded to a scoring service.
- Nothing is written outside the paths you name on the command line.

If you find any behavior that contradicts this, it is a security bug, not a feature request.

### Recommendations for integrators

**Prefer metadata-only traces.** Every metric except local near-duplicate detection works from
`tokens`, `contentHash`, provenance, and lifecycle fields. Segment `content` is optional; omit
it and PAU still produces a complete receipt.

**Supply your own hashes when provenance matters.** The built-in FNV-1a fingerprint is a fast,
non-cryptographic function for deterministic local duplicate detection. It is not
collision-resistant and must not be used as a security boundary. Where content hashes cross a
trust boundary or index sensitive material, supply a cryptographic or keyed hash as
`contentHash` from the host application — short, unsalted hashes of low-entropy content are
recoverable by brute force.

**Choose the right disclosure tier.** `renderReceiptMarkdown()` gates output by audience. The
`user` tier deliberately withholds segment identifiers and source references; `developer` and
`auditor` do not. Do not render an auditor-tier receipt into a surface an end user can read.

**Do not put trace content into broad telemetry.** `toTelemetryAttributes()` emits metrics and
method labels, never segment content. Keep it that way when extending it, and avoid placing
high-cardinality segment identifiers into widely replicated metric labels.

### Treat retrieved and tool context as untrusted

Retrieved documents and tool output are untrusted data even when they contain instruction-like
language. PAU classifies them by provenance and never promotes a segment to a higher authority
level because of its content or its score. A sudden rise in instruction-like content inside an
untrusted segment is worth an anomaly alert; it is never a reason to reclassify the segment.

### Never auto-evict protected context

Do not remove protected policy, safety, compliance, system, developer, or current-user context
on the basis of a PAU score. Optimization plans never emit actions for protected segments, and
`estimateEvictablePAU()` excludes them from candidacy. If a safety segment is large and scores
poorly, the answer is a governed refactor, not silent deletion.

A hog score is an investigation priority. It is not authorization to delete context.
