import type { AnalysisMode, ContextCategory, PAUProfile } from "./types.js";

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

function createProfile(
  id: string,
  version: string,
  mode: AnalysisMode,
  overrides: Partial<Record<ContextCategory, number>> = {}
): PAUProfile {
  return {
    id,
    version,
    mode,
    baseWeights: { ...coreWeights, ...overrides },
    defaultRelevance: 1,
    defaultDensity: 1,
    defaultAuthority: 1,
    protectedTypes: ["system", "developer", "user"],
    hogEpsilon: 0.001
  };
}

export const basicProfile = createProfile("pau-core", "0.2-basic", "basic");
export const heuristicProfile = createProfile("pau-core", "0.2-heuristic", "heuristic");

export const codingProfile = createProfile("pau-coding", "0.2", "heuristic", {
  code: 1.35,
  workspace: 1.05,
  tool: 0.85,
  data: 0.8,
  browser: 0.6,
  rag: 0.75
});

export const ragProfile = createProfile("pau-rag", "0.2", "heuristic", {
  rag: 1.0,
  data: 1.0,
  memory: 1.2,
  summary: 1.1,
  tool: 0.7,
  browser: 0.65
});

export const browserProfile = createProfile("pau-browser", "0.2", "heuristic", {
  browser: 1.0,
  tool: 0.9,
  data: 0.85,
  history: 0.8,
  rag: 0.65
});

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
  throw new Error(`Unknown PAU profile: ${name}`);
}
