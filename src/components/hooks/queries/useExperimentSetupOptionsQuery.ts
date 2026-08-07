import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';

export function useExperimentSetupOptionsQuery(websiteId: string, options?: ReactQueryOptions) {
  const { get, useQuery } = useApi();
  return useQuery({
    queryKey: ['website:experiment-options', websiteId],
    queryFn: () => get(`/websites/${websiteId}/experiments/options`),
    enabled: !!websiteId,
    ...options,
  });
}
