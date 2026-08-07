import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseRequest: vi.fn(),
  getExperiment: vi.fn(),
  removeExperiment: vi.fn(),
  canArchiveExperiment: vi.fn(),
}));

vi.mock('@/lib/experiments/runService', () => ({
  experimentRunService: {
    getExperiment: mocks.getExperiment,
    removeExperiment: mocks.removeExperiment,
  },
}));
vi.mock('@/lib/request', () => ({ parseRequest: mocks.parseRequest }));
vi.mock('@/permissions', () => ({
  canArchiveExperiment: mocks.canArchiveExperiment,
  canUpdateExperiment: vi.fn(),
  canViewExperiment: vi.fn(),
}));

import { DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseRequest.mockResolvedValue({ auth: {}, error: undefined });
  mocks.getExperiment.mockResolvedValue({ id: 'experiment-1', websiteId: 'website-1' });
  mocks.canArchiveExperiment.mockResolvedValue(true);
  mocks.removeExperiment.mockResolvedValue({ archived: true });
});

describe('DELETE Experiment', () => {
  test('uses archive permission and delegates historical removal to the archival service', async () => {
    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ websiteId: 'website-1', experimentId: 'experiment-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.canArchiveExperiment).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ websiteId: 'website-1' }),
    );
    expect(mocks.removeExperiment).toHaveBeenCalledWith('website-1', 'experiment-1');
  });
});
