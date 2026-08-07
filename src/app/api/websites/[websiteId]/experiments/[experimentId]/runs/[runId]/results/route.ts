import { experimentErrorResponse } from '@/lib/experiments/api';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canArchiveExperiment, canUpdateExperiment, canViewExperiment } from '@/permissions';

type Params = { params: Promise<{ websiteId: string; experimentId: string; runId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const route = await params;
  try {
    const run = await experimentRunService.getRun(route.websiteId, route.experimentId, route.runId);
    if (!(await canViewExperiment(auth, run))) return unauthorized();
    const result = await experimentRunService.getResults(
      route.websiteId,
      route.experimentId,
      route.runId,
    );
    return json({
      ...result,
      run: {
        id: run.id,
        runNumber: run.runNumber,
        status: run.status,
        startedAt: run.startedAt,
        pausedAt: run.pausedAt,
        completedAt: run.completedAt,
        provisionalUntil: run.provisionalUntil,
        finalizedAt: run.finalizedAt,
        rawDataRetainedUntil: run.rawDataRetainedUntil,
        lastComputedAt: run.lastComputedAt,
        promotion: run.promotions?.[0]
          ? {
              winningVariation: run.promotions[0].winningVariation,
              promotedAt: run.promotions[0].promotedAt,
              rolledBackAt: run.promotions[0].rolledBackAt,
            }
          : null,
      },
      permissions: {
        canEdit: await canUpdateExperiment(auth, run),
        canArchive: await canArchiveExperiment(auth, run),
      },
    });
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
