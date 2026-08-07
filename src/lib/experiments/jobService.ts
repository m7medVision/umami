import prisma from '@/lib/prisma';
import { purgeExperimentRunRawData } from '@/queries/sql/experiments/cleanup';
import { experimentRunService } from './runService';

const JOB_LEASE_KEY = 1_967_202_607;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

type DueRun = { id: string; websiteId: string; experimentId: string };

export interface ExperimentJobRepository {
  withLease<T>(
    operation: (repository: ExperimentJobRepository) => Promise<T>,
  ): Promise<{ acquired: boolean; value?: T }>;
  listStaleRuns(staleBefore: Date): Promise<DueRun[]>;
  listFinalizableRuns(now: Date): Promise<DueRun[]>;
  listRawDataExpiredRuns(now: Date): Promise<DueRun[]>;
  markRawDataExpired(runId: string, expiredAt: Date): Promise<unknown>;
}

function prismaExperimentJobRepository(client: any = prisma.client): ExperimentJobRepository {
  const repository: ExperimentJobRepository = {
    async withLease(operation) {
      return client.$transaction(
        async (tx: any) => {
          const rows = (await tx.$queryRawUnsafe(
            'select pg_try_advisory_xact_lock($1) as acquired',
            JOB_LEASE_KEY,
          )) as { acquired: boolean }[];
          if (!rows[0]?.acquired) return { acquired: false };
          return { acquired: true, value: await operation(prismaExperimentJobRepository(tx)) };
        },
        { maxWait: 10_000, timeout: 10 * 60 * 1000 },
      );
    },
    listStaleRuns: staleBefore =>
      client.experimentRun.findMany({
        where: {
          status: { in: ['Running', 'Paused'] },
          OR: [{ lastComputedAt: null }, { lastComputedAt: { lte: staleBefore } }],
        },
        select: { id: true, websiteId: true, experimentId: true },
        orderBy: { createdAt: 'asc' },
      }),
    listFinalizableRuns: now =>
      client.experimentRun.findMany({
        where: { status: 'Completed', provisionalUntil: { lte: now } },
        select: { id: true, websiteId: true, experimentId: true },
        orderBy: { provisionalUntil: 'asc' },
      }),
    listRawDataExpiredRuns: now =>
      client.experimentRun.findMany({
        where: {
          rawDataExpiredAt: null,
          rawDataRetainedUntil: { not: null, lte: now },
        },
        select: { id: true, websiteId: true, experimentId: true },
        orderBy: { rawDataRetainedUntil: 'asc' },
      }),
    markRawDataExpired: (id, rawDataExpiredAt) =>
      client.experimentRun.updateMany({
        where: { id, rawDataExpiredAt: null },
        data: { rawDataExpiredAt },
      }),
  };
  return repository;
}

interface JobRunService {
  refreshResults(
    websiteId: string,
    experimentId: string,
    runId: string,
    options?: { mode?: 'full' | 'incremental' },
  ): Promise<unknown>;
  finalize(websiteId: string, experimentId: string, runId: string): Promise<unknown>;
}

interface ExperimentCleanup {
  purgeRunRawData(runId: string): Promise<unknown>;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createExperimentJobService({
  repository = prismaExperimentJobRepository(),
  runService = experimentRunService,
  cleanup = { purgeRunRawData: purgeExperimentRunRawData },
  now = () => new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: {
  repository?: ExperimentJobRepository;
  runService?: JobRunService;
  cleanup?: ExperimentCleanup;
  now?: () => Date;
  staleAfterMs?: number;
} = {}) {
  return {
    async run({ dryRun = false }: { dryRun?: boolean } = {}) {
      const startedAt = now();
      const lease = await repository.withLease(async leasedRepository => {
        const [staleRuns, finalizableRuns, expiredRuns] = await Promise.all([
          leasedRepository.listStaleRuns(new Date(startedAt.getTime() - staleAfterMs)),
          leasedRepository.listFinalizableRuns(startedAt),
          leasedRepository.listRawDataExpiredRuns(startedAt),
        ]);
        const result = {
          acquired: true,
          dryRun,
          startedAt,
          incremental: { attempted: staleRuns.length, succeeded: 0, failed: 0 },
          finalization: { attempted: finalizableRuns.length, succeeded: 0, failed: 0 },
          retention: { attempted: expiredRuns.length, succeeded: 0, failed: 0 },
          errors: [] as { runId: string; operation: string; message: string }[],
        };
        if (dryRun) return result;

        for (const run of staleRuns) {
          try {
            await runService.refreshResults(run.websiteId, run.experimentId, run.id, {
              mode: 'incremental',
            });
            result.incremental.succeeded++;
          } catch (error) {
            result.incremental.failed++;
            result.errors.push({
              runId: run.id,
              operation: 'incremental',
              message: message(error),
            });
          }
        }
        for (const run of finalizableRuns) {
          try {
            await runService.finalize(run.websiteId, run.experimentId, run.id);
            result.finalization.succeeded++;
          } catch (error) {
            result.finalization.failed++;
            result.errors.push({
              runId: run.id,
              operation: 'finalization',
              message: message(error),
            });
          }
        }
        for (const run of expiredRuns) {
          try {
            await cleanup.purgeRunRawData(run.id);
            await leasedRepository.markRawDataExpired(run.id, startedAt);
            result.retention.succeeded++;
          } catch (error) {
            result.retention.failed++;
            result.errors.push({ runId: run.id, operation: 'retention', message: message(error) });
          }
        }
        return result;
      });

      return lease.acquired
        ? lease.value
        : {
            acquired: false,
            dryRun,
            startedAt,
            message: 'Another Experiment job invocation holds the PostgreSQL advisory lease.',
          };
    },
  };
}

export const experimentJobService = createExperimentJobService();
