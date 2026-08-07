import { beforeEach, describe, expect, test, vi } from 'vitest';
import { evaluateExperimentFeatureFlags } from '@/lib/experiments/evaluation';
import { fetchWebsite, fetchWebsiteFeatureFlags } from '@/lib/load';
import { parseRequest } from '@/lib/request';
import { POST } from './route';

vi.mock('@/lib/experiments/evaluation', () => ({
  createExperimentFeatureFlagEvaluationDependencies: vi.fn(() => ({})),
  evaluateExperimentFeatureFlags: vi.fn(),
}));
vi.mock('@/lib/load', () => ({ fetchWebsite: vi.fn(), fetchWebsiteFeatureFlags: vi.fn() }));
vi.mock('@/lib/request', () => ({ parseRequest: vi.fn() }));
vi.mock('@/lib/redis', () => ({ default: { enabled: false } }));
vi.mock('@/queries/prisma', () => ({ getRunningFeatureFlagExperimentRun: vi.fn() }));
vi.mock('@/queries/sql', () => ({ clickhouseExperimentAssignmentAdapter: {} }));

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';
const TAB_KEY = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseRequest).mockResolvedValue({
    body: {
      userKey: 'customer-1',
      assignmentKey: TAB_KEY,
      context: { country: 'US', plan: 'pro' },
    },
    error: undefined,
  } as any);
  vi.mocked(fetchWebsite).mockResolvedValue({ id: WEBSITE_ID } as any);
  vi.mocked(fetchWebsiteFeatureFlags).mockResolvedValue([] as any);
  vi.mocked(evaluateExperimentFeatureFlags).mockResolvedValue({
    flags: { checkout: { enabled: true, value: 'compact' } },
    experiments: {
      checkout: {
        resolved: true,
        variation: 1,
        assignment: 'opaque-assignment',
        reference: 'opaque-reference',
      },
    },
  });
});

describe('POST /api/flags/eval', () => {
  test('accepts tracker identity and an anonymous per-tab assignment key', async () => {
    const response = await POST(
      new Request('http://localhost/api/flags/eval', {
        method: 'POST',
        headers: { 'x-umami-website-id': WEBSITE_ID },
      }),
    );

    expect(evaluateExperimentFeatureFlags).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteId: WEBSITE_ID,
        userKey: 'customer-1',
        assignmentKey: TAB_KEY,
        context: { country: 'US', plan: 'pro' },
      }),
      expect.anything(),
    );
    await expect(response.json()).resolves.toEqual({
      flags: { checkout: { enabled: true, value: 'compact' } },
      experiments: {
        checkout: {
          resolved: true,
          variation: 1,
          assignment: 'opaque-assignment',
          reference: 'opaque-reference',
        },
      },
    });
  });

  test('validates assignmentKey as a UUID', async () => {
    await POST(
      new Request('http://localhost/api/flags/eval', {
        method: 'POST',
        headers: { 'x-umami-website-id': WEBSITE_ID },
      }),
    );
    const schema = vi.mocked(parseRequest).mock.calls[0][1];

    expect(
      schema.safeParse({
        userKey: 'customer-1',
        assignmentKey: TAB_KEY,
        context: { country: 'US', score: 42, internal: false },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ assignmentKey: 'not-a-uuid' }).success).toBe(false);
  });
});
