export interface FeatureFlagVariation<T = unknown> {
  value: T;
}

export interface FeatureFlagRollout {
  percentage: number;
  weights?: number[];
}

export interface EvaluableFeatureFlag<T = unknown> {
  key: string;
  enabled: boolean;
  variations: FeatureFlagVariation<T>[];
  rollout: FeatureFlagRollout;
  defaultVariation: number;
}

export type FeatureFlagEvaluationReason =
  | 'disabled'
  | 'no-key'
  | 'outside-rollout'
  | `variation-${number}`;

export interface FeatureFlagEvaluation<T = unknown> {
  value: T;
  reason: FeatureFlagEvaluationReason;
}

export function asEvaluableFeatureFlag(flag: {
  key: string;
  enabled: boolean;
  variations: unknown;
  rollout: unknown;
  defaultVariation: number;
}): EvaluableFeatureFlag {
  return {
    key: flag.key,
    enabled: flag.enabled,
    variations: flag.variations as FeatureFlagVariation[],
    rollout: flag.rollout as FeatureFlagRollout,
    defaultVariation: flag.defaultVariation,
  };
}

export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return hash >>> 0;
}

export function getFeatureFlagBucket(flagKey: string, userKey: string): number {
  const firstHash = fnv1a32(flagKey + userKey);
  return (fnv1a32(String(firstHash)) % 10_000) / 10_000;
}

export function evaluateFlag<T>(
  flag: EvaluableFeatureFlag<T>,
  userKey?: string,
): FeatureFlagEvaluation<T> {
  const fallback = flag.variations[flag.defaultVariation].value;

  if (!flag.enabled) {
    return { value: fallback, reason: 'disabled' };
  }

  if (!userKey) {
    return { value: fallback, reason: 'no-key' };
  }

  const bucket = getFeatureFlagBucket(flag.key, userKey);
  const coverage = flag.rollout.percentage / 100;

  if (bucket >= coverage) {
    return { value: fallback, reason: 'outside-rollout' };
  }

  const weights = flag.rollout.weights ?? flag.variations.map(() => 1 / flag.variations.length);
  let upperBound = 0;

  for (let index = 0; index < weights.length; index++) {
    upperBound += weights[index] * coverage;
    if (bucket < upperBound) {
      return { value: flag.variations[index].value, reason: `variation-${index}` };
    }
  }

  return { value: fallback, reason: 'outside-rollout' };
}
