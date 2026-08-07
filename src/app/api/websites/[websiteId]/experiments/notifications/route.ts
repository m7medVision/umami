import { z } from 'zod';
import { experimentNotificationService } from '@/lib/experiments/notifications';
import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canUpdateWebsite, canViewWebsite } from '@/permissions';

const querySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform(value => value === 'true'),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, querySchema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewWebsite(auth, websiteId))) return unauthorized();

  const [data, canEdit] = await Promise.all([
    experimentNotificationService.list(websiteId, query.unread),
    canUpdateWebsite(auth, websiteId),
  ]);
  return json({
    data,
    unreadCount: data.filter(notification => !notification.readAt).length,
    permissions: { canEdit },
  });
}
