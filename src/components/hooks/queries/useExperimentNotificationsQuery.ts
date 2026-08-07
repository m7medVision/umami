import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';

export function useExperimentNotificationsQuery(websiteId: string, options?: ReactQueryOptions) {
  const { get, useQuery } = useApi();
  return useQuery({
    queryKey: ['website:experiment-notifications', websiteId],
    queryFn: () => get(`/websites/${websiteId}/experiments/notifications`),
    enabled: !!websiteId,
    refetchInterval: 30_000,
    ...options,
  });
}
