import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  canArchiveExperiment,
  canDeleteExperiment,
  canUpdateExperiment,
  canViewExperiment,
} from './experiment';
import { canDeleteWebsite, canUpdateWebsite, canViewWebsite } from './website';

vi.mock('./website', () => ({
  canViewWebsite: vi.fn(),
  canUpdateWebsite: vi.fn(),
  canDeleteWebsite: vi.fn(),
}));

const auth = {
  user: { id: 'user-1', username: 'user', role: 'user', isAdmin: false },
};
const experiment = { websiteId: 'website-1' };

beforeEach(() => {
  vi.mocked(canViewWebsite).mockReset();
  vi.mocked(canUpdateWebsite).mockReset();
  vi.mocked(canDeleteWebsite).mockReset();
});

describe('experiment permissions', () => {
  test('website viewers can view Experiments and results', async () => {
    vi.mocked(canViewWebsite).mockResolvedValue(true);

    await expect(canViewExperiment(auth, experiment)).resolves.toBe(true);
    expect(canViewWebsite).toHaveBeenCalledWith(auth, 'website-1');
  });

  test('website update permission operates Experiment Runs', async () => {
    vi.mocked(canUpdateWebsite).mockResolvedValue(true);
    const run = { websiteId: 'website-1', status: 'Running' };

    await expect(canUpdateExperiment(auth, run)).resolves.toBe(true);
    expect(canUpdateWebsite).toHaveBeenCalledWith(auth, 'website-1');
  });

  test('website delete permission is required to archive', async () => {
    vi.mocked(canUpdateWebsite).mockResolvedValue(true);
    vi.mocked(canDeleteWebsite).mockResolvedValue(false);

    await expect(canArchiveExperiment(auth, experiment)).resolves.toBe(false);
    await expect(canDeleteExperiment(auth, experiment)).resolves.toBe(false);
    expect(canDeleteWebsite).toHaveBeenCalledWith(auth, 'website-1');
  });

  test('denies missing Experiment records', async () => {
    await expect(canViewExperiment(auth, null)).resolves.toBe(false);
    await expect(canUpdateExperiment(auth, null)).resolves.toBe(false);
    await expect(canArchiveExperiment(auth, null)).resolves.toBe(false);
    expect(canViewWebsite).not.toHaveBeenCalled();
  });
});
