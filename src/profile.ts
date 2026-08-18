import type { ContextCategory, PAUProfile } from "./types.js";

const baseWeights: Record<ContextCategory, number> = {
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

export const basicProfile: PAUProfile = {
  id: "pau-core",
  version: "0.1-basic",
  mode: "basic",
  baseWeights,
  defaultRelevance: 1,
  defaultDensity: 1,
  defaultAuthority: 1,
  protectedTypes: ["system", "developer", "user"],
  hogEpsilon: 0.001
};

export const heuristicProfile: PAUProfile = {
  id: "pau-core",
  version: "0.1-heuristic",
  mode: "heuristic",
  baseWeights,
  defaultRelevance: 1,
  defaultDensity: 1,
  defaultAuthority: 1,
  protectedTypes: ["system", "developer", "user"],
  hogEpsilon: 0.001
};

export function profileFor(mode: "basic" | "heuristic"): PAUProfile {
  return mode === "basic" ? basicProfile : heuristicProfile;
}
