import type {
  PAUInterval,
  TokenCountMethod,
  UncertaintyModel,
  UtilityMethod
} from "./types.js";

/**
 * Default uncertainty model.
 *
 * Sigmas are log-space standard deviations expressed as approximate relative error.
 * They are versioned engineering parameters that describe how much confidence a
 * measurement method deserves, not measured error distributions. A profile that has
 * been empirically calibrated should replace them.
 */
export const defaultUncertaintyModel: UncertaintyModel = {
  tokenSigma: {
    provided: 0,
    custom: 0.02,
    estimated: 0.22
  },
  baseWeightSigma: 0.1,
  providedFactorSigma: 0.05,
  defaultedFactorSigma: 0.12,
  utilitySigma: {
    provided: 0.05,
    heuristic: 0.3,
    none: 0
  },
  coverage: 1.96
};

export interface SegmentUncertaintyInput {
  pau: number;
  tokenCountMethod: TokenCountMethod;
  utilityMethod: UtilityMethod;
  /** True when the caller supplied the factor explicitly rather than inheriting a profile default. */
  relevanceProvided: boolean;
  densityProvided: boolean;
  authorityProvided: boolean;
  /** Basic mode applies only the category base weight, so factor sigmas do not contribute. */
  appliesFactors: boolean;
}

/**
 * Combined log-space sigma for one segment's PAU value.
 *
 * Sources of error are treated as independent and combined in quadrature, which is the
 * standard first-order propagation for a product of factors. Utility error is excluded:
 * it affects Context Hog scoring, not the PAU value itself.
 */
export function segmentSigma(input: SegmentUncertaintyInput, model: UncertaintyModel): number {
  const terms: number[] = [
    model.tokenSigma[input.tokenCountMethod] ?? 0,
    model.baseWeightSigma
  ];

  if (input.appliesFactors) {
    terms.push(factorSigma(input.relevanceProvided, model));
    terms.push(factorSigma(input.densityProvided, model));
    terms.push(factorSigma(input.authorityProvided, model));
  }

  return quadrature(terms);
}

/**
 * Log-normal interval for a single segment. PAU is a product of non-negative factors, so
 * the multiplicative form keeps the lower bound above zero and stays asymmetric the way a
 * product of uncertain factors actually behaves.
 */
export function segmentInterval(pau: number, sigma: number, model: UncertaintyModel): PAUInterval {
  if (sigma === 0 || pau === 0) return { low: pau, high: pau, sigma: 0, coverage: model.coverage };
  const spread = model.coverage * sigma;
  return {
    low: pau * Math.exp(-spread),
    high: pau * Math.exp(spread),
    sigma,
    coverage: model.coverage
  };
}

/**
 * Interval for a sum of segments.
 *
 * Segment errors are combined in quadrature rather than by adding each segment's worst
 * case, because independent errors partially cancel. Adding the bounds directly would
 * describe the case where every segment is wrong in the same direction at once, which
 * overstates total uncertainty on any realistic trace.
 */
export function totalInterval(
  contributions: Array<{ pau: number; sigma: number }>,
  model: UncertaintyModel
): PAUInterval {
  const total = contributions.reduce((sum, item) => sum + item.pau, 0);
  const absoluteSigma = quadrature(contributions.map((item) => item.pau * item.sigma));
  if (absoluteSigma === 0 || total === 0) {
    return { low: total, high: total, sigma: 0, coverage: model.coverage };
  }
  const spread = model.coverage * absoluteSigma;
  return {
    low: Math.max(0, total - spread),
    high: total + spread,
    sigma: absoluteSigma / total,
    coverage: model.coverage
  };
}

function factorSigma(provided: boolean, model: UncertaintyModel): number {
  return provided ? model.providedFactorSigma : model.defaultedFactorSigma;
}

function quadrature(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}
