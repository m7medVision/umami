import { experimentErrorResponse } from '@/lib/experiments/api';
import { checkExperimentRefreshRateLimit } from '@/lib/experiments/refreshRateLimit';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { json, tooManyRequests, unauthorized } from '@/lib/response';
import { canUpdateExperiment } from '@/permissions';

type Params = { params: Promise<{ websiteId: string; experimentId: string; runId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const route = await params;
  try {
    const run = await experimentRunService.getRun(route.websiteId, route.experimentId, route.runId);
    if (!(await canUpdateExperiment(auth, run))) return unauthorized();
    const actor = auth?.user?.id ?? 'authenticated';
    if (!(await checkExperimentRefreshRateLimit(`${route.websiteId}:${route.runId}:${actor}`))) {
      return tooManyRequests({ message: 'Experiment results were refreshed recently' });
    }
    return json(
      await experimentRunService.refreshResults(route.websiteId, route.experimentId, route.runId),
    );
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
