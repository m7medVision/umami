import redis from '@/lib/redis';

const memory = new Map<string, { count: number; expiresAt: number }>();
const DEFAULT_LIMIT = Number(process.env.EXPERIMENT_REFRESH_RATE_LIMIT || 1);
const DEFAULT_WINDOW_SECONDS = Number(process.env.EXPERIMENT_REFRESH_RATE_LIMIT_WINDOW || 60);

export async function checkExperimentRefreshRateLimit(
  key: string,
  options: { limit?: number; windowSeconds?: number; now?: number } = {},
) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(windowSeconds) ||
    windowSeconds < 1
  ) {
    throw new Error('Experiment refresh rate limit configuration is invalid');
  }

  if (redis.enabled) {
    try {
      // UmamiRedisClient.rateLimit returns true at the threshold, so threshold is limit + 1.
      return !(await redis.client.rateLimit(`experiment-refresh:${key}`, limit + 1, windowSeconds));
    } catch {
      // A Redis outage must not remove protection; continue with the process-local fallback.
    }
  }

  const now = options.now ?? Date.now();
  const current = memory.get(key);
  if (!current || current.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export function resetExperimentRefreshRateLimitsForTest() {
  memory.clear();
}
