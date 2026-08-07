import { keepPreviousData } from '@tanstack/react-query';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';

export function useWebsiteExperimentsQuery(
  websiteId: string,
  params?: Record<string, string>,
  options?: ReactQueryOptions,
) {
  const { get, useQuery } = useApi();
  const { modified } = useModified('experiments');

  return useQuery({
    queryKey: ['website:experiments', { websiteId, modified, ...params }],
    queryFn: pageParams => get(`/websites/${websiteId}/experiments`, { ...pageParams, ...params }),
    enabled: !!websiteId,
    placeholderData: keepPreviousData,
    ...options,
  });
}
