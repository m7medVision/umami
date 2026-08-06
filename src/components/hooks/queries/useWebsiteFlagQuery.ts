import { keepPreviousData } from '@tanstack/react-query';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';

export function useWebsiteFlagQuery(
  websiteId: string,
  flagId?: string,
  options?: ReactQueryOptions,
) {
  const { get, useQuery } = useApi();
  const { modified } = useModified('flags');

  return useQuery({
    queryKey: ['website:flag', { websiteId, flagId, modified }],
    queryFn: () => get(`/websites/${websiteId}/flags/${flagId}`),
    enabled: !!(websiteId && flagId),
    placeholderData: keepPreviousData,
    ...options,
  });
}
