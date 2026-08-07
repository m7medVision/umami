import type { Prisma } from '@/generated/prisma/client';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

export const EXPERIMENT_NOTIFICATION_TYPES = [
  'sample-ratio-mismatch',
  'sample-reached',
  'ready-to-decide',
  'finalized',
  'promoted',
  'rolled-back',
] as const;

export type ExperimentNotificationType = (typeof EXPERIMENT_NOTIFICATION_TYPES)[number];

export interface ExperimentNotificationTarget {
  id: string;
  websiteId: string;
  experimentId: string;
}

export interface ExperimentNotificationRepository {
  createIfAbsent(data: {
    id: string;
    websiteId: string;
    experimentId: string;
    experimentRunId: string;
    type: ExperimentNotificationType;
    dedupeKey: string;
    data: unknown;
    createdAt: Date;
  }): Promise<any>;
  list(websiteId: string, unreadOnly: boolean): Promise<any[]>;
  update(
    websiteId: string,
    notificationId: string,
    data: { readAt?: Date; dismissedAt?: Date },
  ): Promise<any | null>;
}

export const prismaExperimentNotificationRepository: ExperimentNotificationRepository = {
  createIfAbsent: data =>
    prisma.client.experimentNotification.upsert({
      where: { dedupeKey: data.dedupeKey },
      create: { ...data, data: data.data as Prisma.InputJsonValue },
      update: {},
    }),
  list: (websiteId, unreadOnly) =>
    prisma.client.experimentNotification.findMany({
      where: {
        websiteId,
        dismissedAt: null,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  update: async (websiteId, id, data) => {
    const result = await prisma.client.experimentNotification.updateMany({
      where: { id, websiteId, dismissedAt: null },
      data,
    });
    return result.count ? prisma.client.experimentNotification.findUnique({ where: { id } }) : null;
  },
};

export function buildExperimentNotification(
  run: ExperimentNotificationTarget,
  type: ExperimentNotificationType,
  data: Record<string, unknown> = {},
  createdAt = new Date(),
) {
  return {
    id: uuid(),
    websiteId: run.websiteId,
    experimentId: run.experimentId,
    experimentRunId: run.id,
    type,
    dedupeKey: `${run.id}:${type}`,
    data,
    createdAt,
  };
}

export function getResultNotificationFacts(snapshot: any) {
  const safeguards = snapshot?.safeguardResults ?? {};
  const modes = [safeguards.session, safeguards.visitor].filter(Boolean);
  const facts: { type: ExperimentNotificationType; data?: Record<string, unknown> }[] = [];

  if (modes.some(mode => mode?.checks?.sampleRatioMismatch?.passed === false)) {
    facts.push({ type: 'sample-ratio-mismatch' });
  }
  if (modes.some(mode => mode?.checks?.minimumSample?.passed === true)) {
    facts.push({ type: 'sample-reached' });
  }
  const readyMode = modes.find(mode => mode?.ready === true);
  if (readyMode) {
    facts.push({
      type: 'ready-to-decide',
      data: { winningVariation: readyMode.winnerVariation ?? null },
    });
  }
  return facts;
}

export function createExperimentNotificationService({
  repository = prismaExperimentNotificationRepository,
  now = () => new Date(),
}: {
  repository?: ExperimentNotificationRepository;
  now?: () => Date;
} = {}) {
  async function notify(
    run: ExperimentNotificationTarget,
    type: ExperimentNotificationType,
    data: Record<string, unknown> = {},
  ) {
    return repository.createIfAbsent(buildExperimentNotification(run, type, data, now()));
  }

  return {
    notify,
    async syncResultFacts(run: ExperimentNotificationTarget, snapshot: any) {
      return Promise.all(
        getResultNotificationFacts(snapshot).map(fact => notify(run, fact.type, fact.data)),
      );
    },
    list: (websiteId: string, unreadOnly = false) => repository.list(websiteId, unreadOnly),
    markRead: (websiteId: string, notificationId: string) =>
      repository.update(websiteId, notificationId, { readAt: now() }),
    dismiss: (websiteId: string, notificationId: string) =>
      repository.update(websiteId, notificationId, { readAt: now(), dismissedAt: now() }),
  };
}

export const experimentNotificationService = createExperimentNotificationService();
