import { z } from 'zod';
import { experimentErrorResponse, experimentJson } from '@/lib/experiments/api';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { badRequest, unauthorized } from '@/lib/response';
import { experimentPromoteSchema } from '@/lib/schema';
import { canArchiveExperiment, canUpdateExperiment } from '@/permissions';

const actions = [
  'start',
  'pause',
  'resume',
  'complete',
  'finalize',
  'archive',
  'promote',
  'rollback',
] as const;
type Action = (typeof actions)[number];
type Params = {
  params: Promise<{
    websiteId: string;
    experimentId: string;
    runId: string;
    action: string;
  }>;
};

export async function POST(request: Request, { params }: Params) {
  const route = await params;
  if (!actions.includes(route.action as Action)) {
    return badRequest({ message: 'Unknown Experiment Run action' });
  }
  const action = route.action as Action;
  const schema = action === 'promote' ? experimentPromoteSchema : z.object({});
  const { auth, body, error } = await parseRequest(request, schema);
  if (error) return error();

  try {
    const run = await experimentRunService.getRun(route.websiteId, route.experimentId, route.runId);
    const permitted =
      action === 'archive'
        ? await canArchiveExperiment(auth, run)
        : await canUpdateExperiment(auth, run);
    if (!permitted) return unauthorized();

    const actorId = auth?.user?.id ?? null;
    const args = [route.websiteId, route.experimentId, route.runId] as const;
    switch (action) {
      case 'start':
        return experimentJson(await experimentRunService.start(...args));
      case 'pause':
        return experimentJson(await experimentRunService.pause(...args));
      case 'resume':
        return experimentJson(await experimentRunService.resume(...args));
      case 'complete':
        return experimentJson(await experimentRunService.complete(...args));
      case 'finalize':
        return experimentJson(await experimentRunService.finalize(...args));
      case 'archive':
        return experimentJson(await experimentRunService.archive(...args));
      case 'promote':
        return experimentJson(
          await experimentRunService.promote(...args, body.winningVariation, actorId),
        );
      case 'rollback':
        return experimentJson(await experimentRunService.rollback(...args, actorId));
    }
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
