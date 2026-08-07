import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseRequest: vi.fn(),
  getWebsiteFeatureFlag: vi.fn(),
  updateFeatureFlag: vi.fn(),
  deleteFeatureFlag: vi.fn(),
  clearWebsiteFeatureFlags: vi.fn(),
  canDeleteFeatureFlag: vi.fn(),
  getFeatureFlagRemoval: vi.fn(),
}));

vi.mock('@/lib/experiments/runService', () => ({
  experimentRunService: { getFeatureFlagRemoval: mocks.getFeatureFlagRemoval },
}));
vi.mock('@/lib/load', () => ({ clearWebsiteFeatureFlags: mocks.clearWebsiteFeatureFlags }));
vi.mock('@/lib/request', () => ({ parseRequest: mocks.parseRequest }));
vi.mock('@/permissions', () => ({
  canDeleteFeatureFlag: mocks.canDeleteFeatureFlag,
  canUpdateFeatureFlag: vi.fn(),
  canViewFeatureFlag: vi.fn(),
}));
vi.mock('@/queries/prisma', () => ({
  deleteFeatureFlag: mocks.deleteFeatureFlag,
  getWebsiteFeatureFlag: mocks.getWebsiteFeatureFlag,
  updateFeatureFlag: mocks.updateFeatureFlag,
}));

import { DELETE } from './route';

const params = Promise.resolve({ websiteId: 'website-1', flagId: 'flag-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseRequest.mockResolvedValue({ auth: {}, error: undefined });
  mocks.getWebsiteFeatureFlag.mockResolvedValue({ id: 'flag-1', websiteId: 'website-1' });
  mocks.canDeleteFeatureFlag.mockResolvedValue(true);
});

describe('DELETE Feature Flag archival semantics', () => {
  test('archives and disables a flag with finalized Run history and clears evaluation cache', async () => {
    mocks.getFeatureFlagRemoval.mockResolvedValue({ action: 'archive' });

    const response = await DELETE(new Request('http://localhost'), { params });

    expect(response.status).toBe(200);
    expect(mocks.updateFeatureFlag).toHaveBeenCalledWith('flag-1', {
      enabled: false,
      archivedAt: expect.any(Date),
    });
    expect(mocks.deleteFeatureFlag).not.toHaveBeenCalled();
    expect(mocks.clearWebsiteFeatureFlags).toHaveBeenCalledWith('website-1');
  });

  test('hard-deletes a flag without Run history', async () => {
    mocks.getFeatureFlagRemoval.mockResolvedValue({ action: 'delete' });

    await DELETE(new Request('http://localhost'), { params });

    expect(mocks.deleteFeatureFlag).toHaveBeenCalledWith('flag-1');
    expect(mocks.updateFeatureFlag).not.toHaveBeenCalled();
  });

  test('keeps active Run removal as a conflict', async () => {
    mocks.getFeatureFlagRemoval.mockResolvedValue({
      action: 'conflict',
      conflict: { code: 'feature-flag-active-experiment', message: 'active' },
    });

    const response = await DELETE(new Request('http://localhost'), { params });

    expect(response.status).toBe(409);
    expect(mocks.updateFeatureFlag).not.toHaveBeenCalled();
    expect(mocks.deleteFeatureFlag).not.toHaveBeenCalled();
    expect(mocks.clearWebsiteFeatureFlags).not.toHaveBeenCalled();
  });
});
