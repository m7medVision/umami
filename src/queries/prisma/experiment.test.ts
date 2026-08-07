import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  experimentFindFirst: vi.fn(),
  featureFlagFindMany: vi.fn(),
  segmentFindMany: vi.fn(),
  groupFindMany: vi.fn(),
  pagedQuery: vi.fn(),
  getSearchParameters: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      experiment: { findFirst: mocks.experimentFindFirst },
      featureFlag: { findMany: mocks.featureFlagFindMany },
      segment: { findMany: mocks.segmentFindMany },
      mutualExclusionGroup: { findMany: mocks.groupFindMany },
    },
    pagedQuery: mocks.pagedQuery,
    getSearchParameters: mocks.getSearchParameters,
  },
}));

import {
  getWebsiteExperiment,
  getWebsiteExperiments,
  getWebsiteExperimentSetupOptions,
} from './experiment';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSearchParameters.mockReturnValue({});
});

describe('Experiment archival queries', () => {
  test('normal lists exclude archived definitions', async () => {
    await getWebsiteExperiments('website-1', {});

    expect(mocks.pagedQuery).toHaveBeenCalledWith(
      'experiment',
      expect.objectContaining({
        where: { websiteId: 'website-1', archivedAt: null },
      }),
      {},
    );
  });

  test('direct historical lookup remains able to read an archived Experiment', async () => {
    await getWebsiteExperiment('website-1', 'experiment-1');

    expect(mocks.experimentFindFirst).toHaveBeenCalledWith({
      where: { id: 'experiment-1', websiteId: 'website-1' },
    });
  });

  test('setup options exclude archived Feature Flags', async () => {
    mocks.featureFlagFindMany.mockResolvedValue([]);
    mocks.segmentFindMany.mockResolvedValue([]);
    mocks.groupFindMany.mockResolvedValue([]);

    await getWebsiteExperimentSetupOptions('website-1');

    expect(mocks.featureFlagFindMany).toHaveBeenCalledWith({
      where: { websiteId: 'website-1', archivedAt: null },
      orderBy: { name: 'asc' },
    });
  });
});
