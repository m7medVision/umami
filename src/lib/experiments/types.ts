import type { FeatureFlagRollout, FeatureFlagVariation } from '@/lib/flags';

export const EXPERIMENT_RUN_STATUSES = [
  'Draft',
  'Running',
  'Paused',
  'Completed',
  'Finalized',
  'Archived',
] as const;

export type ExperimentRunStatus = (typeof EXPERIMENT_RUN_STATUSES)[number];

export const ACTIVE_EXPERIMENT_RUN_STATUSES = [
  'Running',
  'Paused',
] as const satisfies readonly ExperimentRunStatus[];

export const EXPERIMENT_OUTCOME_TYPES = [
  'conversion',
  'count',
  'value',
  'revenue',
  'duration',
] as const;
export const EXPERIMENT_OUTCOME_ROLES = ['primary', 'secondary'] as const;
export const EXPERIMENT_COUNTING_MODES = ['unique', 'count', 'sum'] as const;
export const EXPERIMENT_ATTRIBUTION_SCOPES = ['session', 'visitor', 'both'] as const;
export const EXPERIMENT_DESIRED_DIRECTIONS = ['increase', 'decrease'] as const;
export const EXPERIMENT_STANDARD_METRICS = [
  'pageview',
  'visit',
  'revenue',
  'session-duration',
] as const;

export const EXPERIMENT_STATISTICS_VERSION = 'bayesian-v1' as const;
export const EXPERIMENT_BUCKETING_VERSION = 'fnv1a32-v1' as const;

export const EXPERIMENT_ASSIGNMENT_POLICY = {
  identified: 'visitor',
  anonymous: 'session',
} as const;

export const EXPERIMENT_STATISTICAL_MODEL = {
  conversion: { model: 'beta-binomial', alpha: 1, beta: 1 },
  count: { model: 'gamma-poisson', shape: 1, rate: 1 },
  continuous: { model: 'bayesian-bootstrap' },
} as const;

export const EXPERIMENT_SAFEGUARD_DEFAULTS = {
  minimumSampleSizePerVariation: 100,
  minimumActiveDays: 7,
  probabilityToWinThreshold: 0.95,
  expectedLossThreshold: 0.01,
  sampleRatioMismatchAlpha: 0.01,
} as const;

export interface ExperimentFeatureFlagSnapshot {
  key: string;
  valueType: 'boolean' | 'string' | 'number' | 'json';
  variations: FeatureFlagVariation[];
  rollout: FeatureFlagRollout & { weights: number[] };
  fallthroughVariation: number;
}

export interface ExperimentRuntimeTimestamps {
  startedAt: Date | null;
  pausedAt?: Date | null;
  completedAt?: Date | null;
  accumulatedPausedDurationMs: number;
}
