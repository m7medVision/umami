import type { Prisma } from '@/generated/prisma/client';
import { clearWebsiteFeatureFlags } from '@/lib/load';
import { parseRequest } from '@/lib/request';
import { json, notFound, ok, unauthorized } from '@/lib/response';
import { featureFlagUpdateSchema } from '@/lib/schema';
import { canDeleteFeatureFlag, canUpdateFeatureFlag, canViewFeatureFlag } from '@/permissions';
import { deleteFeatureFlag, getWebsiteFeatureFlag, updateFeatureFlag } from '@/queries/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; flagId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { websiteId, flagId } = await params;
  const flag = await getWebsiteFeatureFlag(websiteId, flagId);

  if (!flag) {
    return notFound();
  }

  if (!(await canViewFeatureFlag(auth, flag))) {
    return unauthorized();
  }

  return json(flag);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; flagId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, featureFlagUpdateSchema);

  if (error) {
    return error();
  }

  const { websiteId, flagId } = await params;
  const flag = await getWebsiteFeatureFlag(websiteId, flagId);

  if (!flag) {
    return notFound();
  }

  if (!(await canUpdateFeatureFlag(auth, flag))) {
    return unauthorized();
  }

  const result = await updateFeatureFlag(flagId, {
    ...body,
    variations: body.variations as Prisma.InputJsonValue,
    rollout: body.rollout as Prisma.InputJsonValue,
  });

  await clearWebsiteFeatureFlags(websiteId);
  return json(result);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; flagId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { websiteId, flagId } = await params;
  const flag = await getWebsiteFeatureFlag(websiteId, flagId);

  if (!flag) {
    return notFound();
  }

  if (!(await canDeleteFeatureFlag(auth, flag))) {
    return unauthorized();
  }

  await deleteFeatureFlag(flagId);
  await clearWebsiteFeatureFlags(websiteId);
  return ok();
}
