import { EXPERIMENT_STATISTICS_VERSION } from './types';

export type StatisticalOutcomeModel = 'conversion' | 'count' | 'continuous';
export type DesiredDirection = 'increase' | 'decrease';
export type VariationStatisticsInput =
  | { exposed: number; conversions: number }
  | { exposed: number; count: number }
  | { values: number[] };

export interface ExperimentStatisticsInput {
  model: StatisticalOutcomeModel;
  desiredDirection: DesiredDirection;
  baselineVariation: number;
  variations: VariationStatisticsInput[];
  seed: string;
  draws?: number;
  statisticsVersion?: string;
  credibleMass?: number;
}

export interface VariationStatistics {
  variation: number;
  posteriorMean: number;
  probabilityToWin: number;
  uplift: {
    relativeToVariation: number;
    posteriorMean: number;
    credibleInterval: [number, number];
  };
  expectedLoss: number;
}

export interface ExperimentStatistics {
  statisticsVersion: typeof EXPERIMENT_STATISTICS_VERSION;
  model: StatisticalOutcomeModel;
  baselineVariation: number;
  seed: string;
  draws: number;
  variations: VariationStatistics[];
}

type Random = () => number;

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicRandom(seed: string): Random {
  let state = hashSeed(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(random: Random) {
  const first = Math.max(Number.MIN_VALUE, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

// Marsaglia and Tsang's sampler; the shape<1 transform keeps fixed priors dependency-free.
function gammaSample(shape: number, rate: number, random: Random): number {
  if (shape < 1) {
    return gammaSample(shape + 1, rate, random) * random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const normal = normalSample(random);
    const factor = 1 + c * normal;
    if (factor <= 0) continue;
    const cube = factor ** 3;
    const uniform = random();
    if (
      uniform < 1 - 0.0331 * normal ** 4 ||
      Math.log(uniform) < 0.5 * normal ** 2 + d * (1 - cube + Math.log(cube))
    ) {
      return (d * cube) / rate;
    }
  }
}

function betaSample(alpha: number, beta: number, random: Random) {
  const first = gammaSample(alpha, 1, random);
  const second = gammaSample(beta, 1, random);
  return first / (first + second);
}

function bootstrapMean(values: number[], random: Random) {
  if (!values.length) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const value of values) {
    const weight = -Math.log(Math.max(Number.MIN_VALUE, random()));
    weighted += value * weight;
    totalWeight += weight;
  }
  return weighted / totalWeight;
}

function quantile(sorted: number[], probability: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return (
    sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
  );
}

function relativeUplift(value: number, baseline: number) {
  return Math.abs(baseline) > 1e-12 ? (value - baseline) / Math.abs(baseline) : value - baseline;
}

function validateInput(input: ExperimentStatisticsInput, draws: number) {
  if (input.statisticsVersion && input.statisticsVersion !== EXPERIMENT_STATISTICS_VERSION) {
    throw new Error(`Unsupported statistics version: ${input.statisticsVersion}`);
  }
  if (input.variations.length < 2) throw new Error('At least two Variations are required');
  if (
    !Number.isInteger(input.baselineVariation) ||
    input.baselineVariation < 0 ||
    input.baselineVariation >= input.variations.length
  ) {
    throw new Error('Baseline must reference an existing Variation');
  }
  if (!Number.isInteger(draws) || draws < 100) throw new Error('At least 100 draws are required');

  for (const variation of input.variations) {
    if (input.model === 'conversion') {
      const { exposed, conversions } = variation as { exposed: number; conversions: number };
      if (
        !Number.isInteger(exposed) ||
        !Number.isInteger(conversions) ||
        exposed < 0 ||
        conversions < 0 ||
        conversions > exposed
      ) {
        throw new Error('Conversion statistics require 0 <= conversions <= exposed');
      }
    } else if (input.model === 'count') {
      const { exposed, count } = variation as { exposed: number; count: number };
      if (!Number.isInteger(exposed) || exposed < 0 || !Number.isFinite(count) || count < 0) {
        throw new Error('Count statistics require non-negative exposure and count values');
      }
    } else {
      const { values } = variation as { values: number[] };
      if (!Array.isArray(values) || values.some(value => !Number.isFinite(value))) {
        throw new Error('Continuous statistics require finite observed values');
      }
    }
  }
}

/** Deterministic bayesian-v1 computation. The seed must be persisted with/recoverable from the Run. */
export function calculateExperimentStatistics(
  input: ExperimentStatisticsInput,
): ExperimentStatistics {
  const draws = input.draws ?? 20_000;
  const credibleMass = input.credibleMass ?? 0.95;
  if (!(credibleMass > 0 && credibleMass < 1))
    throw new Error('Credible mass must be between 0 and 1');
  validateInput(input, draws);

  const random = deterministicRandom(`${EXPERIMENT_STATISTICS_VERSION}:${input.seed}`);
  const samples = input.variations.map(() => new Array<number>(draws));
  const winCounts = input.variations.map(() => 0);
  const lossTotals = input.variations.map(() => 0);
  const direction = input.desiredDirection === 'increase' ? 1 : -1;

  for (let draw = 0; draw < draws; draw++) {
    const values = input.variations.map((variation, index) => {
      let value: number;
      if (input.model === 'conversion') {
        const { exposed, conversions } = variation as { exposed: number; conversions: number };
        value = betaSample(1 + conversions, 1 + exposed - conversions, random);
      } else if (input.model === 'count') {
        const { exposed, count } = variation as { exposed: number; count: number };
        value = gammaSample(1 + count, 1 + exposed, random);
      } else {
        value = bootstrapMean((variation as { values: number[] }).values, random);
      }
      samples[index][draw] = value;
      return value;
    });

    const utilities = values.map(value => direction * value);
    const bestUtility = Math.max(...utilities);
    const winners = utilities
      .map((utility, index) => ({ utility, index }))
      .filter(item => Math.abs(item.utility - bestUtility) <= Number.EPSILON);
    for (const winner of winners) winCounts[winner.index] += 1 / winners.length;
    for (let index = 0; index < utilities.length; index++) {
      lossTotals[index] += bestUtility - utilities[index];
    }
  }

  const baselineSamples = samples[input.baselineVariation];
  const tail = (1 - credibleMass) / 2;
  const variations = samples.map((variationSamples, variation) => {
    const inputVariation = input.variations[variation];
    const posteriorMean =
      input.model === 'conversion'
        ? (1 + (inputVariation as { conversions: number }).conversions) /
          (2 + (inputVariation as { exposed: number }).exposed)
        : input.model === 'count'
          ? (1 + (inputVariation as { count: number }).count) /
            (1 + (inputVariation as { exposed: number }).exposed)
          : (inputVariation as { values: number[] }).values.length
            ? (inputVariation as { values: number[] }).values.reduce(
                (sum, value) => sum + value,
                0,
              ) / (inputVariation as { values: number[] }).values.length
            : 0;
    const uplifts = variationSamples
      .map((value, draw) => relativeUplift(value, baselineSamples[draw]))
      .sort((first, second) => first - second);
    return {
      variation,
      posteriorMean,
      probabilityToWin: winCounts[variation] / draws,
      uplift: {
        relativeToVariation: input.baselineVariation,
        posteriorMean: uplifts.reduce((sum, value) => sum + value, 0) / draws,
        credibleInterval: [quantile(uplifts, tail), quantile(uplifts, 1 - tail)] as [
          number,
          number,
        ],
      },
      expectedLoss: lossTotals[variation] / draws,
    };
  });

  return {
    statisticsVersion: EXPERIMENT_STATISTICS_VERSION,
    model: input.model,
    baselineVariation: input.baselineVariation,
    seed: input.seed,
    draws,
    variations,
  };
}
