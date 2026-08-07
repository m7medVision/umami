import { experimentErrorResponse } from '@/lib/experiments/api';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { json, ok, unauthorized } from '@/lib/response';
import { experimentUpdateSchema } from '@/lib/schema';
import { canArchiveExperiment, canUpdateExperiment, canViewExperiment } from '@/permissions';

type Params = { params: Promise<{ websiteId: string; experimentId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId, experimentId } = await params;
  try {
    const experiment = await experimentRunService.getExperiment(websiteId, experimentId);
    if (!(await canViewExperiment(auth, experiment))) return unauthorized();
    return json(experiment);
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { auth, body, error } = await parseRequest(request, experimentUpdateSchema);
  if (error) return error();
  const { websiteId, experimentId } = await params;
  try {
    const experiment = await experimentRunService.getExperiment(websiteId, experimentId);
    if (!(await canUpdateExperiment(auth, experiment))) return unauthorized();
    return json(await experimentRunService.updateExperiment(websiteId, experimentId, body));
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId, experimentId } = await params;
  try {
    const experiment = await experimentRunService.getExperiment(websiteId, experimentId);
    if (!(await canArchiveExperiment(auth, experiment))) return unauthorized();
    await experimentRunService.removeExperiment(websiteId, experimentId);
    return ok();
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
