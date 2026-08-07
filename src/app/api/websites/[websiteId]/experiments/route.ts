import { z } from 'zod';
import { experimentErrorResponse } from '@/lib/experiments/api';
import { experimentRunService } from '@/lib/experiments/runService';
import { EXPERIMENT_RUN_STATUSES } from '@/lib/experiments/types';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { experimentCreateSchema, pagingParams, searchParams } from '@/lib/schema';
import { canDeleteWebsite, canUpdateWebsite, canViewWebsite } from '@/permissions';
import { getWebsiteExperiments } from '@/queries/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(
    request,
    z.object({
      ...searchParams,
      ...pagingParams,
      status: z.enum(EXPERIMENT_RUN_STATUSES).optional(),
    }),
  );
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewWebsite(auth, websiteId))) return unauthorized();
  try {
    const [result, canEdit, canArchive] = await Promise.all([
      getWebsiteExperiments(websiteId, await getQueryFilters(query), query.status),
      canUpdateWebsite(auth, websiteId),
      canDeleteWebsite(auth, websiteId),
    ]);
    return json({ ...result, permissions: { canEdit, canArchive } });
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, experimentCreateSchema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return unauthorized();
  try {
    return json(await experimentRunService.createExperiment(websiteId, body));
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
