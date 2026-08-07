import { experimentErrorResponse } from '@/lib/experiments/api';
import {
  createExperimentAggregateCsv,
  createExperimentFrozenConfigExport,
} from '@/lib/experiments/export';
import { experimentRunService } from '@/lib/experiments/runService';
import { parseRequest } from '@/lib/request';
import { badRequest, unauthorized } from '@/lib/response';
import { canViewExperiment } from '@/permissions';

type Params = { params: Promise<{ websiteId: string; experimentId: string; runId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const route = await params;
  try {
    const run = await experimentRunService.getRun(route.websiteId, route.experimentId, route.runId);
    if (!(await canViewExperiment(auth, run))) return unauthorized();
    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'csv';
    if (format === 'json') {
      return new Response(JSON.stringify(createExperimentFrozenConfigExport(run), null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="experiment-run-${run.runNumber}-config.json"`,
        },
      });
    }
    if (format !== 'csv') return badRequest({ message: 'Export format must be csv or json' });
    const mode = url.searchParams.get('mode') === 'visitor' ? 'visitor' : 'session';
    const results = await experimentRunService.getResults(
      route.websiteId,
      route.experimentId,
      route.runId,
    );
    return new Response(createExperimentAggregateCsv(results, mode), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="experiment-run-${run.runNumber}-${mode}.csv"`,
      },
    });
  } catch (cause) {
    return experimentErrorResponse(cause);
  }
}
