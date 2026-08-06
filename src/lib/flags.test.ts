import { describe, expect, test } from 'vitest';
import { evaluateFlag, fnv1a32, getFeatureFlagBucket } from './flags';

describe('fnv1a32', () => {
  test.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('matches the FNV-1a reference vector for %j', (value, expected) => {
    expect(fnv1a32(value)).toBe(expected);
  });
});

describe('getFeatureFlagBucket', () => {
  test.each([
    ['charlie', 0.0847],
    ['user-6', 0.1417],
    ['alice', 0.9919],
  ])('maps checkout-layout and %s to a stable bucket', (userKey, expected) => {
    expect(getFeatureFlagBucket('checkout-layout', userKey)).toBe(expected);
  });
});

describe('evaluateFlag', () => {
  test('returns the Fallthrough variation when the flag is disabled', () => {
    const flag = {
      key: 'checkout-layout',
      enabled: false,
      variations: [{ value: 'control' }, { value: 'compact' }],
      rollout: { percentage: 100, weights: [0.5, 0.5] },
      defaultVariation: 0,
    };

    expect(evaluateFlag(flag, 'user-123')).toEqual({
      value: 'control',
      reason: 'disabled',
    });
  });

  test('returns the Fallthrough variation when no user key is available', () => {
    const flag = {
      key: 'checkout-layout',
      enabled: true,
      variations: [{ value: 'control' }, { value: 'compact' }],
      rollout: { percentage: 100, weights: [0.5, 0.5] },
      defaultVariation: 0,
    };

    expect(evaluateFlag(flag)).toEqual({ value: 'control', reason: 'no-key' });
  });

  test('returns the Fallthrough variation outside the rollout', () => {
    const flag = {
      key: 'checkout-layout',
      enabled: true,
      variations: [{ value: 'control' }, { value: 'compact' }],
      rollout: { percentage: 25, weights: [0.5, 0.5] },
      defaultVariation: 0,
    };

    expect(evaluateFlag(flag, 'alice')).toEqual({
      value: 'control',
      reason: 'outside-rollout',
    });
  });

  test.each([
    ['charlie', 'control', 'variation-0'],
    ['user-6', 'compact', 'variation-1'],
  ])('selects the weighted variation for %s', (userKey, value, reason) => {
    const flag = {
      key: 'checkout-layout',
      enabled: true,
      variations: [{ value: 'control' }, { value: 'compact' }],
      rollout: { percentage: 25, weights: [0.5, 0.5] },
      defaultVariation: 0,
    };

    expect(evaluateFlag(flag, userKey)).toEqual({ value, reason });
  });
});
