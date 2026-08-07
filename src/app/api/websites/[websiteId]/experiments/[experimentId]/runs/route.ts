import { experimentErrorResponse, experimentJson } from '@/lib/experiments/api';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { unauthorized } from '@/lib/response';
import { experimentRunRequestSchema } from '@/lib/schema';
import { canUpdateExperiment, canViewExperiment } from '@/permissions';

type Params = { params: Promise<{ websiteId: string; experimentId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId, experimentId } = await params;
  try {
    const experiment = await experimentRunService.getExperiment(websiteId, experimentId);
    if (!(await canViewExperiment(auth, experiment))) return unauthorized();
    return experimentJson({ data: await experimentRunService.listRuns(websiteId, experimentId) });
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { auth, body, error } = await parseRequest(request, experimentRunRequestSchema);
  if (error) return error();
  const { websiteId, experimentId } = await params;
  try {
    const experiment = await experimentRunService.getExperiment(websiteId, experimentId);
    if (!(await canUpdateExperiment(auth, experiment))) return unauthorized();
    return experimentJson(
      await experimentRunService.createRun(websiteId, experimentId, {
        ...body.configuration,
        mutualExclusionGroupId: body.mutualExclusionGroupId,
      }),
    );
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
