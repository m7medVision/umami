import { experimentErrorResponse, experimentJson } from '@/lib/experiments/api';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { ok, unauthorized } from '@/lib/response';
import { experimentRunRequestSchema } from '@/lib/schema';
import { canArchiveExperiment, canUpdateExperiment, canViewExperiment } from '@/permissions';

type Params = {
  params: Promise<{ websiteId: string; experimentId: string; runId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId, experimentId, runId } = await params;
  try {
    const run = await experimentRunService.getRun(websiteId, experimentId, runId);
    if (!(await canViewExperiment(auth, run))) return unauthorized();
    return experimentJson(run);
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { auth, body, error } = await parseRequest(request, experimentRunRequestSchema);
  if (error) return error();
  const { websiteId, experimentId, runId } = await params;
  try {
    const run = await experimentRunService.getRun(websiteId, experimentId, runId);
    if (!(await canUpdateExperiment(auth, run))) return unauthorized();
    return experimentJson(
      await experimentRunService.updateDraftRun(websiteId, experimentId, runId, {
        ...body.configuration,
        mutualExclusionGroupId: body.mutualExclusionGroupId,
      }),
    );
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId, experimentId, runId } = await params;
  try {
    const run = await experimentRunService.getRun(websiteId, experimentId, runId);
    if (!(await canArchiveExperiment(auth, run))) return unauthorized();
    await experimentRunService.deleteDraft(websiteId, experimentId, runId);
    return ok();
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
