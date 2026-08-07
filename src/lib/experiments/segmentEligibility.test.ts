import { describe, expect, test } from 'vitest';
import {
  evaluateRealtimeSegmentSnapshot,
  validateRealtimeSegmentSnapshot,
} from './segmentEligibility';

function snapshot(filters: { name: string; operator: string; value: string }[], match = 'all') {
  return { type: 'segment', parameters: { filters, match } };
}

describe('real-time frozen Segment eligibility', () => {
  test('matches all filters and rejects a nonmatching audience', () => {
    const audience = snapshot([
      { name: 'country', operator: 'eq', value: 'US' },
      { name: 'path', operator: 'c', value: 'pricing' },
    ]);

    expect(
      evaluateRealtimeSegmentSnapshot(audience, { country: 'US', path: '/PRICING/team' }),
    ).toEqual({ supported: true, matches: true });
    expect(
      evaluateRealtimeSegmentSnapshot(audience, { country: 'CA', path: '/pricing/team' }),
    ).toEqual({ supported: true, matches: false });
  });

  test('supports any matching while still requiring every referenced context field', () => {
    const audience = snapshot(
      [
        { name: 'country', operator: 'eq', value: 'US' },
        { name: 'browser', operator: 'eq', value: 'Firefox' },
      ],
      'any',
    );

    expect(
      evaluateRealtimeSegmentSnapshot(audience, { country: 'CA', browser: 'Firefox' }),
    ).toEqual({ supported: true, matches: true });
    expect(evaluateRealtimeSegmentSnapshot(audience, { country: 'US' })).toMatchObject({
      supported: false,
      reason: expect.stringContaining('browser'),
    });
  });

  test.each([
    ['gt', 11, '10', true],
    ['lt', 9, '10', true],
    ['gte', 10, '10', true],
    ['lte', 10, '10', true],
    ['neq', 'free', 'pro', true],
    ['dnc', 'free plan', 'enterprise', true],
    ['re', 'Customer-42', '^customer-\\d+$', true],
    ['nre', 'Customer', '^internal', true],
  ])('evaluates %s safely', (operator, actual, expected, matches) => {
    expect(
      evaluateRealtimeSegmentSnapshot(snapshot([{ name: 'value', operator, value: expected }]), {
        value: actual,
      }),
    ).toEqual({ supported: true, matches });
  });

  test('invalid regex is unsupported and never throws', () => {
    const invalid = snapshot([{ name: 'path', operator: 're', value: '[' }]);

    expect(() => evaluateRealtimeSegmentSnapshot(invalid, { path: '/pricing' })).not.toThrow();
    expect(evaluateRealtimeSegmentSnapshot(invalid, { path: '/pricing' })).toMatchObject({
      supported: false,
      reason: expect.stringContaining('regular expression'),
    });
  });

  test('set and not-set are explicit while other operators require their context field', () => {
    expect(
      evaluateRealtimeSegmentSnapshot(snapshot([{ name: 'plan', operator: 'ns', value: '' }]), {}),
    ).toEqual({ supported: true, matches: true });
    expect(
      evaluateRealtimeSegmentSnapshot(
        snapshot([{ name: 'plan', operator: 'eq', value: 'pro' }]),
        {},
      ),
    ).toMatchObject({ supported: false });
    expect(
      evaluateRealtimeSegmentSnapshot(
        snapshot([{ name: 'plan', operator: 'eq', value: 'pro' }]),
        undefined,
      ),
    ).toMatchObject({ supported: false });
  });

  test.each([
    { type: 'cohort', parameters: { filters: [] } },
    {
      type: 'segment',
      parameters: {
        filters: [{ name: 'country', operator: 'eq', value: 'US' }],
        dateRange: '30day',
      },
    },
    {
      type: 'segment',
      parameters: {
        filters: [{ name: 'country', operator: 'eq', value: 'US' }],
        action: { type: 'path', value: '/pricing' },
      },
    },
  ])('rejects unsupported cohort/history predicates at validation', unsupported => {
    expect(validateRealtimeSegmentSnapshot(unsupported)).toMatchObject({ supported: false });
  });
});
