import { beforeEach, expect, test, vi } from 'vitest';
import { experimentNotificationService } from '@/lib/experiments/notifications';
import { parseRequest } from '@/lib/request';
import { canUpdateWebsite, canViewWebsite } from '@/permissions';
import { GET } from './route';

vi.mock('@/lib/experiments/notifications', () => ({
  experimentNotificationService: { list: vi.fn() },
}));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn(), canViewWebsite: vi.fn() }));

const context = { params: Promise.resolve({ websiteId: 'website-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'viewer' } },
    query: { unread: false },
    error: undefined,
  } as any);
  vi.mocked(canViewWebsite).mockResolvedValue(true);
  vi.mocked(canUpdateWebsite).mockResolvedValue(false);
  vi.mocked(experimentNotificationService.list).mockResolvedValue([
    { id: 'unread', readAt: null },
    { id: 'read', readAt: new Date() },
  ] as any);
});

test('viewers can list notifications while mutation permission is explicit', async () => {
  const response = await GET(new Request('http://localhost/notifications'), context);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    unreadCount: 1,
    permissions: { canEdit: false },
  });
});

test('users without Website view permission cannot list notifications', async () => {
  vi.mocked(canViewWebsite).mockResolvedValue(false);

  const response = await GET(new Request('http://localhost/notifications'), context);

  expect(response.status).toBe(401);
  expect(experimentNotificationService.list).not.toHaveBeenCalled();
});
