import { beforeEach, expect, test, vi } from 'vitest';
import {
  checkExperimentRefreshRateLimit,
  resetExperimentRefreshRateLimitsForTest,
} from './refreshRateLimit';

vi.mock('@/lib/redis', () => ({ default: { enabled: false, client: { rateLimit: vi.fn() } } }));

beforeEach(() => resetExperimentRefreshRateLimitsForTest());

test('allows the configured refresh count then rate limits until the window expires', async () => {
  expect(
    await checkExperimentRefreshRateLimit('run:editor', {
      limit: 1,
      windowSeconds: 60,
      now: 1_000,
    }),
  ).toBe(true);
  expect(
    await checkExperimentRefreshRateLimit('run:editor', {
      limit: 1,
      windowSeconds: 60,
      now: 2_000,
    }),
  ).toBe(false);
  expect(
    await checkExperimentRefreshRateLimit('run:editor', {
      limit: 1,
      windowSeconds: 60,
      now: 61_001,
    }),
  ).toBe(true);
});
