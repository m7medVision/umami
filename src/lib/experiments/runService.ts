import { Prisma } from '@/generated/prisma/client';
import clickhouse from '@/lib/clickhouse';
import { uuid } from '@/lib/crypto';
import { clearWebsiteFeatureFlags } from '@/lib/load';
import prisma from '@/lib/prisma';
import { clickhouseExperimentResultComputer } from '@/queries/sql/experiments/results';
import type { ExperimentRunDraft } from './domain';
import { freezeExperimentRun, validateExperimentRunDraft } from './domain';
import {
  applyLifecycleAction,
  type FullResultSnapshot,
  finalizeRun,
  getRunRemoval,
  validateRunStart,
} from './lifecycle';
import {
  buildExperimentNotification,
  type ExperimentNotificationType,
  getResultNotificationFacts,
} from './notifications';
import { validateRealtimeSegmentSnapshot } from './segmentEligibility';
import { ACTIVE_EXPERIMENT_RUN_STATUSES } from './types';

export class ExperimentServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = 'ExperimentServiceError';
  }
}

export interface ExperimentResultComputation {
  computeFull(input: { run: any; outcomes: any[] }): Promise<FullResultSnapshot>;
  computeIncremental?(input: { run: any; outcomes: any[] }): Promise<FullResultSnapshot>;
}

export interface ExperimentRepository {
  transaction<T>(operation: (repository: ExperimentRepository) => Promise<T>): Promise<T>;
  getExperiment(websiteId: string, experimentId: string): Promise<any | null>;
  listExperiments(websiteId: string): Promise<any[]>;
  createExperiment(data: any): Promise<any>;
  updateExperiment(id: string, data: any): Promise<any>;
  deleteExperiment(id: string): Promise<void>;
  getFeatureFlag(websiteId: string, featureFlagId: string): Promise<any | null>;
  getSegment(websiteId: string, segmentId: string): Promise<any | null>;
  getGroup(websiteId: string, groupId: string): Promise<any | null>;
  getRun(websiteId: string, experimentId: string, runId: string): Promise<any | null>;
  listRuns(websiteId: string, experimentId: string): Promise<any[]>;
  createRun(data: any, outcomes: any[]): Promise<any>;
  updateRun(id: string, data: any): Promise<any>;
  replaceOutcomes(runId: string, outcomes: any[]): Promise<void>;
  deleteRun(id: string): Promise<void>;
  countActiveWebsiteRuns(websiteId: string): Promise<number>;
  findActiveFlagRun(websiteId: string, featureFlagId: string): Promise<any | null>;
  findActiveExperimentRun(websiteId: string, experimentId: string): Promise<any | null>;
  createResultSnapshot(data: any): Promise<any>;
  getActivePromotion(runId: string): Promise<any | null>;
  createPromotion(data: any): Promise<any>;
  updatePromotion(id: string, data: any): Promise<any>;
  updateFlagOptimistic(id: string, expectedUpdatedAt: Date | null, data: any): Promise<any | null>;
  countFlagRuns(featureFlagId: string, statuses: string[]): Promise<number>;
  createNotificationIfAbsent(data: any): Promise<any>;
}

function prismaRepository(client: any = prisma.client): ExperimentRepository {
  const repository: ExperimentRepository = {
    transaction: operation => client.$transaction((tx: any) => operation(prismaRepository(tx))),
    getExperiment: (websiteId, id) =>
      client.experiment.findFirst({ where: { id, websiteId }, include: { featureFlag: true } }),
    listExperiments: websiteId =>
      client.experiment.findMany({
        where: { websiteId, archivedAt: null },
        include: { featureFlag: true },
        orderBy: { createdAt: 'desc' },
      }),
    createExperiment: data => client.experiment.create({ data }),
    updateExperiment: (id, data) => client.experiment.update({ where: { id }, data }),
    deleteExperiment: async id => {
      await client.experiment.delete({ where: { id } });
    },
    getFeatureFlag: (websiteId, id) =>
      client.featureFlag.findFirst({ where: { id, websiteId, archivedAt: null } }),
    getSegment: (websiteId, id) => client.segment.findFirst({ where: { id, websiteId } }),
    getGroup: (websiteId, id) =>
      client.mutualExclusionGroup.findFirst({ where: { id, websiteId, archivedAt: null } }),
    getRun: (websiteId, experimentId, id) =>
      client.experimentRun.findFirst({
        where: { id, websiteId, experimentId },
        include: {
          outcomes: { orderBy: { position: 'asc' } },
          resultSnapshot: true,
          promotions: { orderBy: { promotedAt: 'desc' } },
        },
      }),
    listRuns: (websiteId, experimentId) =>
      client.experimentRun.findMany({
        where: { websiteId, experimentId },
        include: { outcomes: { orderBy: { position: 'asc' } }, resultSnapshot: true },
        orderBy: { runNumber: 'desc' },
      }),
    createRun: (data, outcomes) =>
      client.experimentRun.create({
        data: { ...data, outcomes: { create: outcomes } },
        include: { outcomes: { orderBy: { position: 'asc' } } },
      }),
    updateRun: (id, data) => client.experimentRun.update({ where: { id }, data }),
    replaceOutcomes: async (runId, outcomes) => {
      await client.experimentOutcome.deleteMany({ where: { experimentRunId: runId } });
      await client.experimentOutcome.createMany({
        data: outcomes.map(outcome => ({ ...outcome, experimentRunId: runId })),
      });
    },
    deleteRun: async id => {
      await client.experimentRun.delete({ where: { id } });
    },
    countActiveWebsiteRuns: websiteId =>
      client.experimentRun.count({
        where: { websiteId, status: { in: [...ACTIVE_EXPERIMENT_RUN_STATUSES] } },
      }),
    findActiveFlagRun: (websiteId, featureFlagId) =>
      client.experimentRun.findFirst({
        where: {
          websiteId,
          featureFlagId,
          status: { in: [...ACTIVE_EXPERIMENT_RUN_STATUSES] },
        },
      }),
    findActiveExperimentRun: (websiteId, experimentId) =>
      client.experimentRun.findFirst({
        where: {
          websiteId,
          experimentId,
          status: { in: [...ACTIVE_EXPERIMENT_RUN_STATUSES] },
        },
      }),
    createResultSnapshot: data => client.experimentResultSnapshot.create({ data }),
    getActivePromotion: experimentRunId =>
      client.experimentPromotion.findFirst({
        where: { experimentRunId, rolledBackAt: null },
        orderBy: { promotedAt: 'desc' },
      }),
    createPromotion: data => client.experimentPromotion.create({ data }),
    updatePromotion: (id, data) => client.experimentPromotion.update({ where: { id }, data }),
    updateFlagOptimistic: async (id, expectedUpdatedAt, data) => {
      const result = await client.featureFlag.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data,
      });
      return result.count === 1 ? client.featureFlag.findUnique({ where: { id } }) : null;
    },
    countFlagRuns: (featureFlagId, statuses) =>
      client.experimentRun.count({ where: { featureFlagId, status: { in: statuses } } }),
    createNotificationIfAbsent: data =>
      client.experimentNotification.upsert({
        where: { dedupeKey: data.dedupeKey },
        create: { ...data, data: jsonValue(data.data) },
        update: {},
      }),
  };
  return repository;
}

function jsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function normalizeWeights(flag: any) {
  const rollout = flag.rollout as { percentage: number; weights?: number[] };
  return {
    percentage: rollout.percentage,
    weights: rollout.weights ?? flag.variations.map(() => 1 / flag.variations.length),
  };
}

function flagSnapshot(flag: any) {
  return {
    key: flag.key,
    valueType: flag.valueType,
    variations: flag.variations,
    rollout: normalizeWeights(flag),
    fallthroughVariation: flag.defaultVariation,
  };
}

function segmentSnapshot(segment: any) {
  return segment
    ? {
        segmentId: segment.id,
        type: segment.type,
        name: segment.name,
        parameters: segment.parameters,
      }
    : null;
}

function outcomesToRows(runId: string, outcomes: ExperimentRunDraft['outcomes']) {
  return outcomes.map((outcome, position) => ({
    id: uuid(),
    experimentRunId: runId,
    position,
    name: outcome.name,
    type: outcome.type,
    sourceType: outcome.source.type,
    sourceValue: outcome.source.type === 'event' ? outcome.source.eventName : outcome.source.metric,
    numericField: outcome.source.type === 'event' ? outcome.source.numericField : null,
    countingMode: outcome.countingMode,
    attributionScope: outcome.attributionScope,
    visitorWindowDays: outcome.visitorWindowDays,
    desiredDirection: outcome.desiredDirection,
    role: outcome.role,
    currency: outcome.currency,
  }));
}

function rowToOutcome(outcome: any) {
  return {
    name: outcome.name,
    type: outcome.type,
    source:
      outcome.sourceType === 'event'
        ? {
            type: 'event',
            eventName: outcome.sourceValue,
            ...(outcome.numericField ? { numericField: outcome.numericField } : {}),
          }
        : { type: 'standard', metric: outcome.sourceValue },
    countingMode: outcome.countingMode,
    attributionScope: outcome.attributionScope,
    visitorWindowDays: outcome.visitorWindowDays,
    desiredDirection: outcome.desiredDirection,
    role: outcome.role,
    ...(outcome.currency ? { currency: outcome.currency } : {}),
  };
}

function runToDraft(run: any): ExperimentRunDraft {
  return {
    featureFlag: {
      key: run.featureFlagKey,
      valueType: run.featureFlagValueType,
      variations: run.featureFlagVariations,
      rollout: { percentage: run.rolloutPercentage, weights: run.variationWeights },
      fallthroughVariation: run.fallthroughVariation,
    },
    baselineVariation: run.baselineVariation,
    outcomes: run.outcomes.map(rowToOutcome),
    assignmentPolicy: run.assignmentPolicy,
    audienceSegment: run.audienceSegmentSnapshot,
    exclusionSegment: run.exclusionSegmentSnapshot,
    statisticsVersion: run.statisticsVersion,
    bucketingVersion: run.bucketingVersion,
    statisticalModel: run.statisticalModel,
    safeguards: run.safeguards,
  } as ExperimentRunDraft;
}

function draftFields(draft: ExperimentRunDraft) {
  const frozen = freezeExperimentRun(draft);
  return {
    featureFlagKey: frozen.featureFlag.key,
    featureFlagValueType: frozen.featureFlag.valueType,
    featureFlagVariations: jsonValue(frozen.featureFlag.variations),
    variationWeights: jsonValue(frozen.featureFlag.rollout.weights),
    rolloutPercentage: frozen.featureFlag.rollout.percentage,
    fallthroughVariation: frozen.featureFlag.fallthroughVariation,
    baselineVariation: frozen.baselineVariation,
    assignmentPolicy: jsonValue(frozen.assignmentPolicy),
    audienceSegmentSnapshot: frozen.audienceSegment
      ? jsonValue(frozen.audienceSegment)
      : Prisma.DbNull,
    exclusionSegmentSnapshot: frozen.exclusionSegment
      ? jsonValue(frozen.exclusionSegment)
      : Prisma.DbNull,
    statisticsVersion: frozen.statisticsVersion,
    bucketingVersion: frozen.bucketingVersion,
    statisticalModel: jsonValue(frozen.statisticalModel),
    safeguards: jsonValue(frozen.safeguards),
  };
}

const flagConfigurationKeys = [
  'key',
  'name',
  'description',
  'valueType',
  'enabled',
  'variations',
  'rollout',
  'defaultVariation',
] as const;

function flagConfiguration(flag: any) {
  return Object.fromEntries(flagConfigurationKeys.map(key => [key, flag[key]]));
}

function sameConfiguration(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function createNotification(
  repository: ExperimentRepository,
  run: any,
  type: ExperimentNotificationType,
  now: Date,
  data: Record<string, unknown> = {},
) {
  return repository.createNotificationIfAbsent(buildExperimentNotification(run, type, data, now));
}

export interface RunServiceDependencies {
  repository?: ExperimentRepository;
  resultComputer?: ExperimentResultComputation;
  now?: () => Date;
  invalidateFlags?: (websiteId: string) => Promise<void>;
}

export function createExperimentRunService(dependencies: RunServiceDependencies = {}) {
  const repository = dependencies.repository ?? prismaRepository();
  const now = dependencies.now ?? (() => new Date());
  const invalidateFlags = dependencies.invalidateFlags ?? clearWebsiteFeatureFlags;
  const resultComputer =
    dependencies.resultComputer ??
    (clickhouse.enabled ? clickhouseExperimentResultComputer : undefined);

  async function computeRunResults(run: any, mode: 'full' | 'incremental' = 'full') {
    if (!resultComputer) {
      throw new ExperimentServiceError(
        'Full-result computation is not configured',
        'experiment-computation-unavailable',
        503,
      );
    }
    const compute =
      mode === 'incremental' && resultComputer.computeIncremental
        ? resultComputer.computeIncremental
        : resultComputer.computeFull;
    return compute.call(resultComputer, { run, outcomes: run.outcomes });
  }

  async function requireExperiment(websiteId: string, experimentId: string) {
    const experiment = await repository.getExperiment(websiteId, experimentId);
    if (!experiment)
      throw new ExperimentServiceError('Experiment not found', 'experiment-not-found', 404);
    return experiment;
  }

  async function requireRun(websiteId: string, experimentId: string, runId: string) {
    const run = await repository.getRun(websiteId, experimentId, runId);
    if (!run)
      throw new ExperimentServiceError('Experiment Run not found', 'experiment-run-not-found', 404);
    return run;
  }

  return {
    listExperiments: (websiteId: string) => repository.listExperiments(websiteId),
    getExperiment: requireExperiment,
    async createExperiment(
      websiteId: string,
      input: { featureFlagId: string; name: string; description?: string | null },
    ) {
      const flag = await repository.getFeatureFlag(websiteId, input.featureFlagId);
      if (!flag)
        throw new ExperimentServiceError(
          'Feature Flag not found for Website',
          'experiment-flag-not-found',
          400,
        );
      return repository.createExperiment({ id: uuid(), websiteId, ...input });
    },
    async updateExperiment(
      websiteId: string,
      experimentId: string,
      input: { name?: string; description?: string | null },
    ) {
      await requireExperiment(websiteId, experimentId);
      return repository.updateExperiment(experimentId, input);
    },
    async removeExperiment(websiteId: string, experimentId: string) {
      await requireExperiment(websiteId, experimentId);
      const runs = await repository.listRuns(websiteId, experimentId);
      const removableDrafts = runs.filter(run => run.status === 'Draft' && !run.firstExposureAt);
      const finalizedRuns = runs.filter(run => run.status === 'Finalized');
      const historicalRuns = runs.filter(run => ['Finalized', 'Archived'].includes(run.status));
      const blockedRuns = runs.filter(
        run =>
          !['Finalized', 'Archived'].includes(run.status) &&
          !(run.status === 'Draft' && !run.firstExposureAt),
      );
      if (blockedRuns.length) {
        throw new ExperimentServiceError(
          'Complete and finalize active or provisional Runs before archiving the Experiment',
          'experiment-historical-runs',
        );
      }

      if (!historicalRuns.length) {
        await repository.transaction(async transaction => {
          for (const run of removableDrafts) await transaction.deleteRun(run.id);
          await transaction.deleteExperiment(experimentId);
        });
        return { deleted: true, archived: false };
      }

      const archivedAt = now();
      await repository.transaction(async transaction => {
        for (const run of removableDrafts) await transaction.deleteRun(run.id);
        for (const run of finalizedRuns) {
          await transaction.updateRun(run.id, { status: 'Archived', archivedAt });
        }
        await transaction.updateExperiment(experimentId, { archivedAt });
      });
      return { deleted: false, archived: true, archivedAt };
    },
    listRuns: (websiteId: string, experimentId: string) =>
      requireExperiment(websiteId, experimentId).then(() =>
        repository.listRuns(websiteId, experimentId),
      ),
    getRun: requireRun,
    async getResults(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      if (run.resultSnapshot) {
        return {
          results: run.resultSnapshot.results,
          diagnostics: run.resultSnapshot.diagnostics,
          safeguardResults: run.resultSnapshot.safeguardResults,
          sourceDataThroughAt: run.resultSnapshot.sourceDataThroughAt,
          computedAt: run.resultSnapshot.computedAt,
          immutable: true,
        };
      }
      return { ...(await computeRunResults(run)), immutable: false };
    },
    async refreshResults(
      websiteId: string,
      experimentId: string,
      runId: string,
      options: { mode?: 'full' | 'incremental' } = {},
    ) {
      const run = await requireRun(websiteId, experimentId, runId);
      if (['Draft', 'Finalized', 'Archived'].includes(run.status)) {
        throw new ExperimentServiceError(
          `Cannot refresh results for an Experiment Run in ${run.status}`,
          'experiment-refresh-state',
        );
      }
      const snapshot = await computeRunResults(run, options.mode ?? 'full');
      const safeguards = snapshot.safeguardResults as any;
      const preferred =
        safeguards?.visitor?.status !== 'Unavailable' ? safeguards?.visitor : safeguards?.session;
      await repository.transaction(async transaction => {
        await transaction.updateRun(runId, {
          readinessStatus: preferred?.status ?? 'NotReady',
          readinessChecks: preferred?.checks ? jsonValue(preferred.checks) : Prisma.DbNull,
          readyAt: preferred?.ready ? (run.readyAt ?? now()) : null,
          lastComputedAt: snapshot.computedAt,
        });
        for (const fact of getResultNotificationFacts(snapshot)) {
          await createNotification(transaction, run, fact.type, now(), fact.data);
        }
      });
      return { ...snapshot, immutable: false };
    },
    async createRun(
      websiteId: string,
      experimentId: string,
      input: ExperimentRunDraft & { mutualExclusionGroupId?: string | null },
    ) {
      const parsed = validateExperimentRunDraft(input);
      if (!parsed.success)
        throw new ExperimentServiceError(
          'Invalid Experiment Run configuration',
          'experiment-run-invalid',
          400,
        );
      const experiment = await requireExperiment(websiteId, experimentId);
      const flag = await repository.getFeatureFlag(websiteId, experiment.featureFlagId);
      if (!flag)
        throw new ExperimentServiceError(
          'Feature Flag not found for Website',
          'experiment-flag-not-found',
          400,
        );
      const existing = await repository.listRuns(websiteId, experimentId);
      const runId = uuid();
      const runNumber = Math.max(0, ...existing.map(run => run.runNumber)) + 1;
      return repository.createRun(
        {
          id: runId,
          experimentId,
          websiteId,
          featureFlagId: flag.id,
          mutualExclusionGroupId: input.mutualExclusionGroupId ?? null,
          runNumber,
          status: 'Draft',
          ...draftFields(parsed.data),
        },
        outcomesToRows(runId, parsed.data.outcomes).map(({ experimentRunId: _, ...row }) => row),
      );
    },
    async updateDraftRun(
      websiteId: string,
      experimentId: string,
      runId: string,
      input: ExperimentRunDraft & { mutualExclusionGroupId?: string | null },
    ) {
      const run = await requireRun(websiteId, experimentId, runId);
      if (run.status !== 'Draft')
        throw new ExperimentServiceError(
          'Started Run configuration is frozen',
          'experiment-run-frozen',
        );
      const parsed = validateExperimentRunDraft(input);
      if (!parsed.success)
        throw new ExperimentServiceError(
          'Invalid Experiment Run configuration',
          'experiment-run-invalid',
          400,
        );
      return repository.transaction(async transaction => {
        await transaction.replaceOutcomes(runId, outcomesToRows(runId, parsed.data.outcomes));
        return transaction.updateRun(runId, {
          mutualExclusionGroupId: input.mutualExclusionGroupId ?? null,
          ...draftFields(parsed.data),
        });
      });
    },
    async start(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      const experiment = await requireExperiment(websiteId, experimentId);
      const flag = await repository.getFeatureFlag(websiteId, run.featureFlagId);
      if (!flag || flag.id !== experiment.featureFlagId)
        throw new ExperimentServiceError('Feature Flag ownership changed', 'experiment-ownership');

      const draft = runToDraft(run);
      draft.featureFlag = flagSnapshot(flag) as ExperimentRunDraft['featureFlag'];
      const segmentIds = [
        draft.audienceSegment?.segmentId,
        draft.exclusionSegment?.segmentId,
      ].filter(Boolean) as string[];
      const segments = await Promise.all(
        segmentIds.map(id => repository.getSegment(websiteId, id)),
      );
      if (segments.some(segment => !segment))
        throw new ExperimentServiceError(
          'Audience or exclusion Segment does not belong to Website',
          'experiment-ownership',
        );
      if (draft.audienceSegment)
        draft.audienceSegment = segmentSnapshot(
          segments[segmentIds.indexOf(draft.audienceSegment.segmentId)],
        );
      if (draft.exclusionSegment)
        draft.exclusionSegment = segmentSnapshot(
          segments[segmentIds.indexOf(draft.exclusionSegment.segmentId)],
        );
      for (const snapshot of [draft.audienceSegment, draft.exclusionSegment].filter(Boolean)) {
        const validation = validateRealtimeSegmentSnapshot(snapshot);
        if ('reason' in validation) {
          throw new ExperimentServiceError(validation.reason, 'unsupported-segment', 400);
        }
      }
      const group = run.mutualExclusionGroupId
        ? await repository.getGroup(websiteId, run.mutualExclusionGroupId)
        : null;
      if (run.mutualExclusionGroupId && !group)
        throw new ExperimentServiceError(
          'Mutual Exclusion Group does not belong to Website',
          'experiment-ownership',
        );

      const [activeWebsiteRunCount, activeFlag, activeExperiment] = await Promise.all([
        repository.countActiveWebsiteRuns(websiteId),
        repository.findActiveFlagRun(websiteId, run.featureFlagId),
        repository.findActiveExperimentRun(websiteId, experimentId),
      ]);
      validateRunStart({
        websiteId,
        experimentWebsiteId: experiment.websiteId,
        flagWebsiteId: flag.websiteId,
        segmentWebsiteIds: segments.map(segment => segment.websiteId),
        groupWebsiteId: group?.websiteId,
        activeWebsiteRunCount,
        hasActiveFlagRun: !!activeFlag,
        hasActiveExperimentRun: !!activeExperiment,
      });
      const frozen = freezeExperimentRun(draft);
      const transition = applyLifecycleAction(run, 'start', now());
      const retentionDays = Number(process.env.EXPERIMENT_RAW_RETENTION_DAYS ?? 90);
      if (!Number.isInteger(retentionDays) || retentionDays < 1) {
        throw new ExperimentServiceError(
          'EXPERIMENT_RAW_RETENTION_DAYS must be a positive integer',
          'experiment-retention-configuration',
          503,
        );
      }
      return repository.updateRun(runId, {
        ...draftFields(frozen as ExperimentRunDraft),
        status: transition.status,
        startedAt: transition.startedAt,
        rawDataRetainedUntil: new Date(
          transition.startedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000,
        ),
        rawDataExpiredAt: null,
      });
    },
    async pause(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      const transition = applyLifecycleAction(run, 'pause', now());
      return repository.updateRun(runId, {
        status: transition.status,
        pausedAt: transition.pausedAt,
      });
    },
    async resume(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      const transition = applyLifecycleAction(run, 'resume', now());
      return repository.updateRun(runId, {
        status: transition.status,
        pausedAt: null,
        accumulatedPausedDurationMs: transition.accumulatedPausedDurationMs,
      });
    },
    async complete(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      const transition = applyLifecycleAction(run, 'complete', now());
      return repository.updateRun(runId, {
        status: transition.status,
        pausedAt: null,
        accumulatedPausedDurationMs: transition.accumulatedPausedDurationMs,
        completedAt: transition.completedAt,
        provisionalUntil: transition.provisionalUntil,
      });
    },
    async finalize(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      const finalized = await finalizeRun(
        run,
        {
          computeFull: () => computeRunResults(run),
        },
        now(),
      );
      return repository.transaction(async transaction => {
        const snapshot = await transaction.createResultSnapshot({
          id: uuid(),
          experimentRunId: runId,
          statisticsVersion: run.statisticsVersion,
          results: jsonValue(finalized.snapshot.results),
          diagnostics: jsonValue(finalized.snapshot.diagnostics),
          safeguardResults: jsonValue(finalized.snapshot.safeguardResults),
          sourceDataThroughAt: finalized.snapshot.sourceDataThroughAt,
          computedAt: finalized.snapshot.computedAt,
        });
        const updatedRun = await transaction.updateRun(runId, {
          status: 'Finalized',
          finalizedAt: finalized.run.finalizedAt,
          lastComputedAt: finalized.snapshot.computedAt,
        });
        await createNotification(transaction, run, 'finalized', now());
        return { run: updatedRun, snapshot };
      });
    },
    async archive(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      const transition = applyLifecycleAction(run, 'archive', now());
      return repository.updateRun(runId, {
        status: transition.status,
        archivedAt: transition.archivedAt,
      });
    },
    async deleteDraft(websiteId: string, experimentId: string, runId: string) {
      const run = await requireRun(websiteId, experimentId, runId);
      if (getRunRemoval(run) !== 'delete') {
        throw new ExperimentServiceError(
          'Finalized Runs must be archived, never hard-deleted',
          'experiment-removal-conflict',
        );
      }
      await repository.deleteRun(runId);
      return { deleted: true };
    },
    async promote(
      websiteId: string,
      experimentId: string,
      runId: string,
      winningVariation: number,
      actorId?: string | null,
    ) {
      const run = await requireRun(websiteId, experimentId, runId);
      if (!['Completed', 'Finalized'].includes(run.status))
        throw new ExperimentServiceError(
          'Only Completed or Finalized Runs may be promoted',
          'experiment-promotion-state',
        );
      const variations = run.featureFlagVariations as unknown[];
      if (
        !Number.isInteger(winningVariation) ||
        winningVariation < 0 ||
        winningVariation >= variations.length
      )
        throw new ExperimentServiceError(
          'Winner must reference a frozen Variation',
          'experiment-winner-invalid',
          400,
        );
      if (await repository.getActivePromotion(runId))
        throw new ExperimentServiceError(
          'Run already has an active promotion',
          'experiment-promotion-active',
        );

      const result = await repository.transaction(async transaction => {
        const flag = await transaction.getFeatureFlag(websiteId, run.featureFlagId);
        if (!flag)
          throw new ExperimentServiceError(
            'Feature Flag not found',
            'experiment-flag-not-found',
            404,
          );
        const previous = flagConfiguration(flag);
        const expected = {
          ...previous,
          enabled: true,
          rollout: {
            percentage: 100,
            weights: variations.map((_, index) => (index === winningVariation ? 1 : 0)),
          },
          defaultVariation: winningVariation,
        };
        const updatedFlag = await transaction.updateFlagOptimistic(
          flag.id,
          flag.updatedAt,
          expected,
        );
        if (!updatedFlag)
          throw new ExperimentServiceError(
            'Feature Flag changed during promotion',
            'experiment-promotion-conflict',
          );
        const promotedAt = now();
        const promotion = await transaction.createPromotion({
          id: uuid(),
          websiteId,
          experimentRunId: runId,
          featureFlagId: flag.id,
          winningVariation,
          previousFlagSnapshot: jsonValue({
            version: 1,
            previous,
            expected,
            provisional: run.status === 'Completed',
          }),
          promotedBy: actorId ?? null,
          promotedAt,
        });
        await createNotification(transaction, run, 'promoted', promotedAt, {
          winningVariation,
          provisional: run.status === 'Completed',
        });
        return {
          promotion,
          flag: updatedFlag,
          provisional: run.status === 'Completed',
          warning: run.status === 'Completed' ? 'Results are provisional until finalization' : null,
        };
      });
      await invalidateFlags(websiteId);
      return result;
    },
    async rollback(
      websiteId: string,
      experimentId: string,
      runId: string,
      actorId?: string | null,
    ) {
      const run = await requireRun(websiteId, experimentId, runId);
      const result = await repository.transaction(async transaction => {
        const promotion = await transaction.getActivePromotion(runId);
        if (!promotion)
          throw new ExperimentServiceError(
            'No active promotion to roll back',
            'experiment-promotion-not-found',
            404,
          );
        const snapshot = promotion.previousFlagSnapshot as {
          version: number;
          previous: any;
          expected: any;
        };
        if (snapshot.version !== 1 || !snapshot.previous || !snapshot.expected)
          throw new ExperimentServiceError(
            'Promotion snapshot is invalid',
            'experiment-promotion-snapshot',
          );
        const flag = await transaction.getFeatureFlag(websiteId, promotion.featureFlagId);
        if (!flag)
          throw new ExperimentServiceError(
            'Feature Flag not found',
            'experiment-flag-not-found',
            404,
          );
        if (!sameConfiguration(flagConfiguration(flag), snapshot.expected))
          throw new ExperimentServiceError(
            'Feature Flag changed after promotion; rollback would overwrite newer configuration',
            'experiment-rollback-conflict',
          );
        const restored = await transaction.updateFlagOptimistic(
          flag.id,
          flag.updatedAt,
          snapshot.previous,
        );
        if (!restored)
          throw new ExperimentServiceError(
            'Feature Flag changed during rollback',
            'experiment-rollback-conflict',
          );
        const rolledBackAt = now();
        const updatedPromotion = await transaction.updatePromotion(promotion.id, {
          rolledBackBy: actorId ?? null,
          rolledBackAt,
        });
        await createNotification(transaction, run, 'rolled-back', rolledBackAt);
        return { promotion: updatedPromotion, flag: restored };
      });
      await invalidateFlags(websiteId);
      return result;
    },
    async getFeatureFlagRemoval(featureFlagId: string) {
      const activeRuns = await repository.countFlagRuns(featureFlagId, [
        ...ACTIVE_EXPERIMENT_RUN_STATUSES,
      ]);
      if (activeRuns) {
        return {
          action: 'conflict' as const,
          conflict: {
            code: 'feature-flag-active-experiment',
            message: 'Feature Flag has a Running or Paused Experiment Run and cannot be deleted',
          },
        };
      }

      const provisionalRuns = await repository.countFlagRuns(featureFlagId, ['Completed']);
      if (provisionalRuns) {
        return {
          action: 'conflict' as const,
          conflict: {
            code: 'feature-flag-provisional-experiment',
            message: 'Feature Flag has a Completed Run that must be finalized before archival',
          },
        };
      }

      const historicalRuns = await repository.countFlagRuns(featureFlagId, [
        'Finalized',
        'Archived',
      ]);
      return historicalRuns ? { action: 'archive' as const } : { action: 'delete' as const };
    },
  };
}

export const experimentRunService = createExperimentRunService();
