import { beforeEach, expect, test, vi } from 'vitest';
import { experimentNotificationService } from '@/lib/experiments/notifications';
import { parseRequest } from '@/lib/request';
import { canUpdateWebsite } from '@/permissions';
import { PUT } from './route';

vi.mock('@/lib/experiments/notifications', () => ({
  experimentNotificationService: { markRead: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn() }));

const context = {
  params: Promise.resolve({ websiteId: 'website-1', notificationId: 'notification-1' }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
  vi.mocked(experimentNotificationService.markRead).mockResolvedValue({ id: 'notification-1' });
  vi.mocked(experimentNotificationService.dismiss).mockResolvedValue({ id: 'notification-1' });
});

test.each(['read', 'dismiss'] as const)('editors can %s a Website notification', async action => {
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'editor' } },
    body: { action },
    error: undefined,
  } as any);

  const response = await PUT(
    new Request('http://localhost/notification', { method: 'PUT' }),
    context,
  );

  expect(response.status).toBe(200);
  expect(
    experimentNotificationService[action === 'read' ? 'markRead' : 'dismiss'],
  ).toHaveBeenCalledWith('website-1', 'notification-1');
});

test('view-only users cannot change shared Website notifications', async () => {
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'viewer' } },
    body: { action: 'read' },
  } as any);
  vi.mocked(canUpdateWebsite).mockResolvedValue(false);

  const response = await PUT(
    new Request('http://localhost/notification', { method: 'PUT' }),
    context,
  );

  expect(response.status).toBe(401);
  expect(experimentNotificationService.markRead).not.toHaveBeenCalled();
});
