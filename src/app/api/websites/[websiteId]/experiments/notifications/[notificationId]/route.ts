import { z } from 'zod';
import { experimentNotificationService } from '@/lib/experiments/notifications';
import { parseRequest } from '@/lib/request';
import { json, notFound, unauthorized } from '@/lib/response';
import { canUpdateWebsite } from '@/permissions';

const updateSchema = z.object({ action: z.enum(['read', 'dismiss']) });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; notificationId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, updateSchema);
  if (error) return error();
  const { websiteId, notificationId } = await params;
  if (!(await canUpdateWebsite(auth, websiteId))) return unauthorized();

  const result =
    body.action === 'read'
      ? await experimentNotificationService.markRead(websiteId, notificationId)
      : await experimentNotificationService.dismiss(websiteId, notificationId);
  return result ? json(result) : notFound();
}
