import type { FeatureFlag, Session, Website } from '@/generated/prisma/client';
import redis from '@/lib/redis';
import { getWebsite, getWebsiteFeatureFlagDefinitions } from '@/queries/prisma';
import { getWebsiteSession } from '@/queries/sql';

export async function fetchWebsite(websiteId: string): Promise<Website> {
  let website = null;

  if (redis.enabled) {
    try {
      website = await redis.client.fetch(
        `website:${websiteId}`,
        () => getWebsite(websiteId),
        86400,
      );
    } catch {
      website = await getWebsite(websiteId);
    }
  } else {
    website = await getWebsite(websiteId);
  }

  if (!website || website.deletedAt) {
    return null;
  }

  return website;
}

export async function fetchWebsiteFeatureFlags(websiteId: string): Promise<FeatureFlag[]> {
  if (redis.enabled) {
    try {
      return await redis.client.fetch(
        `website:${websiteId}:flags`,
        () => getWebsiteFeatureFlagDefinitions(websiteId),
        300,
      );
    } catch {
      return getWebsiteFeatureFlagDefinitions(websiteId);
    }
  }

  return getWebsiteFeatureFlagDefinitions(websiteId);
}

export async function clearWebsiteFeatureFlags(websiteId: string) {
  if (redis.enabled) {
    try {
      await redis.client.del(`website:${websiteId}:flags`);
    } catch {
      // PostgreSQL is authoritative. Cache invalidation is best-effort during Redis outages.
    }
  }
}

export async function fetchSession(websiteId: string, sessionId: string): Promise<Session> {
  let session = null;

  if (redis.enabled) {
    try {
      session = await redis.client.fetch(
        `session:${sessionId}`,
        () => getWebsiteSession(websiteId, sessionId),
        86400,
      );
    } catch {
      session = await getWebsiteSession(websiteId, sessionId);
    }
  } else {
    session = await getWebsiteSession(websiteId, sessionId);
  }

  if (!session) {
    return null;
  }

  return session;
}

export async function fetchAccount(userId: string) {
  const account = await redis.client.get(`account:${userId}`);

  return account;
}

export async function fetchTeam(teamId: string) {
  const team = await redis.client.get(`team:${teamId}`);

  return team;
}
