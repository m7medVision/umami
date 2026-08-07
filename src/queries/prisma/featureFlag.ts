import type { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

export async function getFeatureFlag(featureFlagId: string) {
  return prisma.client.featureFlag.findFirst({
    where: { id: featureFlagId, archivedAt: null },
  });
}

export async function getWebsiteFeatureFlag(websiteId: string, featureFlagId: string) {
  return prisma.client.featureFlag.findFirst({
    where: { id: featureFlagId, websiteId, archivedAt: null },
  });
}

export async function getWebsiteFeatureFlagByKey(websiteId: string, key: string) {
  return prisma.client.featureFlag.findFirst({
    where: { websiteId, key, archivedAt: null },
  });
}

export async function getFeatureFlags(
  criteria: Prisma.FeatureFlagFindManyArgs,
  filters: QueryFilters,
) {
  const { search } = filters;
  const { getSearchParameters, pagedQuery } = prisma;
  const where: Prisma.FeatureFlagWhereInput = {
    ...criteria.where,
    archivedAt: null,
    ...getSearchParameters(search, [
      { key: 'contains' },
      { name: 'contains' },
      { description: 'contains' },
    ]),
  };

  return pagedQuery('featureFlag', { ...criteria, where }, filters);
}

export async function getWebsiteFeatureFlags(websiteId: string, filters: QueryFilters) {
  return getFeatureFlags({ where: { websiteId }, orderBy: { createdAt: 'desc' } }, filters);
}

export async function getWebsiteFeatureFlagDefinitions(websiteId: string) {
  return prisma.client.featureFlag.findMany({
    where: { websiteId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createFeatureFlag(data: Prisma.FeatureFlagUncheckedCreateInput) {
  return prisma.client.featureFlag.create({ data });
}

export async function updateFeatureFlag(
  featureFlagId: string,
  data: Prisma.FeatureFlagUpdateInput,
) {
  return prisma.client.featureFlag.update({ where: { id: featureFlagId }, data });
}

export async function deleteFeatureFlag(featureFlagId: string) {
  return prisma.client.featureFlag.delete({ where: { id: featureFlagId } });
}
