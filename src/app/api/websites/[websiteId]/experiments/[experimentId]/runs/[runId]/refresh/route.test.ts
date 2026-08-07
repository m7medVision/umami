import { beforeEach, expect, test, vi } from 'vitest';
import { checkExperimentRefreshRateLimit } from '@/lib/experiments/refreshRateLimit';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { canUpdateExperiment } from '@/permissions';
import { POST } from './route';

vi.mock('@/lib/experiments/runService', () => ({
  experimentRunService: { getRun: vi.fn(), refreshResults: vi.fn() },
  ExperimentServiceError: class extends Error {},
}));
vi.mock('@/lib/experiments/refreshRateLimit', () => ({ checkExperimentRefreshRateLimit: vi.fn() }));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/permissions', () => ({ canUpdateExperiment: vi.fn() }));

const context = {
  params: Promise.resolve({ websiteId: 'website', experimentId: 'experiment', runId: 'run' }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'editor' } },
    error: undefined,
  } as any);
  vi.mocked(experimentRunService.getRun).mockResolvedValue({ websiteId: 'website' } as any);
  vi.mocked(experimentRunService.refreshResults).mockResolvedValue({
    computedAt: new Date(),
  } as any);
  vi.mocked(canUpdateExperiment).mockResolvedValue(true);
  vi.mocked(checkExperimentRefreshRateLimit).mockResolvedValue(true);
});

test('Viewer cannot manually refresh', async () => {
  vi.mocked(canUpdateExperiment).mockResolvedValue(false);
  const response = await POST(new Request('http://localhost/refresh', { method: 'POST' }), context);
  expect(response.status).toBe(401);
  expect(experimentRunService.refreshResults).not.toHaveBeenCalled();
});

test('Editor refresh is rate-limited before computation', async () => {
  vi.mocked(checkExperimentRefreshRateLimit).mockResolvedValue(false);
  const response = await POST(new Request('http://localhost/refresh', { method: 'POST' }), context);
  expect(response.status).toBe(429);
  expect(experimentRunService.refreshResults).not.toHaveBeenCalled();
});

test('Editor can refresh when below the limit', async () => {
  const response = await POST(new Request('http://localhost/refresh', { method: 'POST' }), context);
  expect(response.status).toBe(200);
  expect(experimentRunService.refreshResults).toHaveBeenCalledWith('website', 'experiment', 'run');
});
