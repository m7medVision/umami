import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';

export function useExperimentRunResultsQuery(
  websiteId: string,
  experimentId: string,
  runId: string,
  options?: ReactQueryOptions,
) {
  const { get, useQuery } = useApi();
  return useQuery({
    queryKey: ['experiment-run-results', { websiteId, experimentId, runId }],
    queryFn: () => get(`/websites/${websiteId}/experiments/${experimentId}/runs/${runId}/results`),
    enabled: Boolean(websiteId && experimentId && runId),
    ...options,
  });
}
