import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/experiments/jobService', () => ({
  experimentJobService: { run: mocks.run },
}));

import { POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.run.mockReset();
});

test('fails closed without EXPERIMENT_JOBS_SECRET', async () => {
  vi.stubEnv('EXPERIMENT_JOBS_SECRET', '');
  const response = await POST(
    new Request('http://localhost/api/jobs/experiments', {
      method: 'POST',
      headers: { authorization: 'Bearer guessed' },
    }),
  );
  expect(response.status).toBe(401);
  expect(mocks.run).not.toHaveBeenCalled();
});

test('authenticated invocation runs the leased scheduler', async () => {
  vi.stubEnv('EXPERIMENT_JOBS_SECRET', 'dedicated-job-secret');
  mocks.run.mockResolvedValue({ acquired: true, errors: [] });
  const response = await POST(
    new Request('http://localhost/api/jobs/experiments', {
      method: 'POST',
      headers: { authorization: 'Bearer dedicated-job-secret' },
    }),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ acquired: true });
  expect(mocks.run).toHaveBeenCalledOnce();
});
