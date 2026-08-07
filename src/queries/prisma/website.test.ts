import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  resetCleanup: vi.fn(),
  deleteCleanup: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {},
    transaction: mocks.transaction,
    getSearchParameters: vi.fn(),
    pagedQuery: vi.fn(),
  },
}));
vi.mock('@/lib/redis', () => ({
  default: { enabled: false, client: { set: vi.fn(), del: vi.fn() } },
}));
vi.mock('@/queries/sql/experiments/cleanup', () => ({
  resetWebsiteExperimentData: mocks.resetCleanup,
  deleteWebsiteExperimentData: mocks.deleteCleanup,
}));

import { deleteWebsite, resetWebsite } from './website';

function transactionFixture() {
  const calls: string[] = [];
  const model = (name: string) => ({
    deleteMany: vi.fn().mockImplementation(async () => calls.push(`${name}.deleteMany`)),
    updateMany: vi.fn().mockImplementation(async () => calls.push(`${name}.updateMany`)),
  });
  const tx: any = {
    experimentRun: model('experimentRun'),
    experimentNotification: model('experimentNotification'),
    experimentPrivacyAudit: model('experimentPrivacyAudit'),
    experimentPromotion: model('experimentPromotion'),
    experimentResultSnapshot: model('experimentResultSnapshot'),
    experimentOutcome: model('experimentOutcome'),
    experiment: model('experiment'),
    mutualExclusionGroup: model('mutualExclusionGroup'),
    featureFlag: model('featureFlag'),
    sessionReplaySaved: model('sessionReplaySaved'),
    sessionReplay: model('sessionReplay'),
    revenue: model('revenue'),
    eventData: model('eventData'),
    sessionData: model('sessionData'),
    websiteEvent: model('websiteEvent'),
    session: model('session'),
    report: model('report'),
    segment: model('segment'),
    share: model('share'),
    website: {
      update: vi.fn().mockResolvedValue({ id: 'website-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'website-1' }),
    },
  };
  mocks.transaction.mockImplementation(async operation => operation(tx));
  return { tx, calls };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.transaction.mockReset();
  mocks.resetCleanup.mockReset().mockResolvedValue({ skipped: false });
  mocks.deleteCleanup.mockReset().mockResolvedValue({ skipped: false });
});

describe('Website Experiment cleanup integration', () => {
  test('reset preserves snapshots/configuration and marks raw results expired', async () => {
    const { tx } = transactionFixture();
    await resetWebsite('website-1');

    expect(mocks.resetCleanup).toHaveBeenCalledWith('website-1');
    expect(tx.experimentRun.updateMany).toHaveBeenCalledWith({
      where: { websiteId: 'website-1', rawDataExpiredAt: null },
      data: { rawDataExpiredAt: expect.any(Date) },
    });
    expect(tx.experimentResultSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(tx.experiment.deleteMany).not.toHaveBeenCalled();
  });

  test('configured ClickHouse reset failure aborts before PostgreSQL mutation', async () => {
    mocks.resetCleanup.mockRejectedValue(new Error('ClickHouse unavailable'));
    await expect(resetWebsite('website-1')).rejects.toThrow('ClickHouse unavailable');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  test('deletion removes relationMode Experiment children before the Website', async () => {
    const { tx, calls } = transactionFixture();
    await deleteWebsite('website-1');

    expect(mocks.deleteCleanup).toHaveBeenCalledWith('website-1');
    expect(tx.experimentResultSnapshot.deleteMany).toHaveBeenCalled();
    expect(tx.experimentOutcome.deleteMany).toHaveBeenCalled();
    expect(tx.experimentRun.deleteMany).toHaveBeenCalledWith({ where: { websiteId: 'website-1' } });
    expect(tx.experiment.deleteMany).toHaveBeenCalledWith({ where: { websiteId: 'website-1' } });
    expect(calls.indexOf('experimentOutcome.deleteMany')).toBeLessThan(
      calls.indexOf('experimentRun.deleteMany'),
    );
    expect(tx.website.delete).toHaveBeenCalledWith({ where: { id: 'website-1' } });
  });
});
