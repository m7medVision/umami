import { z } from 'zod';
import { uuid } from '@/lib/crypto';
import { parseRequest } from '@/lib/request';
import { json, serverError, unauthorized } from '@/lib/response';
import { canDeleteWebsite } from '@/permissions';
import { createExperimentPrivacyAudit } from '@/queries/prisma';
import { deleteExperimentVisitorData } from '@/queries/sql/experiments';

const privacyDeletionSchema = z.object({
  userKey: z.string().min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, body, error } = await parseRequest(request, privacyDeletionSchema);
  if (error) return error();

  const { websiteId } = await params;
  if (!(await canDeleteWebsite(auth, websiteId))) return unauthorized();

  try {
    await deleteExperimentVisitorData({ websiteId, userKey: body.userKey });
    const audit = await createExperimentPrivacyAudit({
      id: uuid(),
      websiteId,
      requestedBy: auth?.user?.id ?? null,
      operation: 'visitor-data-deletion',
    });
    return json({ deleted: true, auditId: audit.id });
  } catch (cause) {
    return serverError(cause);
  }
}
