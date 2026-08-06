import { z } from 'zod';
import { asEvaluableFeatureFlag, evaluateFlag } from '@/lib/flags';
import { fetchWebsite, fetchWebsiteFeatureFlags } from '@/lib/load';
import redis from '@/lib/redis';
import { parseRequest } from '@/lib/request';
import { badRequest, json, notFound, tooManyRequests } from '@/lib/response';

const schema = z.object({
  userKey: z.string().min(1).optional(),
  context: z.record(z.string(), z.json()).optional(),
});

const RATE_LIMIT = Number(process.env.FEATURE_FLAG_RATE_LIMIT || 1000);
const RATE_LIMIT_WINDOW = Number(process.env.FEATURE_FLAG_RATE_LIMIT_WINDOW || 60);
const memoryRateLimits = new Map<string, { count: number; expiresAt: number }>();

async function isRateLimited(websiteId: string) {
  const key = `flag-eval:${websiteId}`;
  if (redis.enabled) {
    return redis.client.rateLimit(key, RATE_LIMIT, RATE_LIMIT_WINDOW);
  }

  const now = Date.now();
  const current = memoryRateLimits.get(key);
  if (!current || current.expiresAt <= now) {
    memoryRateLimits.set(key, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW * 1000 });
    return false;
  }

  current.count += 1;
  return current.count >= RATE_LIMIT;
}

export async function POST(request: Request) {
  const { body, error } = await parseRequest(request, schema, { skipAuth: true });

  if (error) {
    return error();
  }

  const websiteId = request.headers.get('x-umami-website-id');
  if (!websiteId || !z.uuid().safeParse(websiteId).success) {
    return badRequest({ message: 'Missing or invalid x-umami-website-id header' });
  }

  if (!(await fetchWebsite(websiteId))) {
    return notFound();
  }

  if (await isRateLimited(websiteId)) {
    return tooManyRequests();
  }

  const definitions = await fetchWebsiteFeatureFlags(websiteId);
  const flags = Object.fromEntries(
    definitions.map(flag => {
      const evaluation = evaluateFlag(asEvaluableFeatureFlag(flag), body.userKey);

      return [
        flag.key,
        {
          enabled: flag.enabled && evaluation.value !== false && evaluation.value != null,
          value: evaluation.value,
        },
      ];
    }),
  );

  return json({ flags });
}
