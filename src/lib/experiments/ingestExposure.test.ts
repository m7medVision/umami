import { describe, expect, test, vi } from 'vitest';
import { createExposureIngestionService } from './ingestExposure';

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TAB_KEY = '44444444-4444-4444-8444-444444444444';
const DIGEST = `k1.i1:${'a'.repeat(64)}`;

const input = {
  websiteId: WEBSITE_ID,
  sessionId: SESSION_ID,
  featureFlagKey: 'checkout-layout',
  variation: 1,
  idempotencyKey: 'opaque.uuid',
  source: 'auto' as const,
  sdkVersion: '3.2.0',
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    findRunningRun: vi.fn().mockResolvedValue({
      id: RUN_ID,
      websiteId: WEBSITE_ID,
      status: 'Running',
      startedAt: new Date('2025-01-01T00:00:00Z'),
      featureFlagKey: 'checkout-layout',
      featureFlagVariations: [{ value: 'control' }, { value: 'compact' }],
    }),
    parseAssignmentReference: vi.fn().mockReturnValue({
      websiteId: WEBSITE_ID,
      experimentRunId: RUN_ID,
      featureFlagKey: 'checkout-layout',
      variation: 1,
      unitType: 'session',
      unitKey: TAB_KEY,
    }),
    getAssignment: vi.fn().mockResolvedValue({
      experimentRunId: RUN_ID,
      variation: 1,
      unitType: 'session',
    }),
    getLinkedDistinctIds: vi.fn().mockResolvedValue([]),
    createVisitorDigest: vi.fn().mockReturnValue(DIGEST),
    saveExposure: vi.fn().mockResolvedValue({ saved: true }),
    markFirstExposure: vi.fn().mockResolvedValue(undefined),
    saveDiagnostic: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ingestExposure', () => {
  test('accepts only a persisted Running assignment and writes authoritative context', async () => {
    const deps = dependencies();
    const ingestExposure = createExposureIngestionService(deps as any);

    await expect(ingestExposure(input)).resolves.toEqual({ accepted: true, saved: true });
    expect(deps.saveExposure).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteId: WEBSITE_ID,
        experimentRunId: RUN_ID,
        sessionId: SESSION_ID,
        unitType: 'session',
        unitKey: TAB_KEY,
        variation: 1,
      }),
    );
    expect(deps.markFirstExposure).toHaveBeenCalledWith(RUN_ID, expect.any(Date));
  });

  test.each([
    ['unknown flag', { findRunningRun: vi.fn().mockResolvedValue(null) }],
    ['paused Run', { findRunningRun: vi.fn().mockResolvedValue(null) }],
    ['invalid opaque reference', { parseAssignmentReference: vi.fn().mockReturnValue(null) }],
    [
      'mismatched Variation',
      {
        getAssignment: vi.fn().mockResolvedValue({
          experimentRunId: RUN_ID,
          variation: 0,
          unitType: 'session',
        }),
      },
    ],
    ['ineligible missing assignment', { getAssignment: vi.fn().mockResolvedValue(null) }],
  ])('drops %s without writing an Exposure', async (_name, override) => {
    const deps = dependencies(override);
    const ingestExposure = createExposureIngestionService(deps as any);

    await expect(ingestExposure(input)).resolves.toMatchObject({ accepted: false });
    expect(deps.saveExposure).not.toHaveBeenCalled();
  });

  test('rejects Exposure timestamps before the Run started', async () => {
    const deps = dependencies();
    const ingestExposure = createExposureIngestionService(deps as any);

    await expect(
      ingestExposure({ ...input, exposedAt: new Date('2024-12-31T23:59:59Z') }),
    ).resolves.toEqual({ accepted: false, saved: false, reason: 'exposure-before-run' });
    expect(deps.saveExposure).not.toHaveBeenCalled();
  });

  test('uses the authoritative session identity link when it resolves a persisted visitor assignment', async () => {
    const visitorAssignment = { experimentRunId: RUN_ID, variation: 1, unitType: 'visitor' };
    const getAssignment = vi
      .fn()
      .mockResolvedValueOnce(visitorAssignment)
      .mockResolvedValueOnce({ experimentRunId: RUN_ID, variation: 1, unitType: 'session' });
    const deps = dependencies({
      getLinkedDistinctIds: vi.fn().mockResolvedValue(['customer-42']),
      getAssignment,
    });
    const ingestExposure = createExposureIngestionService(deps as any);

    await expect(ingestExposure(input)).resolves.toMatchObject({ accepted: true });
    expect(deps.createVisitorDigest).toHaveBeenCalledWith(WEBSITE_ID, 'customer-42');
    expect(deps.saveExposure).toHaveBeenCalledWith(
      expect.objectContaining({ unitType: 'visitor', unitKey: DIGEST }),
    );
    expect(JSON.stringify(deps.saveExposure.mock.calls)).not.toContain('customer-42');
  });

  test('isolates ClickHouse collection failures', async () => {
    const deps = dependencies({ saveExposure: vi.fn().mockRejectedValue(new Error('down')) });
    const ingestExposure = createExposureIngestionService(deps as any);

    await expect(ingestExposure(input)).resolves.toEqual({
      accepted: false,
      saved: false,
      reason: 'collection-failure',
    });
    expect(deps.saveDiagnostic).toHaveBeenCalledWith({
      websiteId: WEBSITE_ID,
      experimentRunId: RUN_ID,
      type: 'collection-failure',
      reason: 'exposure-ingestion',
    });
    expect(JSON.stringify(deps.saveDiagnostic.mock.calls)).not.toContain(TAB_KEY);
  });
});
