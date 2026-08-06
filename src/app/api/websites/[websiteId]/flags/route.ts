import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { uuid } from '@/lib/crypto';
import { clearWebsiteFeatureFlags } from '@/lib/load';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { featureFlagCreateSchema, searchParams } from '@/lib/schema';
import { canUpdateWebsite, canViewWebsite } from '@/permissions';
import {
  createFeatureFlag,
  getWebsiteFeatureFlagByKey,
  getWebsiteFeatureFlags,
} from '@/queries/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, z.object({ ...searchParams }));

  if (error) {
    return error();
  }

  const { websiteId } = await params;
  if (!(await canViewWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const filters = await getQueryFilters(query);
  return json(await getWebsiteFeatureFlags(websiteId, filters));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, featureFlagCreateSchema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) {
    return unauthorized();
  }

  if (await getWebsiteFeatureFlagByKey(websiteId, body.key)) {
    return badRequest({ message: 'Flag key already exists for this website' });
  }

  const result = await createFeatureFlag({
    id: uuid(),
    websiteId,
    ...body,
    variations: body.variations as Prisma.InputJsonValue,
    rollout: body.rollout as Prisma.InputJsonValue,
  });

  await clearWebsiteFeatureFlags(websiteId);
  return json(result);
}
