import type { Prisma } from '@/generated/prisma/client';
import { ACTIVE_EXPERIMENT_RUN_STATUSES } from '@/lib/experiments';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

export async function getExperiment(experimentId: string) {
  return prisma.client.experiment.findUnique({ where: { id: experimentId } });
}

export async function getWebsiteExperiment(websiteId: string, experimentId: string) {
  return prisma.client.experiment.findFirst({ where: { id: experimentId, websiteId } });
}

export async function getExperiments(
  criteria: Prisma.ExperimentFindManyArgs,
  filters: QueryFilters = {},
) {
  const { search } = filters;
  const where: Prisma.ExperimentWhereInput = {
    ...criteria.where,
    ...prisma.getSearchParameters(search, [{ name: 'contains' }, { description: 'contains' }]),
  };

  return prisma.pagedQuery('experiment', { ...criteria, where }, filters);
}

export async function getWebsiteExperimentSetupOptions(websiteId: string) {
  const [featureFlags, segments, mutualExclusionGroups] = await Promise.all([
    prisma.client.featureFlag.findMany({
      where: { websiteId, archivedAt: null },
      orderBy: { name: 'asc' },
    }),
    prisma.client.segment.findMany({ where: { websiteId }, orderBy: { name: 'asc' } }),
    prisma.client.mutualExclusionGroup.findMany({
      where: { websiteId, archivedAt: null },
      orderBy: { name: 'asc' },
    }),
  ]);
  return { featureFlags, segments, mutualExclusionGroups };
}

export async function getWebsiteExperiments(
  websiteId: string,
  filters?: QueryFilters,
  status?: string,
) {
  return getExperiments(
    {
      where: {
        websiteId,
        archivedAt: null,
        ...(status ? { runs: { some: { status } } } : {}),
      },
      include: {
        featureFlag: true,
        runs: {
          orderBy: { runNumber: 'desc' },
          take: 1,
          select: {
            id: true,
            runNumber: true,
            status: true,
            readinessStatus: true,
            startedAt: true,
            finalizedAt: true,
            rawDataRetainedUntil: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    },
    filters,
  );
}

export async function createExperiment(data: Prisma.ExperimentUncheckedCreateInput) {
  return prisma.client.experiment.create({ data });
}

export async function updateExperiment(
  experimentId: string,
  data: Prisma.ExperimentUncheckedUpdateInput,
) {
  return prisma.client.experiment.update({ where: { id: experimentId }, data });
}

export async function deleteExperiment(experimentId: string) {
  return prisma.client.experiment.delete({ where: { id: experimentId } });
}

export async function getExperimentRun(experimentRunId: string) {
  return prisma.client.experimentRun.findUnique({ where: { id: experimentRunId } });
}

export async function getWebsiteExperimentRun(websiteId: string, experimentRunId: string) {
  return prisma.client.experimentRun.findFirst({
    where: { id: experimentRunId, websiteId },
  });
}

export async function getExperimentRuns(criteria: Prisma.ExperimentRunFindManyArgs) {
  return prisma.client.experimentRun.findMany(criteria);
}

export async function getActiveFeatureFlagExperimentRun(websiteId: string, featureFlagId: string) {
  return prisma.client.experimentRun.findFirst({
    where: {
      websiteId,
      featureFlagId,
      status: { in: [...ACTIVE_EXPERIMENT_RUN_STATUSES] },
    },
    include: { outcomes: { orderBy: { position: 'asc' } } },
  });
}

export async function getRunningFeatureFlagExperimentRun(websiteId: string, featureFlagId: string) {
  return prisma.client.experimentRun.findFirst({
    where: { websiteId, featureFlagId, status: 'Running' },
  });
}

export async function getRunningFeatureFlagExperimentRunByKey(
  websiteId: string,
  featureFlagKey: string,
) {
  return prisma.client.experimentRun.findFirst({
    where: { websiteId, featureFlagKey, status: 'Running' },
  });
}

export async function markExperimentRunFirstExposure(experimentRunId: string, exposedAt: Date) {
  return prisma.client.experimentRun.updateMany({
    where: { id: experimentRunId, firstExposureAt: null },
    data: { firstExposureAt: exposedAt },
  });
}

export async function createExperimentRun(data: Prisma.ExperimentRunUncheckedCreateInput) {
  return prisma.client.experimentRun.create({ data });
}

export async function updateExperimentRun(
  experimentRunId: string,
  data: Prisma.ExperimentRunUncheckedUpdateInput,
) {
  return prisma.client.experimentRun.update({ where: { id: experimentRunId }, data });
}

export async function deleteExperimentRun(experimentRunId: string) {
  return prisma.client.experimentRun.delete({ where: { id: experimentRunId } });
}

export async function createExperimentOutcome(data: Prisma.ExperimentOutcomeUncheckedCreateInput) {
  return prisma.client.experimentOutcome.create({ data });
}

export async function createExperimentOutcomes(data: Prisma.ExperimentOutcomeCreateManyInput[]) {
  return prisma.client.experimentOutcome.createMany({ data });
}

export async function deleteExperimentOutcomes(experimentRunId: string) {
  return prisma.client.experimentOutcome.deleteMany({ where: { experimentRunId } });
}

export async function getMutualExclusionGroup(mutualExclusionGroupId: string) {
  return prisma.client.mutualExclusionGroup.findUnique({
    where: { id: mutualExclusionGroupId },
  });
}

export async function getWebsiteMutualExclusionGroups(websiteId: string) {
  return prisma.client.mutualExclusionGroup.findMany({
    where: { websiteId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getActiveMutualExclusionRunIds(
  websiteId: string,
  mutualExclusionGroupId: string,
) {
  const runs = await prisma.client.experimentRun.findMany({
    where: {
      websiteId,
      mutualExclusionGroupId,
      status: { in: [...ACTIVE_EXPERIMENT_RUN_STATUSES] },
    },
    select: { id: true },
  });
  return runs.map(run => run.id);
}

export async function createMutualExclusionGroup(
  data: Prisma.MutualExclusionGroupUncheckedCreateInput,
) {
  return prisma.client.mutualExclusionGroup.create({ data });
}

export async function updateMutualExclusionGroup(
  mutualExclusionGroupId: string,
  data: Prisma.MutualExclusionGroupUncheckedUpdateInput,
) {
  return prisma.client.mutualExclusionGroup.update({
    where: { id: mutualExclusionGroupId },
    data,
  });
}

export async function getExperimentResultSnapshot(experimentRunId: string) {
  return prisma.client.experimentResultSnapshot.findUnique({ where: { experimentRunId } });
}

export async function createExperimentResultSnapshot(
  data: Prisma.ExperimentResultSnapshotUncheckedCreateInput,
) {
  return prisma.client.experimentResultSnapshot.create({ data });
}

export async function getExperimentPromotions(experimentRunId: string) {
  return prisma.client.experimentPromotion.findMany({
    where: { experimentRunId },
    orderBy: { promotedAt: 'desc' },
  });
}

export async function createExperimentPromotion(
  data: Prisma.ExperimentPromotionUncheckedCreateInput,
) {
  return prisma.client.experimentPromotion.create({ data });
}

export async function updateExperimentPromotion(
  experimentPromotionId: string,
  data: Prisma.ExperimentPromotionUncheckedUpdateInput,
) {
  return prisma.client.experimentPromotion.update({
    where: { id: experimentPromotionId },
    data,
  });
}

export async function getExperimentNotifications(websiteId: string, unreadOnly = false) {
  return prisma.client.experimentNotification.findMany({
    where: { websiteId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createExperimentNotification(
  data: Prisma.ExperimentNotificationUncheckedCreateInput,
) {
  return prisma.client.experimentNotification.create({ data });
}

export async function updateExperimentNotification(
  experimentNotificationId: string,
  data: Prisma.ExperimentNotificationUncheckedUpdateInput,
) {
  return prisma.client.experimentNotification.update({
    where: { id: experimentNotificationId },
    data,
  });
}

/** Records only that a deletion was performed; identity and digest are intentionally absent. */
export async function createExperimentPrivacyAudit(
  data: Prisma.ExperimentPrivacyAuditUncheckedCreateInput,
) {
  return prisma.client.experimentPrivacyAudit.create({ data });
}
