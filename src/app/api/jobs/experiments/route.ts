import { isExperimentJobRequestAuthorized } from '@/lib/experiments/jobAuth';
import { experimentJobService } from '@/lib/experiments/jobService';
import { json, unauthorized } from '@/lib/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isExperimentJobRequestAuthorized(request)) return unauthorized();

  const result = await experimentJobService.run();
  return json(result);
}
