import { describe, expect, test, vi } from 'vitest';
import { evaluateExperimentFeatureFlags } from './evaluation';

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';
const FLAG_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const TAB_KEY = '44444444-4444-4444-8444-444444444444';

const flag = {
  id: FLAG_ID,
  key: 'checkout-layout',
  enabled: true,
  variations: [{ value: 'control' }, { value: 'compact' }],
  rollout: { percentage: 100, weights: [0.5, 0.5] },
  defaultVariation: 0,
};
const experimentRun = {
  id: RUN_ID,
  websiteId: WEBSITE_ID,
  status: 'Running',
  mutualExclusionGroupId: null,
  featureFlagKey: flag.key,
  featureFlagVariations: flag.variations,
  variationWeights: flag.rollout.weights,
  rolloutPercentage: flag.rollout.percentage,
  fallthroughVariation: flag.defaultVariation,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    findRunningRun: vi.fn().mockResolvedValue(experimentRun),
    resolveAssignment: vi.fn().mockResolvedValue({
      experimentRunId: RUN_ID,
      variation: 1,
      unitType: 'session',
    }),
    createVisitorDigest: vi.fn().mockReturnValue(`k1.i1:${'a'.repeat(64)}`),
    createAssignmentMetadata: vi.fn().mockReturnValue({
      assignment: 'opaque-assignment',
      reference: 'opaque-reference',
    }),
    ...overrides,
  };
}

describe('evaluateExperimentFeatureFlags', () => {
  test('uses the anonymous tab key and returns assignment metadata separately from flag values', async () => {
    const deps = dependencies();

    const result = await evaluateExperimentFeatureFlags(
      { websiteId: WEBSITE_ID, definitions: [flag], assignmentKey: TAB_KEY },
      deps as any,
    );

    expect(deps.resolveAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ sessionAssignmentKey: TAB_KEY, visitorDigest: undefined }),
    );
    expect(result.flags['checkout-layout']).toEqual({ enabled: true, value: 'compact' });
    expect(result.experiments['checkout-layout']).toEqual({
      resolved: true,
      variation: 1,
      assignment: 'opaque-assignment',
      reference: 'opaque-reference',
    });
    expect(JSON.stringify(result)).not.toContain(RUN_ID);
    expect(JSON.stringify(result)).not.toContain(TAB_KEY);
  });

  test('derives an identified visitor digest without returning the raw identity', async () => {
    const deps = dependencies();

    const result = await evaluateExperimentFeatureFlags(
      {
        websiteId: WEBSITE_ID,
        definitions: [flag],
        userKey: 'customer-42',
        assignmentKey: TAB_KEY,
      },
      deps as any,
    );

    expect(deps.createVisitorDigest).toHaveBeenCalledWith(WEBSITE_ID, 'customer-42');
    expect(deps.resolveAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        visitorDigest: `k1.i1:${'a'.repeat(64)}`,
        sessionAssignmentKey: TAB_KEY,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('customer-42');
  });

  test('the persisted first assignment overrides a newly evaluated Variation and value', async () => {
    const deps = dependencies({
      resolveAssignment: vi.fn().mockResolvedValue({
        experimentRunId: RUN_ID,
        variation: 0,
        unitType: 'session',
      }),
    });

    const result = await evaluateExperimentFeatureFlags(
      { websiteId: WEBSITE_ID, definitions: [flag], assignmentKey: TAB_KEY },
      deps as any,
    );

    expect(result.flags['checkout-layout']).toEqual({ enabled: true, value: 'control' });
    expect(result.experiments['checkout-layout']).toMatchObject({ resolved: true, variation: 0 });
  });

  test('assignment failures leave ordinary deterministic flag evaluation unresolved', async () => {
    const deps = dependencies({ resolveAssignment: vi.fn().mockRejectedValue(new Error('down')) });

    const result = await evaluateExperimentFeatureFlags(
      { websiteId: WEBSITE_ID, definitions: [flag], assignmentKey: TAB_KEY },
      deps as any,
    );

    expect(result.flags['checkout-layout']).toEqual({ enabled: true, value: 'control' });
    expect(result.experiments['checkout-layout']).toEqual({ resolved: false });
  });

  test('does not persist an Experiment assignment when participation is disabled', async () => {
    const deps = dependencies();

    const result = await evaluateExperimentFeatureFlags(
      {
        websiteId: WEBSITE_ID,
        definitions: [flag],
        assignmentKey: TAB_KEY,
        participate: false,
      },
      deps as any,
    );

    expect(result.flags['checkout-layout']).toBeDefined();
    expect(result.experiments['checkout-layout']).toEqual({ resolved: false });
    expect(deps.findRunningRun).not.toHaveBeenCalled();
    expect(deps.resolveAssignment).not.toHaveBeenCalled();
  });

  test('an unavailable identity HMAC key leaves identified ordinary flag evaluation available', async () => {
    const deps = dependencies({
      createVisitorDigest: vi.fn().mockImplementation(() => {
        throw new Error('APP_SECRET missing');
      }),
    });

    const result = await evaluateExperimentFeatureFlags(
      {
        websiteId: WEBSITE_ID,
        definitions: [flag],
        userKey: 'customer-42',
        assignmentKey: TAB_KEY,
      },
      deps as any,
    );

    expect(result.flags['checkout-layout']).toEqual({ enabled: true, value: 'compact' });
    expect(result.experiments['checkout-layout']).toEqual({ resolved: false });
    expect(deps.resolveAssignment).not.toHaveBeenCalled();
  });

  test('uses the frozen Run rollout when the live Feature Flag changes', async () => {
    const deps = dependencies();
    const changedFlag = { ...flag, rollout: { percentage: 0, weights: [0.5, 0.5] } };

    const result = await evaluateExperimentFeatureFlags(
      { websiteId: WEBSITE_ID, definitions: [changedFlag], assignmentKey: TAB_KEY },
      deps as any,
    );

    expect(deps.resolveAssignment).toHaveBeenCalled();
    expect(result.flags['checkout-layout']).toEqual({ enabled: true, value: 'compact' });
    expect(result.experiments['checkout-layout']).toMatchObject({ resolved: true, variation: 1 });
  });

  test('enrolls only when the frozen audience matches real-time context', async () => {
    const audienceSegmentSnapshot = {
      type: 'segment',
      parameters: {
        filters: [{ name: 'country', operator: 'eq', value: 'US' }],
        match: 'all',
      },
    };
    const deps = dependencies({
      findRunningRun: vi.fn().mockResolvedValue({
        ...experimentRun,
        audienceSegmentSnapshot,
      }),
    });

    const matching = await evaluateExperimentFeatureFlags(
      {
        websiteId: WEBSITE_ID,
        definitions: [flag],
        assignmentKey: TAB_KEY,
        context: { country: 'US' },
      },
      deps as any,
    );
    expect(matching.experiments['checkout-layout']).toMatchObject({ resolved: true });

    deps.resolveAssignment.mockClear();
    const nonmatching = await evaluateExperimentFeatureFlags(
      {
        websiteId: WEBSITE_ID,
        definitions: [flag],
        assignmentKey: TAB_KEY,
        context: { country: 'CA' },
      },
      deps as any,
    );
    expect(nonmatching.experiments['checkout-layout']).toEqual({ resolved: false });
    expect(deps.resolveAssignment).not.toHaveBeenCalled();
  });

  test('exclusion and unsupported context do not enroll or break ordinary flag evaluation', async () => {
    const saveSegmentDiagnostic = vi.fn();
    const deps = dependencies({
      findRunningRun: vi.fn().mockResolvedValue({
        ...experimentRun,
        exclusionSegmentSnapshot: {
          type: 'segment',
          parameters: { filters: [{ name: 'internal', operator: 't', value: '' }] },
        },
      }),
      saveSegmentDiagnostic,
    });

    const excluded = await evaluateExperimentFeatureFlags(
      {
        websiteId: WEBSITE_ID,
        definitions: [flag],
        assignmentKey: TAB_KEY,
        context: { internal: true },
      },
      deps as any,
    );
    expect(excluded.flags['checkout-layout']).toEqual({ enabled: true, value: 'control' });
    expect(excluded.experiments['checkout-layout']).toEqual({
      resolved: false,
      diagnostic: 'excluded-segment',
    });
    expect(saveSegmentDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'segment-exclusion' }),
    );

    const missingContext = await evaluateExperimentFeatureFlags(
      { websiteId: WEBSITE_ID, definitions: [flag], assignmentKey: TAB_KEY },
      deps as any,
    );
    expect(missingContext.flags['checkout-layout']).toEqual({ enabled: true, value: 'control' });
    expect(missingContext.experiments['checkout-layout']).toEqual({
      resolved: false,
      diagnostic: 'unsupported-segment',
    });
  });
});
