import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));
vi.mock('./runService', () => ({ experimentRunService: {} }));
vi.mock('@/queries/sql/experiments/cleanup', () => ({ purgeExperimentRunRawData: vi.fn() }));

import { createExperimentJobService, type ExperimentJobRepository } from './jobService';

const now = new Date('2026-02-02T00:00:00Z');
const staleRun = {
  id: '11111111-1111-4111-8111-111111111111',
  websiteId: '22222222-2222-4222-8222-222222222222',
  experimentId: '33333333-3333-4333-8333-333333333333',
};
const completedRun = { ...staleRun, id: '44444444-4444-4444-8444-444444444444' };
const expiredRun = { ...staleRun, id: '55555555-5555-4555-8555-555555555555' };

function repository(overrides: Partial<ExperimentJobRepository> = {}): ExperimentJobRepository {
  const value: ExperimentJobRepository = {
    withLease: async operation => ({ acquired: true, value: await operation(value) }),
    listStaleRuns: vi.fn().mockResolvedValue([staleRun]),
    listFinalizableRuns: vi.fn().mockResolvedValue([completedRun]),
    listRawDataExpiredRuns: vi.fn().mockResolvedValue([expiredRun]),
    markRawDataExpired: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return value;
}

describe('Experiment jobs', () => {
  test('runs each due operation once while holding the lease', async () => {
    const repo = repository();
    const runs = {
      refreshResults: vi.fn().mockResolvedValue({}),
      finalize: vi.fn().mockResolvedValue({}),
    };
    const cleanup = { purgeRunRawData: vi.fn().mockResolvedValue({ skipped: false }) };
    const service = createExperimentJobService({
      repository: repo,
      runService: runs,
      cleanup,
      now: () => now,
    });

    await expect(service.run()).resolves.toMatchObject({
      acquired: true,
      incremental: { attempted: 1, succeeded: 1, failed: 0 },
      finalization: { attempted: 1, succeeded: 1, failed: 0 },
      retention: { attempted: 1, succeeded: 1, failed: 0 },
      errors: [],
    });
    expect(runs.refreshResults).toHaveBeenCalledWith(
      staleRun.websiteId,
      staleRun.experimentId,
      staleRun.id,
      { mode: 'incremental' },
    );
    expect(runs.finalize).toHaveBeenCalledWith(
      completedRun.websiteId,
      completedRun.experimentId,
      completedRun.id,
    );
    expect(cleanup.purgeRunRawData).toHaveBeenCalledWith(expiredRun.id);
    expect(repo.markRawDataExpired).toHaveBeenCalledWith(expiredRun.id, now);
  });

  test('a duplicate invocation exits without doing work', async () => {
    const repo = repository({ withLease: vi.fn().mockResolvedValue({ acquired: false }) });
    const runs = { refreshResults: vi.fn(), finalize: vi.fn() };
    const cleanup = { purgeRunRawData: vi.fn() };
    const service = createExperimentJobService({ repository: repo, runService: runs, cleanup });

    await expect(service.run()).resolves.toMatchObject({ acquired: false });
    expect(runs.refreshResults).not.toHaveBeenCalled();
    expect(cleanup.purgeRunRawData).not.toHaveBeenCalled();
  });

  test('isolates a ClickHouse failure and does not falsely mark raw data expired', async () => {
    const repo = repository({
      listStaleRuns: vi.fn().mockResolvedValue([]),
      listFinalizableRuns: vi.fn().mockResolvedValue([]),
    });
    const service = createExperimentJobService({
      repository: repo,
      runService: { refreshResults: vi.fn(), finalize: vi.fn() },
      cleanup: { purgeRunRawData: vi.fn().mockRejectedValue(new Error('ClickHouse down')) },
      now: () => now,
    });

    await expect(service.run()).resolves.toMatchObject({
      acquired: true,
      retention: { attempted: 1, succeeded: 0, failed: 1 },
      errors: [{ runId: expiredRun.id, operation: 'retention', message: 'ClickHouse down' }],
    });
    expect(repo.markRawDataExpired).not.toHaveBeenCalled();
  });

  test('dry-run reports due work without mutation', async () => {
    const repo = repository();
    const runs = { refreshResults: vi.fn(), finalize: vi.fn() };
    const cleanup = { purgeRunRawData: vi.fn() };
    const service = createExperimentJobService({ repository: repo, runService: runs, cleanup });

    await expect(service.run({ dryRun: true })).resolves.toMatchObject({
      acquired: true,
      dryRun: true,
      incremental: { attempted: 1, succeeded: 0, failed: 0 },
      finalization: { attempted: 1, succeeded: 0, failed: 0 },
      retention: { attempted: 1, succeeded: 0, failed: 0 },
    });
    expect(runs.refreshResults).not.toHaveBeenCalled();
    expect(runs.finalize).not.toHaveBeenCalled();
    expect(cleanup.purgeRunRawData).not.toHaveBeenCalled();
  });
});
