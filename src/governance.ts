import { round } from "./math.js";
import type {
  AuthorityClass,
  ContextCategory,
  ContextSegmentInput,
  GovernanceLedger,
  GovernanceRecord,
  PAUProfile,
  TransformationName
} from "./types.js";

const ALL_TRANSFORMATIONS: TransformationName[] = [
  "retain",
  "reposition",
  "compress",
  "summarize",
  "retrieve-on-demand",
  "evict"
];

/**
 * Transformations permitted for each authority class.
 *
 * This table is the whole point of the governance ledger. Whether a segment may be removed is
 * a property of what it IS, not of how influential it measured. A safety constraint that fires
 * in one run out of a thousand will look worthless to any counterfactual evaluation over
 * routine traffic; that is a fact about the traffic, not permission to delete the constraint.
 *
 * The optimizer consults this before it looks at any score, so a low measurement can never
 * unlock an action that governance forbids.
 */
const permittedByAuthority: Record<AuthorityClass, TransformationName[]> = {
  "mandatory-policy": ["retain"],
  "application-instruction": ["retain", "reposition"],
  "current-user": ["retain", "reposition"],
  advisory: ALL_TRANSFORMATIONS,
  "untrusted-external": ALL_TRANSFORMATIONS
};

const authorityByCategory: Partial<Record<ContextCategory, AuthorityClass>> = {
  system: "mandatory-policy",
  developer: "application-instruction",
  user: "current-user",
  tool: "untrusted-external",
  rag: "untrusted-external",
  browser: "untrusted-external",
  data: "untrusted-external"
};

/**
 * Builds the governance ledger for a trace.
 *
 * PAU keeps two ledgers. The measurement ledger answers "what did this context cost and what
 * did it appear to contribute". This one answers "what is the system obligated to preserve".
 * They are computed independently and combined only at the policy layer.
 */
export function buildGovernanceLedger(
  segments: Array<{ input: ContextSegmentInput; tokens: number; pau: number; protected: boolean }>,
  profile: PAUProfile
): GovernanceLedger {
  const records: GovernanceRecord[] = segments.map((segment) => {
    const authority = resolveAuthority(segment.input, segment.protected, profile);
    const retentionLock = authority === "mandatory-policy"
      || authority === "application-instruction"
      || authority === "current-user";
    const record: GovernanceRecord = {
      segmentId: segment.input.id,
      authority,
      mandatory: authority === "mandatory-policy",
      retentionLock,
      sensitivity: resolveSensitivity(segment.input),
      allowedTransformations: permittedByAuthority[authority],
      basis: basisFor(authority, segment.input)
    };
    return record;
  });

  const locked = records.filter((record) => record.retentionLock);
  const lockedIds = new Set(locked.map((record) => record.segmentId));

  return {
    records,
    lockedSegmentIds: [...lockedIds],
    lockedTokens: segments
      .filter((segment) => lockedIds.has(segment.input.id))
      .reduce((total, segment) => total + segment.tokens, 0),
    lockedPAU: round(
      segments
        .filter((segment) => lockedIds.has(segment.input.id))
        .reduce((total, segment) => total + segment.pau, 0),
      2
    ),
    statement:
      "Retention locks derive from segment authority and sensitivity, never from a measured "
      + "score. A low utility estimate does not make locked context removable."
  };
}

/** True when a transformation is permitted for the segment by the governance ledger. */
export function isTransformationAllowed(
  ledger: GovernanceLedger,
  segmentId: string,
  transformation: TransformationName
): boolean {
  const record = ledger.records.find((entry) => entry.segmentId === segmentId);
  if (!record) return true;
  return record.allowedTransformations.includes(transformation);
}

export function governanceFor(
  ledger: GovernanceLedger,
  segmentId: string
): GovernanceRecord | undefined {
  return ledger.records.find((entry) => entry.segmentId === segmentId);
}

function resolveAuthority(
  input: ContextSegmentInput,
  isProtected: boolean,
  profile: PAUProfile
): AuthorityClass {
  if (input.authorityClass !== undefined) return input.authorityClass;

  const byCategory = authorityByCategory[input.type];
  if (byCategory !== undefined) {
    // An explicit protected:false on a normally locked category is a deliberate downgrade
    // by the harness, so honor it rather than overriding the caller.
    if (input.protected === false && byCategory !== "untrusted-external") return "advisory";
    return byCategory;
  }

  if (isProtected || profile.protectedTypes.includes(input.type)) return "application-instruction";
  return "advisory";
}

function resolveSensitivity(input: ContextSegmentInput): GovernanceRecord["sensitivity"] {
  return input.sensitivity ?? "internal";
}

function basisFor(authority: AuthorityClass, input: ContextSegmentInput): string {
  switch (authority) {
    case "mandatory-policy":
      return "Mandatory policy or safety context. Excluded from optimization by architecture.";
    case "application-instruction":
      return "Application instruction that defines how the agent is expected to behave.";
    case "current-user":
      return "The current user request. Removing it changes the task rather than its cost.";
    case "untrusted-external":
      return `External data from ${input.source ?? input.type}. Freely transformable, and never `
        + "promoted to a higher authority by its content.";
    default:
      return "Advisory context with no retention obligation.";
  }
}
