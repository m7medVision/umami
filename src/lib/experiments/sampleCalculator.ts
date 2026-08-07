export interface ExperimentSampleGuidanceInput {
  /** Baseline conversion probability, expressed from 0 to 1. */
  baselineRate: number;
  /** Smallest absolute probability-point difference worth detecting. */
  minimumDetectableEffect: number;
  /** Eligible experimental units expected per day across all Variations. */
  expectedDailyTraffic: number;
  variationCount: number;
}

export interface ExperimentSampleGuidance {
  sampleSizePerVariation: number;
  totalSampleSize: number;
  estimatedRuntimeDays: number;
  confidenceLevel: 0.95;
  power: 0.8;
}

// Peter J. Acklam's inverse-normal approximation. Accuracy is ample for planning guidance.
function inverseNormal(probability: number) {
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472,
    2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373,
    4.37466414146497, 2.93816398269878,
  ];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = probability - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * Guidance-only fixed-horizon approximation for a two-sided difference in proportions.
 * Alpha is Bonferroni-adjusted for each non-Baseline comparison. It never decides whether a Run
 * may start and is deliberately not part of lifecycle validation.
 */
export function calculateExperimentSampleGuidance(
  input: ExperimentSampleGuidanceInput,
): ExperimentSampleGuidance {
  const { baselineRate, minimumDetectableEffect, expectedDailyTraffic, variationCount } = input;
  const treatmentRate = baselineRate + minimumDetectableEffect;

  if (!Number.isFinite(baselineRate) || baselineRate <= 0 || baselineRate >= 1) {
    throw new RangeError('Baseline rate must be greater than 0 and less than 1.');
  }
  if (
    !Number.isFinite(minimumDetectableEffect) ||
    minimumDetectableEffect <= 0 ||
    treatmentRate >= 1
  ) {
    throw new RangeError('MDE must be positive and keep the expected treatment rate below 1.');
  }
  if (!Number.isFinite(expectedDailyTraffic) || expectedDailyTraffic <= 0) {
    throw new RangeError('Expected daily traffic must be positive.');
  }
  if (!Number.isInteger(variationCount) || variationCount < 2 || variationCount > 10) {
    throw new RangeError('Variation count must be an integer from 2 through 10.');
  }

  const alphaPerComparison = 0.05 / (variationCount - 1);
  const zAlpha = inverseNormal(1 - alphaPerComparison / 2);
  const zPower = inverseNormal(0.8);
  const pooledRate = (baselineRate + treatmentRate) / 2;
  const numerator =
    zAlpha * Math.sqrt(2 * pooledRate * (1 - pooledRate)) +
    zPower * Math.sqrt(baselineRate * (1 - baselineRate) + treatmentRate * (1 - treatmentRate));
  const sampleSizePerVariation = Math.ceil(
    (numerator * numerator) / (minimumDetectableEffect * minimumDetectableEffect),
  );
  const totalSampleSize = sampleSizePerVariation * variationCount;

  return {
    sampleSizePerVariation,
    totalSampleSize,
    estimatedRuntimeDays: Math.ceil(totalSampleSize / expectedDailyTraffic),
    confidenceLevel: 0.95,
    power: 0.8,
  };
}
