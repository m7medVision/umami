import type { ExperimentRunStatus } from './types';

const PROVISIONAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_EXPERIMENT_RUNS_PER_WEBSITE = 20;

export class ExperimentLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code = 'invalid-experiment-transition',
  ) {
    super(message);
    this.name = 'ExperimentLifecycleError';
  }
}

export interface LifecycleRun {
  status: ExperimentRunStatus | string;
  startedAt?: Date | null;
  pausedAt?: Date | null;
  completedAt?: Date | null;
  provisionalUntil?: Date | null;
  finalizedAt?: Date | null;
  archivedAt?: Date | null;
  accumulatedPausedDurationMs: number | bigint;
}

export type LifecycleAction = 'start' | 'pause' | 'resume' | 'complete' | 'archive';

function pausedDuration(run: LifecycleRun, now: Date) {
  if (!run.pausedAt) return Number(run.accumulatedPausedDurationMs);
  return (
    Number(run.accumulatedPausedDurationMs) + Math.max(0, now.getTime() - run.pausedAt.getTime())
  );
}

function requireStatus(run: LifecycleRun, action: LifecycleAction, allowed: string[]) {
  if (!allowed.includes(run.status)) {
    throw new ExperimentLifecycleError(`Cannot ${action} an Experiment Run in ${run.status}`);
  }
}

export function applyLifecycleAction<T extends LifecycleRun>(
  run: T,
  action: LifecycleAction,
  now: Date = new Date(),
): T & LifecycleRun {
  switch (action) {
    case 'start':
      requireStatus(run, action, ['Draft']);
      return { ...run, status: 'Running', startedAt: now };
    case 'pause':
      requireStatus(run, action, ['Running']);
      return { ...run, status: 'Paused', pausedAt: now };
    case 'resume':
      requireStatus(run, action, ['Paused']);
      return {
        ...run,
        status: 'Running',
        pausedAt: null,
        accumulatedPausedDurationMs: pausedDuration(run, now),
      };
    case 'complete': {
      requireStatus(run, action, ['Running', 'Paused']);
      return {
        ...run,
        status: 'Completed',
        pausedAt: null,
        accumulatedPausedDurationMs: pausedDuration(run, now),
        completedAt: now,
        provisionalUntil: new Date(now.getTime() + PROVISIONAL_WINDOW_MS),
      };
    }
    case 'archive':
      requireStatus(run, action, ['Finalized']);
      return { ...run, status: 'Archived', archivedAt: now };
  }
}

export interface FullResultSnapshot {
  results: unknown;
  diagnostics: unknown;
  safeguardResults: unknown;
  sourceDataThroughAt: Date;
  computedAt: Date;
}

export interface FullResultComputer<T extends LifecycleRun = LifecycleRun> {
  computeFull(run: T): Promise<FullResultSnapshot>;
}

export async function finalizeRun<T extends LifecycleRun>(
  run: T,
  computer: FullResultComputer<T>,
  now: Date = new Date(),
) {
  if (run.status !== 'Completed') {
    throw new ExperimentLifecycleError(`Cannot finalize an Experiment Run in ${run.status}`);
  }
  if (!run.provisionalUntil || run.provisionalUntil.getTime() > now.getTime()) {
    throw new ExperimentLifecycleError(
      'The 24-hour provisional finalization window has not elapsed',
      'experiment-provisional',
    );
  }

  const snapshot = await computer.computeFull(run);
  if (!snapshot?.computedAt || !snapshot?.sourceDataThroughAt) {
    throw new ExperimentLifecycleError(
      'Full-result computation did not return a complete snapshot',
      'experiment-computation-incomplete',
    );
  }

  return {
    run: { ...run, status: 'Finalized' as const, finalizedAt: now },
    snapshot,
  };
}

export interface RunStartValidation {
  websiteId: string;
  experimentWebsiteId: string;
  flagWebsiteId: string;
  segmentWebsiteIds: string[];
  groupWebsiteId?: string | null;
  activeWebsiteRunCount: number;
  hasActiveFlagRun: boolean;
  hasActiveExperimentRun: boolean;
}

export function validateRunStart(input: RunStartValidation) {
  const ownershipIds = [
    input.experimentWebsiteId,
    input.flagWebsiteId,
    ...input.segmentWebsiteIds,
    ...(input.groupWebsiteId ? [input.groupWebsiteId] : []),
  ];
  if (ownershipIds.some(websiteId => websiteId !== input.websiteId)) {
    throw new ExperimentLifecycleError(
      'Experiment, Feature Flag, Segment, and group must belong to the Website',
      'experiment-ownership',
    );
  }
  if (input.activeWebsiteRunCount >= MAX_ACTIVE_EXPERIMENT_RUNS_PER_WEBSITE) {
    throw new ExperimentLifecycleError(
      `A Website may have at most ${MAX_ACTIVE_EXPERIMENT_RUNS_PER_WEBSITE} active Runs`,
      'experiment-capacity',
    );
  }
  if (input.hasActiveFlagRun) {
    throw new ExperimentLifecycleError(
      'The Feature Flag already has an active Experiment Run',
      'experiment-active-flag',
    );
  }
  if (input.hasActiveExperimentRun) {
    throw new ExperimentLifecycleError(
      'The Experiment already has an active Run',
      'experiment-active-definition',
    );
  }
}

export function getRunRemoval(run: {
  status: ExperimentRunStatus | string;
  firstExposureAt?: Date | null;
}): 'delete' | 'archive' {
  if (run.status === 'Draft' && !run.firstExposureAt) return 'delete';
  if (run.status === 'Finalized') return 'archive';
  throw new ExperimentLifecycleError(
    run.status === 'Draft'
      ? 'A Draft with Exposure data cannot be hard-deleted'
      : 'Only empty Draft Runs can be deleted; finalized Runs can be archived',
    'experiment-removal-conflict',
  );
}
