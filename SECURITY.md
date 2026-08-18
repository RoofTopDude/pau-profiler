# Security and privacy

PAU traces can contain prompts, source code, tool output, retrieved documents, and other sensitive context. The core package performs analysis locally and does not make network requests.

Integrators should prefer metadata-only traces when raw content is unnecessary. If content hashes are used for security or cross-system provenance, provide a cryptographic hash from the host application; the built-in FNV-1a fingerprint is intended only for deterministic local duplicate detection.

Do not automatically evict protected policy, safety, compliance, system, developer, or current-user context based solely on PAU scores.
