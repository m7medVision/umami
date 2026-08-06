import { z } from 'zod';
import { asEvaluableFeatureFlag, evaluateFlag } from '@/lib/flags';
import { parseRequest } from '@/lib/request';
import { json, notFound, unauthorized } from '@/lib/response';
import { canViewFeatureFlag } from '@/permissions';
import { getWebsiteFeatureFlag } from '@/queries/prisma';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; flagId: string }> },
) {
  const { auth, body, error } = await parseRequest(
    request,
    z.object({ userKey: z.string().min(1) }),
  );

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

  return json(evaluateFlag(asEvaluableFeatureFlag(flag), body.userKey));
}
