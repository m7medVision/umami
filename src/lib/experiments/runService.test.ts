import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));
vi.mock('@/lib/load', () => ({ clearWebsiteFeatureFlags: vi.fn() }));

import {
  createExperimentRunService,
  type ExperimentRepository,
  ExperimentServiceError,
} from './runService';

const now = new Date('2025-02-01T00:00:00Z');
const websiteId = '11111111-1111-4111-8111-111111111111';
const experimentId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const flagId = '44444444-4444-4444-8444-444444444444';

function baseRun(status = 'Running') {
  return {
    id: runId,
    websiteId,
    experimentId,
    featureFlagId: flagId,
    status,
    featureFlagVariations: [{ value: 'control' }, { value: 'winner' }],
    accumulatedPausedDurationMs: 0,
    pausedAt: null,
    outcomes: [],
  };
}

function makeRepository(overrides: Partial<ExperimentRepository> = {}) {
  let flag: any = {
    id: flagId,
    websiteId,
    key: 'checkout',
    name: 'Checkout',
    description: 'test',
    valueType: 'string',
    enabled: true,
    variations: [{ value: 'control' }, { value: 'winner' }],
    rollout: { percentage: 50, weights: [0.5, 0.5] },
    defaultVariation: 0,
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };
  let promotion: any = null;
  const repository: ExperimentRepository = {
    transaction: operation => operation(repository),
    getExperiment: vi
      .fn()
      .mockResolvedValue({ id: experimentId, websiteId, featureFlagId: flagId }),
    listExperiments: vi.fn().mockResolvedValue([]),
    createExperiment: vi.fn(),
    updateExperiment: vi.fn(),
    deleteExperiment: vi.fn(),
    getFeatureFlag: vi.fn().mockImplementation(async () => flag),
    getSegment: vi.fn().mockResolvedValue(null),
    getGroup: vi.fn().mockResolvedValue(null),
    getRun: vi.fn().mockResolvedValue(baseRun()),
    listRuns: vi.fn().mockResolvedValue([]),
    createRun: vi.fn(),
    updateRun: vi.fn().mockImplementation(async (_id, data) => ({ ...baseRun(), ...data })),
    replaceOutcomes: vi.fn(),
    deleteRun: vi.fn(),
    countActiveWebsiteRuns: vi.fn().mockResolvedValue(0),
    findActiveFlagRun: vi.fn().mockResolvedValue(null),
    findActiveExperimentRun: vi.fn().mockResolvedValue(null),
    createResultSnapshot: vi.fn(),
    getActivePromotion: vi.fn().mockImplementation(async () => promotion),
    createPromotion: vi.fn().mockImplementation(async data => {
      promotion = { ...data, rolledBackAt: null };
      return promotion;
    }),
    updatePromotion: vi.fn().mockImplementation(async (_id, data) => {
      promotion = { ...promotion, ...data };
      return promotion;
    }),
    updateFlagOptimistic: vi.fn().mockImplementation(async (_id, expectedUpdatedAt, data) => {
      if (flag.updatedAt?.getTime() !== expectedUpdatedAt?.getTime()) return null;
      flag = { ...flag, ...data, updatedAt: new Date(flag.updatedAt.getTime() + 1) };
      return flag;
    }),
    countFlagRuns: vi.fn().mockResolvedValue(0),
    createNotificationIfAbsent: vi.fn().mockImplementation(async data => data),
    ...overrides,
  };
  return {
    repository,
    getFlag: () => flag,
    externallyChangeFlag: () => {
      flag = { ...flag, name: 'Newer user edit', updatedAt: new Date('2025-01-20T00:00:00Z') };
    },
  };
}

describe('Experiment Run service', () => {
  test('complete records the provisional window but never mutates the Feature Flag', async () => {
    const { repository } = makeRepository();
    const service = createExperimentRunService({ repository, now: () => now });

    const result = await service.complete(websiteId, experimentId, runId);

    expect(result).toMatchObject({
      status: 'Completed',
      completedAt: now,
      provisionalUntil: new Date('2025-02-02T00:00:00Z'),
    });
    expect(repository.updateFlagOptimistic).not.toHaveBeenCalled();
  });

  test('promotion is explicit, one-hot, reversible, and preserves the complete prior flag', async () => {
    const { repository, getFlag } = makeRepository({
      getRun: vi.fn().mockResolvedValue(baseRun('Completed')),
    });
    const invalidateFlags = vi.fn();
    const service = createExperimentRunService({
      repository,
      now: () => now,
      invalidateFlags,
    });

    const promoted = await service.promote(websiteId, experimentId, runId, 1, 'user-1');
    expect(promoted).toMatchObject({
      provisional: true,
      warning: expect.stringContaining('provisional'),
      flag: { enabled: true, rollout: { percentage: 100, weights: [0, 1] }, defaultVariation: 1 },
    });
    expect(promoted.promotion.previousFlagSnapshot.previous).toMatchObject({
      key: 'checkout',
      name: 'Checkout',
      description: 'test',
      rollout: { percentage: 50, weights: [0.5, 0.5] },
      defaultVariation: 0,
    });

    await service.rollback(websiteId, experimentId, runId, 'user-2');
    expect(getFlag()).toMatchObject({
      name: 'Checkout',
      rollout: { percentage: 50, weights: [0.5, 0.5] },
      defaultVariation: 0,
    });
    expect(invalidateFlags).toHaveBeenCalledTimes(2);
    expect(repository.createNotificationIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'promoted', dedupeKey: `${runId}:promoted` }),
    );
    expect(repository.createNotificationIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rolled-back', dedupeKey: `${runId}:rolled-back` }),
    );
  });

  test('rollback detects a newer Feature Flag edit instead of overwriting it', async () => {
    const fixture = makeRepository({ getRun: vi.fn().mockResolvedValue(baseRun('Finalized')) });
    const service = createExperimentRunService({
      repository: fixture.repository,
      now: () => now,
      invalidateFlags: vi.fn(),
    });
    await service.promote(websiteId, experimentId, runId, 1);
    fixture.externallyChangeFlag();

    await expect(service.rollback(websiteId, experimentId, runId)).rejects.toMatchObject({
      code: 'experiment-rollback-conflict',
    });
  });

  test.each([
    {
      type: 'cohort',
      parameters: {
        filters: [{ name: 'country', operator: 'eq', value: 'US' }],
      },
    },
    {
      type: 'segment',
      parameters: {
        filters: [{ name: 'country', operator: 'eq', value: 'US' }],
        dateRange: '30day',
        action: { type: 'path', value: '/pricing' },
      },
    },
  ])('rejects unsupported saved-Segment predicates when starting a Run', async segment => {
    const segmentId = '55555555-5555-4555-8555-555555555555';
    const draftRun = {
      ...baseRun('Draft'),
      featureFlagKey: 'checkout',
      featureFlagValueType: 'string',
      variationWeights: [0.5, 0.5],
      rolloutPercentage: 100,
      fallthroughVariation: 0,
      baselineVariation: 0,
      assignmentPolicy: { identified: 'visitor', anonymous: 'session' },
      audienceSegmentSnapshot: { segmentId },
      exclusionSegmentSnapshot: null,
      statisticsVersion: 'bayesian-v1',
      bucketingVersion: 'fnv1a32-v1',
      statisticalModel: {
        conversion: { model: 'beta-binomial', alpha: 1, beta: 1 },
        count: { model: 'gamma-poisson', shape: 1, rate: 1 },
        continuous: { model: 'bayesian-bootstrap' },
      },
      safeguards: {
        minimumSampleSizePerVariation: 100,
        minimumActiveDays: 7,
        probabilityToWinThreshold: 0.95,
        expectedLossThreshold: 0.01,
        sampleRatioMismatchAlpha: 0.01,
      },
    };
    const { repository } = makeRepository({
      getRun: vi.fn().mockResolvedValue(draftRun),
      getSegment: vi.fn().mockResolvedValue({
        id: segmentId,
        websiteId,
        name: 'Unsupported',
        ...segment,
      }),
    });
    const service = createExperimentRunService({ repository });

    await expect(service.start(websiteId, experimentId, runId)).rejects.toMatchObject({
      code: 'unsupported-segment',
      status: 400,
    });
    expect(repository.updateRun).not.toHaveBeenCalled();
  });

  test('Feature Flag removal conflicts while active, archives finalized history, and otherwise deletes', async () => {
    const activeFixture = makeRepository({ countFlagRuns: vi.fn().mockResolvedValueOnce(1) });
    await expect(
      createExperimentRunService({ repository: activeFixture.repository }).getFeatureFlagRemoval(
        flagId,
      ),
    ).resolves.toMatchObject({
      action: 'conflict',
      conflict: { code: 'feature-flag-active-experiment' },
    });

    const historicalFixture = makeRepository({
      countFlagRuns: vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2),
    });
    await expect(
      createExperimentRunService({
        repository: historicalFixture.repository,
      }).getFeatureFlagRemoval(flagId),
    ).resolves.toEqual({ action: 'archive' });

    const emptyFixture = makeRepository({ countFlagRuns: vi.fn().mockResolvedValue(0) });
    await expect(
      createExperimentRunService({ repository: emptyFixture.repository }).getFeatureFlagRemoval(
        flagId,
      ),
    ).resolves.toEqual({ action: 'delete' });
  });

  test('Experiment removal archives finalized history and preserves direct Run records', async () => {
    const finalizedRun = { ...baseRun('Finalized'), id: 'run-finalized' };
    const alreadyArchivedRun = { ...baseRun('Archived'), id: 'run-archived' };
    const emptyDraft = { ...baseRun('Draft'), id: 'run-draft', firstExposureAt: null };
    const { repository } = makeRepository({
      listRuns: vi.fn().mockResolvedValue([finalizedRun, alreadyArchivedRun, emptyDraft]),
    });
    const service = createExperimentRunService({ repository, now: () => now });

    await expect(service.removeExperiment(websiteId, experimentId)).resolves.toMatchObject({
      deleted: false,
      archived: true,
      archivedAt: now,
    });
    expect(repository.deleteRun).toHaveBeenCalledWith('run-draft');
    expect(repository.updateRun).toHaveBeenCalledWith('run-finalized', {
      status: 'Archived',
      archivedAt: now,
    });
    expect(repository.updateRun).not.toHaveBeenCalledWith('run-archived', expect.anything());
    expect(repository.updateExperiment).toHaveBeenCalledWith(experimentId, { archivedAt: now });
    expect(repository.deleteExperiment).not.toHaveBeenCalled();
  });

  test('Experiment removal hard-deletes only definitions with empty Drafts', async () => {
    const { repository } = makeRepository({
      listRuns: vi
        .fn()
        .mockResolvedValue([{ ...baseRun('Draft'), id: 'run-draft', firstExposureAt: null }]),
    });
    const service = createExperimentRunService({ repository });

    await expect(service.removeExperiment(websiteId, experimentId)).resolves.toEqual({
      deleted: true,
      archived: false,
    });
    expect(repository.deleteRun).toHaveBeenCalledWith('run-draft');
    expect(repository.deleteExperiment).toHaveBeenCalledWith(experimentId);
  });

  test('finalization persists one immutable full-result snapshot', async () => {
    const completed = {
      ...baseRun('Completed'),
      statisticsVersion: 'bayesian-v1',
      provisionalUntil: new Date('2025-01-31T00:00:00Z'),
    };
    const { repository } = makeRepository({
      getRun: vi.fn().mockResolvedValue(completed),
      createResultSnapshot: vi.fn().mockImplementation(async data => data),
    });
    const resultComputer = {
      computeFull: vi.fn().mockResolvedValue({
        results: { outcomes: ['primary'] },
        diagnostics: { srm: false },
        safeguardResults: { ready: true },
        sourceDataThroughAt: now,
        computedAt: now,
      }),
    };
    const service = createExperimentRunService({ repository, resultComputer, now: () => now });

    const result = await service.finalize(websiteId, experimentId, runId);

    expect(result).toMatchObject({
      run: { status: 'Finalized', finalizedAt: now },
      snapshot: {
        statisticsVersion: 'bayesian-v1',
        results: { outcomes: ['primary'] },
      },
    });
    expect(repository.createResultSnapshot).toHaveBeenCalledOnce();
    expect(resultComputer.computeFull).toHaveBeenCalledOnce();
    expect(repository.createNotificationIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finalized', dedupeKey: `${runId}:finalized` }),
    );
  });

  test('finalization fails clearly when no full-result computer is injected', async () => {
    const { repository } = makeRepository({
      getRun: vi.fn().mockResolvedValue({
        ...baseRun('Completed'),
        provisionalUntil: new Date('2025-01-31T00:00:00Z'),
      }),
    });
    const service = createExperimentRunService({ repository, now: () => now });

    await expect(service.finalize(websiteId, experimentId, runId)).rejects.toBeInstanceOf(
      ExperimentServiceError,
    );
  });
});
