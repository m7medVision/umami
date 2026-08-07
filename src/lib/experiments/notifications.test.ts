import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));

import {
  createExperimentNotificationService,
  type ExperimentNotificationRepository,
} from './notifications';

const now = new Date('2026-02-02T12:00:00Z');
const run = { id: 'run-1', experimentId: 'experiment-1', websiteId: 'website-1' };

function fixture() {
  const records: any[] = [];
  const repository: ExperimentNotificationRepository = {
    createIfAbsent: vi.fn(async data => {
      const existing = records.find(item => item.dedupeKey === data.dedupeKey);
      if (existing) return existing;
      const created = {
        id: `notification-${records.length + 1}`,
        ...data,
        readAt: null,
        dismissedAt: null,
      };
      records.push(created);
      return created;
    }),
    list: vi.fn(async (websiteId, unreadOnly) =>
      records.filter(
        item => item.websiteId === websiteId && !item.dismissedAt && (!unreadOnly || !item.readAt),
      ),
    ),
    update: vi.fn(async (websiteId, id, data) => {
      const record = records.find(item => item.websiteId === websiteId && item.id === id);
      if (!record) return null;
      Object.assign(record, data);
      return record;
    }),
  };
  return {
    records,
    repository,
    service: createExperimentNotificationService({ repository, now: () => now }),
  };
}

describe('Experiment notifications', () => {
  test('creates SRM, sample reached, and ready facts once across repeated result refreshes', async () => {
    const { records, service } = fixture();
    const snapshot = {
      safeguardResults: {
        session: {
          ready: true,
          checks: {
            minimumSample: { passed: true },
            sampleRatioMismatch: { passed: false },
          },
        },
        visitor: { ready: false, checks: {} },
      },
    };

    await service.syncResultFacts(run, snapshot);
    await service.syncResultFacts(run, snapshot);

    expect(records.map(record => record.type)).toEqual([
      'sample-ratio-mismatch',
      'sample-reached',
      'ready-to-decide',
    ]);
  });

  test('creates finalization, promotion, and rollback lifecycle facts idempotently', async () => {
    const { records, service } = fixture();

    await service.notify(run, 'finalized');
    await service.notify(run, 'finalized');
    await service.notify(run, 'promoted', { winningVariation: 1 });
    await service.notify(run, 'rolled-back');

    expect(records.map(record => record.type)).toEqual(['finalized', 'promoted', 'rolled-back']);
  });

  test('read and dismiss preserve the durable record while hiding dismissed notifications', async () => {
    const { records, service } = fixture();
    const notification = await service.notify(run, 'finalized');

    await service.markRead('website-1', notification.id);
    expect(records[0].readAt).toEqual(now);

    await service.dismiss('website-1', notification.id);
    expect(records[0].dismissedAt).toEqual(now);
    await expect(service.list('website-1')).resolves.toEqual([]);
  });
});
