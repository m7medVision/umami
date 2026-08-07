import type { z } from 'zod';
import { experimentRunDraftSchema } from '@/lib/schema';
import type { ExperimentRuntimeTimestamps } from './types';

export type ExperimentRunDraft = z.input<typeof experimentRunDraftSchema>;
export type FrozenExperimentRunConfiguration = DeepReadonly<
  z.output<typeof experimentRunDraftSchema>
>;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export function validateExperimentRunDraft(draft: unknown) {
  return experimentRunDraftSchema.safeParse(draft);
}

export function freezeExperimentRun(draft: unknown): FrozenExperimentRunConfiguration {
  return deepFreeze(experimentRunDraftSchema.parse(draft));
}

export function calculateActiveRuntimeMs(
  timestamps: ExperimentRuntimeTimestamps,
  now: Date = new Date(),
): number {
  const startedAt = timestamps.startedAt?.getTime();
  const endedAt = (timestamps.completedAt ?? now).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    return 0;
  }

  const accumulatedPausedDurationMs = Math.max(0, timestamps.accumulatedPausedDurationMs || 0);
  const pausedAt = timestamps.pausedAt?.getTime();
  const currentPausedDurationMs =
    Number.isFinite(pausedAt) && pausedAt < endedAt
      ? Math.max(0, endedAt - Math.max(pausedAt, startedAt))
      : 0;

  return Math.max(0, endedAt - startedAt - accumulatedPausedDurationMs - currentPausedDurationMs);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value as DeepReadonly<T>;
}
