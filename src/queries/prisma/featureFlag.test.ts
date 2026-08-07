import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  pagedQuery: vi.fn(),
  getSearchParameters: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      featureFlag: {
        findFirst: mocks.findFirst,
        findMany: mocks.findMany,
      },
    },
    pagedQuery: mocks.pagedQuery,
    getSearchParameters: mocks.getSearchParameters,
  },
}));

import {
  getWebsiteFeatureFlag,
  getWebsiteFeatureFlagDefinitions,
  getWebsiteFeatureFlags,
} from './featureFlag';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSearchParameters.mockReturnValue({});
});

describe('Feature Flag archival queries', () => {
  test('excludes archived definitions from direct Website lookup and evaluation definitions', async () => {
    await getWebsiteFeatureFlag('website-1', 'flag-1');
    await getWebsiteFeatureFlagDefinitions('website-1');

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: 'flag-1', websiteId: 'website-1', archivedAt: null },
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { websiteId: 'website-1', archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  });

  test('forces normal paged lists to exclude archived Feature Flags', async () => {
    await getWebsiteFeatureFlags('website-1', {});

    expect(mocks.pagedQuery).toHaveBeenCalledWith(
      'featureFlag',
      expect.objectContaining({
        where: { websiteId: 'website-1', archivedAt: null },
      }),
      {},
    );
  });
});
