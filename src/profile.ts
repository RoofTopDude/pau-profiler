import { defaultUncertaintyModel } from "./uncertainty.js";
import type {
  AnalysisMode,
  ContextCategory,
  PAUProfile,
  ProfileManifest,
  ProfileSpec,
  UncertaintyModel
} from "./types.js";

const coreWeights: Record<ContextCategory, number> = {
  system: 1.5,
  developer: 1.4,
  user: 1.3,
  history: 0.9,
  tool: 0.8,
  workspace: 0.9,
  rag: 0.7,
  browser: 0.7,
  memory: 1.1,
  code: 1.2,
  data: 0.9,
  summary: 1.0,
  other: 1.0
};

export const contextCategories = Object.keys(coreWeights) as ContextCategory[];

/**
 * The baseline class whose tokens define one PAU. PAU Core requires a profile to declare
 * this so a reader knows what the unit is normalized against.
 */
export const baselineSegmentClass: ContextCategory = "user";

function createProfile(
  id: string,
  version: string,
  mode: AnalysisMode,
  overrides: Partial<Record<ContextCategory, number>> = {},
  description?: string
): PAUProfile {
  const profile: PAUProfile = {
    id,
    version,
    mode,
    baseWeights: { ...coreWeights, ...overrides },
    defaultRelevance: 1,
    defaultDensity: 1,
    defaultAuthority: 1,
    protectedTypes: ["system", "developer", "user"],
    hogEpsilon: 0.001,
    uncertainty: defaultUncertaintyModel,
    publisher: "pau-profiler",
    status: "experimental"
  };
  if (description !== undefined) profile.description = description;
  return profile;
}

export const basicProfile = createProfile(
  "pau-core",
  "0.3-basic",
  "basic",
  {},
  "Deterministic accounting: category base weight only, no estimated factors."
);

export const heuristicProfile = createProfile(
  "pau-core",
  "0.3-heuristic",
  "heuristic",
  {},
  "General-purpose heuristic profile applying relevance, density, and authority."
);

export const codingProfile = createProfile(
  "pau-coding",
  "0.3",
  "heuristic",
  {
    code: 1.35,
    workspace: 1.05,
    tool: 0.85,
    data: 0.8,
    browser: 0.6,
    rag: 0.75
  },
  "Software-engineering agents: source and workspace context carry more decision weight."
);

export const ragProfile = createProfile(
  "pau-rag",
  "0.3",
  "heuristic",
  {
    rag: 1.0,
    data: 1.0,
    memory: 1.2,
    summary: 1.1,
    tool: 0.7,
    browser: 0.65
  },
  "Retrieval-heavy agents: retrieved evidence and memory carry more decision weight."
);

export const browserProfile = createProfile(
  "pau-browser",
  "0.3",
  "heuristic",
  {
    browser: 1.0,
    tool: 0.9,
    data: 0.85,
    history: 0.8,
    rag: 0.65
  },
  "Web agents: page snapshots dominate the payload and are weighted accordingly."
);

export const profiles = {
  "core-basic": basicProfile,
  "core-heuristic": heuristicProfile,
  coding: codingProfile,
  rag: ragProfile,
  browser: browserProfile
} as const;

export type ProfileName = keyof typeof profiles;

export function profileFor(mode: AnalysisMode): PAUProfile {
  return mode === "basic" ? basicProfile : heuristicProfile;
}

export function getProfile(name: ProfileName | string, mode?: AnalysisMode): PAUProfile {
  const selected = profiles[name as ProfileName];
  if (selected) return selected;
  if (name === "core") return profileFor(mode ?? "heuristic");
  throw new Error(
    `Unknown PAU profile: ${name}. Known profiles: ${Object.keys(profiles).join(", ")}.`
  );
}

/**
 * Builds a validated custom profile. Unspecified fields inherit the core defaults so a
 * caller can adjust one category weight without restating the whole taxonomy.
 */
export function defineProfile(spec: ProfileSpec): PAUProfile {
  if (!spec.id) throw new Error("A custom profile requires an id.");
  if (!spec.version) throw new Error(`Profile ${spec.id} requires a version.`);

  const baseWeights = { ...coreWeights };
  for (const [category, weight] of Object.entries(spec.baseWeights ?? {})) {
    if (!(category in coreWeights)) {
      throw new Error(`Profile ${spec.id} declares an unknown category: ${category}.`);
    }
    baseWeights[category as ContextCategory] = assertPositive(
      weight,
      `${spec.id}.baseWeights.${category}`
    );
  }

  for (const category of spec.protectedTypes ?? []) {
    if (!(category in coreWeights)) {
      throw new Error(`Profile ${spec.id} protects an unknown category: ${category}.`);
    }
  }

  const profile: PAUProfile = {
    id: spec.id,
    version: spec.version,
    mode: spec.mode ?? "heuristic",
    baseWeights,
    defaultRelevance: assertPositive(spec.defaultRelevance ?? 1, `${spec.id}.defaultRelevance`),
    defaultDensity: assertPositive(spec.defaultDensity ?? 1, `${spec.id}.defaultDensity`),
    defaultAuthority: assertPositive(spec.defaultAuthority ?? 1, `${spec.id}.defaultAuthority`),
    protectedTypes: spec.protectedTypes ?? ["system", "developer", "user"],
    hogEpsilon: assertPositive(spec.hogEpsilon ?? 0.001, `${spec.id}.hogEpsilon`),
    uncertainty: mergeUncertainty(spec.uncertainty),
    publisher: spec.publisher ?? "custom",
    status: spec.status ?? "experimental"
  };
  if (spec.description !== undefined) profile.description = spec.description;
  if (spec.effectiveDate !== undefined) profile.effectiveDate = spec.effectiveDate;
  return profile;
}

/**
 * Renders the PAU Core 11.2 profile manifest. A PAU value is only interpretable alongside
 * the profile that produced it, so this is the artifact that makes a number auditable.
 */
export function describeProfile(profile: PAUProfile): ProfileManifest {
  return {
    identity: {
      profileId: profile.id,
      version: profile.version,
      mode: profile.mode,
      publisher: profile.publisher ?? "unknown",
      effectiveDate: profile.effectiveDate ?? null,
      status: profile.status ?? "experimental",
      description: profile.description ?? null
    },
    baseline: {
      referenceSegmentClass: baselineSegmentClass,
      normalizationConstant: profile.baseWeights[baselineSegmentClass],
      statement:
        `One PAU is one token of ${baselineSegmentClass} context at this base weight. ` +
        "PAU values are comparable only across runs measured under the same profile version."
    },
    taxonomy: {
      categories: contextCategories,
      protectedTypes: profile.protectedTypes
    },
    weights: {
      formula: profile.mode === "basic"
        ? "PAU_i = tokens_i * baseWeight_i"
        : "PAU_i = tokens_i * baseWeight_i * relevance_i * density_i * authority_i",
      baseWeights: profile.baseWeights,
      defaultFactors: {
        relevance: profile.defaultRelevance,
        density: profile.defaultDensity,
        authority: profile.defaultAuthority
      },
      hogEpsilon: profile.hogEpsilon
    },
    uncertainty: {
      ...profile.uncertainty,
      statement:
        "Sigmas are log-space relative errors describing measurement-method confidence. " +
        "They are versioned engineering parameters, not calibrated error distributions."
    },
    governance: {
      reviewTriggers: [
        "The target model or model family changes.",
        "The tokenizer or chat template changes.",
        "The retrieval stack, tool surface, or harness architecture changes materially.",
        "The task mix shifts away from the distribution the weights were chosen for."
      ],
      limitations: [
        "Base weights are engineering parameters, not measurements of model attention.",
        "Heuristic utility is diagnostic and must not be presented as causal evidence.",
        "Cross-profile PAU comparison is not valid without a published conversion.",
        "Evictable PAU is estimated from the declared utility model, not measured by ablation."
      ]
    }
  };
}

function mergeUncertainty(partial: Partial<UncertaintyModel> | undefined): UncertaintyModel {
  if (!partial) return defaultUncertaintyModel;
  return {
    tokenSigma: { ...defaultUncertaintyModel.tokenSigma, ...partial.tokenSigma },
    baseWeightSigma: partial.baseWeightSigma ?? defaultUncertaintyModel.baseWeightSigma,
    providedFactorSigma: partial.providedFactorSigma ?? defaultUncertaintyModel.providedFactorSigma,
    defaultedFactorSigma: partial.defaultedFactorSigma ?? defaultUncertaintyModel.defaultedFactorSigma,
    utilitySigma: { ...defaultUncertaintyModel.utilitySigma, ...partial.utilitySigma },
    coverage: partial.coverage ?? defaultUncertaintyModel.coverage
  };
}

function assertPositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}
