import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canDeleteWebsite, canUpdateWebsite, canViewWebsite } from '@/permissions';
import { getWebsiteExperimentSetupOptions } from '@/queries/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, error } = await parseRequest(request);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewWebsite(auth, websiteId))) return unauthorized();

  const [options, canEdit, canArchive] = await Promise.all([
    getWebsiteExperimentSetupOptions(websiteId),
    canUpdateWebsite(auth, websiteId),
    canDeleteWebsite(auth, websiteId),
  ]);
  return json({ ...options, permissions: { canEdit, canArchive } });
}
