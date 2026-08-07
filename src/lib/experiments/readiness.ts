import type { VariationStatistics } from './statistics';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReadinessSafeguards {
  minimumSampleSizePerVariation: number;
  minimumActiveDays: number;
  probabilityToWinThreshold: number;
  expectedLossThreshold: number;
  sampleRatioMismatchAlpha: number;
}

export interface ReadinessInput {
  exposedUnits: number[];
  expectedWeights: number[];
  activeRuntimeMs: number;
  safeguards: ReadinessSafeguards;
  primaryOutcome: {
    variations: Pick<VariationStatistics, 'variation' | 'probabilityToWin' | 'expectedLoss'>[];
  };
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5)
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.9999999999998099;
  const adjusted = value - 1;
  for (let index = 0; index < coefficients.length; index++)
    x += coefficients[index] / (adjusted + index + 1);
  const term = adjusted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (adjusted + 0.5) * Math.log(term) - term + Math.log(x);
}

// Regularized upper incomplete gamma Q(a,x), used for the chi-square survival probability.
function gammaQ(shape: number, value: number): number {
  if (value <= 0) return 1;
  if (value < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    let currentShape = shape;
    for (let index = 0; index < 200; index++) {
      currentShape += 1;
      term *= value / currentShape;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    const lower = sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
    return Math.max(0, Math.min(1, 1 - lower));
  }

  let b = value + 1 - shape;
  let c = 1 / Number.MIN_VALUE;
  let d = 1 / b;
  let fraction = d;
  for (let index = 1; index <= 200; index++) {
    const coefficient = -index * (index - shape);
    b += 2;
    d = coefficient * d + b;
    if (Math.abs(d) < Number.MIN_VALUE) d = Number.MIN_VALUE;
    c = b + coefficient / c;
    if (Math.abs(c) < Number.MIN_VALUE) c = Number.MIN_VALUE;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.max(
    0,
    Math.min(1, Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * fraction),
  );
}

export function detectSampleRatioMismatch(
  observed: number[],
  expectedWeights: number[],
  alpha: number,
) {
  if (
    observed.length < 2 ||
    observed.length !== expectedWeights.length ||
    observed.some(value => !Number.isFinite(value) || value < 0) ||
    expectedWeights.some(value => !Number.isFinite(value) || value <= 0) ||
    Math.abs(expectedWeights.reduce((sum, value) => sum + value, 0) - 1) > 0.000001
  ) {
    throw new Error('SRM requires matching non-negative counts and positive normalized weights');
  }
  const total = observed.reduce((sum, value) => sum + value, 0);
  if (!total) return { mismatch: false, pValue: 1, chiSquare: 0 };
  const chiSquare = observed.reduce((sum, value, index) => {
    const expected = total * expectedWeights[index];
    return sum + (value - expected) ** 2 / expected;
  }, 0);
  const pValue = gammaQ((observed.length - 1) / 2, chiSquare / 2);
  return { mismatch: pValue < alpha, pValue, chiSquare };
}

/** Computes a recommendation only. It never changes Run state or Feature Flag configuration. */
export function calculateExperimentReadiness(input: ReadinessInput) {
  const { safeguards } = input;
  const srm = detectSampleRatioMismatch(
    input.exposedUnits,
    input.expectedWeights,
    safeguards.sampleRatioMismatchAlpha,
  );
  const candidate = input.primaryOutcome.variations.reduce((best, variation) =>
    !best || variation.probabilityToWin > best.probabilityToWin ? variation : best,
  );

  const checks = {
    minimumSample: {
      passed: input.exposedUnits.every(
        exposed => exposed >= safeguards.minimumSampleSizePerVariation,
      ),
      observed: input.exposedUnits,
      threshold: safeguards.minimumSampleSizePerVariation,
    },
    minimumRuntime: {
      passed: input.activeRuntimeMs >= safeguards.minimumActiveDays * DAY_MS,
      activeRuntimeMs: input.activeRuntimeMs,
      thresholdMs: safeguards.minimumActiveDays * DAY_MS,
    },
    sampleRatioMismatch: {
      passed: !srm.mismatch,
      ...srm,
      alpha: safeguards.sampleRatioMismatchAlpha,
    },
    probabilityToWin: {
      passed: !!candidate && candidate.probabilityToWin >= safeguards.probabilityToWinThreshold,
      observed: candidate?.probabilityToWin ?? 0,
      threshold: safeguards.probabilityToWinThreshold,
    },
    expectedLoss: {
      passed: !!candidate && candidate.expectedLoss <= safeguards.expectedLossThreshold,
      observed: candidate?.expectedLoss ?? Number.POSITIVE_INFINITY,
      threshold: safeguards.expectedLossThreshold,
    },
  };
  const ready = Object.values(checks).every(check => check.passed);
  return {
    status: ready ? ('Ready' as const) : ('NotReady' as const),
    ready,
    winnerVariation: candidate?.variation ?? null,
    checks,
  };
}
