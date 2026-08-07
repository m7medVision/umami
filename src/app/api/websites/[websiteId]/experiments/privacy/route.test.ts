import { beforeEach, expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import { canDeleteWebsite } from '@/permissions';
import { createExperimentPrivacyAudit } from '@/queries/prisma';
import { deleteExperimentVisitorData } from '@/queries/sql/experiments';
import { POST } from './route';

vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/permissions', () => ({ canDeleteWebsite: vi.fn() }));
vi.mock('@/queries/prisma', () => ({ createExperimentPrivacyAudit: vi.fn() }));
vi.mock('@/queries/sql/experiments', () => ({ deleteExperimentVisitorData: vi.fn() }));

const rawUserKey = 'private-customer@example.test';
const context = { params: Promise.resolve({ websiteId: 'website-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({
    auth: { user: { id: 'manager-1' } },
    body: { userKey: rawUserKey },
    error: undefined,
  } as any);
  vi.mocked(canDeleteWebsite).mockResolvedValue(true);
  vi.mocked(deleteExperimentVisitorData).mockResolvedValue(undefined);
  vi.mocked(createExperimentPrivacyAudit).mockResolvedValue({ id: 'audit-1' } as any);
});

test('Website delete permission is required for destructive Experiment privacy deletion', async () => {
  vi.mocked(canDeleteWebsite).mockResolvedValue(false);

  const response = await POST(new Request('http://localhost/privacy', { method: 'POST' }), context);

  expect(response.status).toBe(401);
  expect(deleteExperimentVisitorData).not.toHaveBeenCalled();
  expect(createExperimentPrivacyAudit).not.toHaveBeenCalled();
});

test('raw identity is handed only to the HMAC deletion boundary and never written to Postgres audit', async () => {
  const consoleSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];

  const response = await POST(new Request('http://localhost/privacy', { method: 'POST' }), context);

  expect(response.status).toBe(200);
  expect(deleteExperimentVisitorData).toHaveBeenCalledWith({
    websiteId: 'website-1',
    userKey: rawUserKey,
  });
  expect(createExperimentPrivacyAudit).toHaveBeenCalledWith({
    id: expect.any(String),
    websiteId: 'website-1',
    requestedBy: 'manager-1',
    operation: 'visitor-data-deletion',
  });
  const auditPayload = vi.mocked(createExperimentPrivacyAudit).mock.calls[0][0];
  expect(JSON.stringify(auditPayload)).not.toContain(rawUserKey);
  expect(JSON.stringify(auditPayload)).not.toMatch(/[a-f0-9]{64}/);
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});
