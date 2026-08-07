import { describe, expect, test } from 'vitest';
import {
  ACTIVE_EXPERIMENT_RUN_STATUSES,
  calculateActiveRuntimeMs,
  EXPERIMENT_RUN_STATUSES,
  freezeExperimentRun,
  validateExperimentRunDraft,
} from './index';

function validDraft() {
  return {
    featureFlag: {
      key: 'checkout-layout',
      valueType: 'string',
      variations: [{ value: 'control' }, { value: 'compact' }],
      rollout: { percentage: 100, weights: [0.5, 0.5] },
      fallthroughVariation: 1,
    },
    baselineVariation: 0,
    outcomes: [
      {
        name: 'Signup',
        type: 'conversion',
        source: { type: 'event', eventName: 'signup' },
        countingMode: 'unique',
        attributionScope: 'both',
        desiredDirection: 'increase',
        role: 'primary',
      },
    ],
  };
}

function expectInvalid(draft: unknown) {
  expect(validateExperimentRunDraft(draft).success).toBe(false);
}

describe('validateExperimentRunDraft', () => {
  test('applies the fixed v1 assignment, attribution, statistics, and safeguard defaults', () => {
    const result = validateExperimentRunDraft(validDraft());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toMatchObject({
      assignmentPolicy: { identified: 'visitor', anonymous: 'session' },
      statisticsVersion: 'bayesian-v1',
      bucketingVersion: 'fnv1a32-v1',
      statisticalModel: {
        conversion: { model: 'beta-binomial', alpha: 1, beta: 1 },
        count: { model: 'gamma-poisson', shape: 1, rate: 1 },
        continuous: { model: 'bayesian-bootstrap' },
      },
      safeguards: {
        minimumSampleSizePerVariation: 100,
        minimumActiveDays: 7,
        probabilityToWinThreshold: 0.95,
        expectedLossThreshold: 0.01,
        sampleRatioMismatchAlpha: 0.01,
      },
      audienceSegment: null,
      exclusionSegment: null,
    });
    expect(result.data.outcomes[0].visitorWindowDays).toBe(14);
  });

  test.each([2, 10])('accepts %i Variations', count => {
    const draft = validDraft();
    draft.featureFlag.variations = Array.from({ length: count }, (_, index) => ({
      value: `variation-${index}`,
    }));
    draft.featureFlag.rollout.weights = Array.from({ length: count }, () => 1 / count);

    expect(validateExperimentRunDraft(draft).success).toBe(true);
  });

  test.each([1, 11])('rejects %i Variations', count => {
    const draft = validDraft();
    draft.featureFlag.variations = Array.from({ length: count }, (_, index) => ({
      value: `variation-${index}`,
    }));
    draft.featureFlag.rollout.weights = Array.from({ length: count }, () => 1 / count);

    expectInvalid(draft);
  });

  test('requires one positive weight per Variation and weights that sum to one', () => {
    const missingWeight = validDraft();
    missingWeight.featureFlag.rollout.weights = [1];
    expectInvalid(missingWeight);

    const zeroWeight = validDraft();
    zeroWeight.featureFlag.rollout.weights = [1, 0];
    expectInvalid(zeroWeight);

    const invalidTotal = validDraft();
    invalidTotal.featureFlag.rollout.weights = [0.7, 0.4];
    expectInvalid(invalidTotal);
  });

  test.each([
    ['boolean', false, true],
    ['string', 'control', 'compact'],
    ['number', 1, 2],
    ['json', { layout: 'control' }, { layout: 'compact' }],
  ])('reuses the %s Feature Flag Variation value contract', (valueType, baseline, treatment) => {
    const draft = validDraft();
    const featureFlag = draft.featureFlag as {
      valueType: string;
      variations: { value: unknown }[];
    };
    featureFlag.valueType = valueType;
    featureFlag.variations = [{ value: baseline }, { value: treatment }];

    expect(validateExperimentRunDraft(draft).success).toBe(true);
  });

  test('requires Variation values to match the Feature Flag value type', () => {
    const draft = validDraft();
    draft.featureFlag.variations[1].value = 42 as never;

    expectInvalid(draft);
  });

  test('requires exactly one existing Baseline Variation', () => {
    const absent = validDraft() as ReturnType<typeof validDraft> & {
      baselineVariation?: number;
    };
    delete absent.baselineVariation;
    expectInvalid(absent);

    expectInvalid({ ...validDraft(), baselineVariation: 2 });
    expectInvalid({ ...validDraft(), baselineVariation: -1 });
  });

  test('allows Baseline and Feature Flag Fallthrough to be the same or different', () => {
    const distinct = validateExperimentRunDraft(validDraft());
    expect(distinct.success).toBe(true);

    const equal = validateExperimentRunDraft({ ...validDraft(), baselineVariation: 1 });
    expect(equal.success).toBe(true);
    if (!equal.success) return;
    expect(equal.data.baselineVariation).toBe(1);
    expect(equal.data.featureFlag.fallthroughVariation).toBe(1);
  });

  test('requires exactly one Primary Outcome', () => {
    expectInvalid({ ...validDraft(), outcomes: [] });

    const draft = validDraft();
    draft.outcomes.push({ ...draft.outcomes[0], name: 'Purchase' });
    expectInvalid(draft);
  });

  test('allows at most ten Secondary Outcomes', () => {
    const ten = validDraft();
    ten.outcomes.push(
      ...Array.from({ length: 10 }, (_, index) => ({
        ...ten.outcomes[0],
        name: `Secondary ${index}`,
        role: 'secondary',
      })),
    );
    expect(validateExperimentRunDraft(ten).success).toBe(true);

    const eleven = validDraft();
    eleven.outcomes.push(
      ...Array.from({ length: 11 }, (_, index) => ({
        ...eleven.outcomes[0],
        name: `Secondary ${index}`,
        role: 'secondary',
      })),
    );
    expectInvalid(eleven);
  });

  test.each([
    {
      name: 'conversion',
      type: 'conversion',
      source: { type: 'standard', metric: 'pageview' },
      countingMode: 'unique',
    },
    {
      name: 'count',
      type: 'count',
      source: { type: 'event', eventName: 'add-to-cart' },
      countingMode: 'count',
    },
    {
      name: 'value',
      type: 'value',
      source: { type: 'event', eventName: 'quote', numericField: 'amount' },
      countingMode: 'sum',
    },
    {
      name: 'revenue',
      type: 'revenue',
      source: { type: 'event', eventName: 'purchase' },
      countingMode: 'sum',
      currency: 'USD',
    },
    {
      name: 'duration',
      type: 'duration',
      source: { type: 'standard', metric: 'session-duration' },
      countingMode: 'sum',
      desiredDirection: 'decrease',
    },
  ])('accepts the $name Outcome family', outcome => {
    const draft = validDraft();
    draft.outcomes = [
      {
        attributionScope: 'both',
        desiredDirection: 'increase',
        role: 'primary',
        ...outcome,
      } as (typeof draft.outcomes)[number],
    ];

    expect(validateExperimentRunDraft(draft).success).toBe(true);
  });

  test.each([
    ['conversion', 'count'],
    ['count', 'unique'],
    ['value', 'count'],
    ['revenue', 'unique'],
    ['duration', 'count'],
  ])('rejects %s with the %s counting mode', (type, countingMode) => {
    const draft = validDraft();
    draft.outcomes[0] = {
      ...draft.outcomes[0],
      type,
      countingMode,
      source:
        type === 'value'
          ? { type: 'event', eventName: 'quote', numericField: 'amount' }
          : { type: 'event', eventName: 'outcome' },
      ...(type === 'revenue' ? { currency: 'USD' } : {}),
    } as (typeof draft.outcomes)[number];

    expectInvalid(draft);
  });

  test('requires an event numeric field for a Value Outcome', () => {
    const draft = validDraft();
    draft.outcomes[0] = {
      ...draft.outcomes[0],
      type: 'value',
      countingMode: 'sum',
      source: { type: 'event', eventName: 'quote' },
    } as (typeof draft.outcomes)[number];

    expectInvalid(draft);
  });

  test('requires one uppercase ISO currency for Revenue and forbids it otherwise', () => {
    const revenue = validDraft();
    revenue.outcomes[0] = {
      ...revenue.outcomes[0],
      type: 'revenue',
      countingMode: 'sum',
      source: { type: 'event', eventName: 'purchase' },
    } as (typeof revenue.outcomes)[number];
    expectInvalid(revenue);

    revenue.outcomes[0] = {
      ...revenue.outcomes[0],
      currency: 'usd',
    } as (typeof revenue.outcomes)[number];
    expectInvalid(revenue);

    revenue.outcomes[0] = {
      ...revenue.outcomes[0],
      currency: 'ZZZ',
    } as (typeof revenue.outcomes)[number];
    expectInvalid(revenue);

    const conversion = validDraft();
    conversion.outcomes[0] = {
      ...conversion.outcomes[0],
      currency: 'USD',
    } as (typeof conversion.outcomes)[number];
    expectInvalid(conversion);
  });

  test('rejects unknown Outcome types, sources, scopes, and directions', () => {
    for (const change of [
      { type: 'ratio' },
      { source: { type: 'database', table: 'orders' } },
      { attributionScope: 'account' },
      { desiredDirection: 'neutral' },
    ]) {
      const draft = validDraft();
      draft.outcomes[0] = { ...draft.outcomes[0], ...change } as (typeof draft.outcomes)[number];
      expectInvalid(draft);
    }
  });

  test.each([1, 30])('accepts a %i-day Visitor attribution window', visitorWindowDays => {
    const draft = validDraft();
    draft.outcomes[0] = {
      ...draft.outcomes[0],
      visitorWindowDays,
    } as (typeof draft.outcomes)[number];

    expect(validateExperimentRunDraft(draft).success).toBe(true);
  });

  test.each([0, 31, 1.5])('rejects a %s-day Visitor attribution window', visitorWindowDays => {
    const draft = validDraft();
    draft.outcomes[0] = {
      ...draft.outcomes[0],
      visitorWindowDays,
    } as (typeof draft.outcomes)[number];

    expectInvalid(draft);
  });

  test('rejects unsupported assignment, bucketing, statistics, and prior model versions', () => {
    expectInvalid({
      ...validDraft(),
      assignmentPolicy: { identified: 'session', anonymous: 'session' },
    });
    expectInvalid({ ...validDraft(), statisticsVersion: 'frequentist-v1' });
    expectInvalid({ ...validDraft(), bucketingVersion: 'random-v1' });
    expectInvalid({
      ...validDraft(),
      statisticalModel: {
        conversion: { model: 'beta-binomial', alpha: 2, beta: 1 },
        count: { model: 'gamma-poisson', shape: 1, rate: 1 },
        continuous: { model: 'bayesian-bootstrap' },
      },
    });
  });

  test('enforces sample, runtime, and readiness threshold ranges', () => {
    const invalidSafeguards = [
      { minimumSampleSizePerVariation: 0 },
      { minimumSampleSizePerVariation: 1_000_001 },
      { minimumActiveDays: 0 },
      { minimumActiveDays: 91 },
      { probabilityToWinThreshold: 0.49 },
      { probabilityToWinThreshold: 1 },
      { expectedLossThreshold: -1 },
      { sampleRatioMismatchAlpha: 0 },
      { sampleRatioMismatchAlpha: 0.11 },
    ];

    for (const safeguards of invalidSafeguards) {
      expectInvalid({ ...validDraft(), safeguards });
    }
  });

  test('accepts only serializable Audience and exclusion Segment snapshots', () => {
    const segment = {
      segmentId: '11111111-1111-4111-8111-111111111111',
      type: 'segment',
      name: 'Paid traffic',
      parameters: { match: 'all', filters: [{ name: 'utmSource', value: 'ads' }] },
    };
    const result = validateExperimentRunDraft({
      ...validDraft(),
      audienceSegment: segment,
      exclusionSegment: { ...segment, name: 'Internal traffic' },
    });
    expect(result.success).toBe(true);

    expectInvalid({
      ...validDraft(),
      audienceSegment: { ...segment, parameters: { createdAt: new Date() } },
    });
    expectInvalid({
      ...validDraft(),
      exclusionSegment: { ...segment, parameters: { missing: undefined } },
    });
  });
});

describe('freezeExperimentRun', () => {
  test('returns a deeply frozen copy without editable Experiment name or description', () => {
    const draft = {
      ...validDraft(),
      name: 'Editable name',
      description: 'Editable description',
    };
    const frozen = freezeExperimentRun(draft);

    draft.featureFlag.variations[0].value = 'mutated';
    draft.outcomes[0].name = 'Mutated outcome';

    expect(frozen.featureFlag.variations[0].value).toBe('control');
    expect(frozen.outcomes[0].name).toBe('Signup');
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.featureFlag.variations)).toBe(true);
    expect(frozen).not.toHaveProperty('name');
    expect(frozen).not.toHaveProperty('description');
  });

  test('rejects invalid configuration instead of freezing it', () => {
    expect(() => freezeExperimentRun({ ...validDraft(), baselineVariation: 9 })).toThrow();
  });
});

describe('calculateActiveRuntimeMs', () => {
  test('uses UTC instants across daylight-saving changes', () => {
    expect(
      calculateActiveRuntimeMs(
        {
          startedAt: new Date('2025-03-08T12:00:00-05:00'),
          accumulatedPausedDurationMs: 0,
        },
        new Date('2025-03-10T12:00:00-04:00'),
      ),
    ).toBe(47 * 60 * 60 * 1000);
  });

  test('subtracts accumulated and current paused time', () => {
    expect(
      calculateActiveRuntimeMs(
        {
          startedAt: new Date('2025-01-01T00:00:00Z'),
          pausedAt: new Date('2025-01-03T00:00:00Z'),
          accumulatedPausedDurationMs: 24 * 60 * 60 * 1000,
        },
        new Date('2025-01-05T00:00:00Z'),
      ),
    ).toBe(24 * 60 * 60 * 1000);
  });

  test('stops at completion and clamps missing or invalid intervals to zero', () => {
    expect(
      calculateActiveRuntimeMs(
        {
          startedAt: new Date('2025-01-01T00:00:00Z'),
          completedAt: new Date('2025-01-08T00:00:00Z'),
          accumulatedPausedDurationMs: 2 * 24 * 60 * 60 * 1000,
        },
        new Date('2025-02-01T00:00:00Z'),
      ),
    ).toBe(5 * 24 * 60 * 60 * 1000);

    expect(calculateActiveRuntimeMs({ startedAt: null, accumulatedPausedDurationMs: 0 })).toBe(0);
    expect(
      calculateActiveRuntimeMs({
        startedAt: new Date('2025-01-02T00:00:00Z'),
        completedAt: new Date('2025-01-01T00:00:00Z'),
        accumulatedPausedDurationMs: 0,
      }),
    ).toBe(0);
  });
});

describe('Experiment Run lifecycle vocabulary', () => {
  test('defines the complete lifecycle and active-capacity states', () => {
    expect(EXPERIMENT_RUN_STATUSES).toEqual([
      'Draft',
      'Running',
      'Paused',
      'Completed',
      'Finalized',
      'Archived',
    ]);
    expect(ACTIVE_EXPERIMENT_RUN_STATUSES).toEqual(['Running', 'Paused']);
  });
});
