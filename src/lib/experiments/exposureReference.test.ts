import { describe, expect, test } from 'vitest';
import {
  createExposureAssignmentMetadata,
  getExposureReferenceFromIdempotencyKey,
} from './exposureReference';

const reference = {
  websiteId: '11111111-1111-4111-8111-111111111111',
  experimentRunId: '22222222-2222-4222-8222-222222222222',
  featureFlagKey: 'checkout-layout',
  variation: 1,
  unitType: 'session' as const,
  unitKey: '33333333-3333-4333-8333-333333333333',
};

describe('Exposure assignment metadata', () => {
  test('is opaque to the client and recovers authenticated server assignment state', () => {
    const metadata = createExposureAssignmentMetadata(reference);
    const serialized = JSON.stringify(metadata);

    expect(serialized).not.toContain(reference.experimentRunId);
    expect(serialized).not.toContain(reference.unitKey);
    expect(
      getExposureReferenceFromIdempotencyKey(
        `${metadata.reference}.44444444-4444-4444-8444-444444444444`,
      ),
    ).toEqual(reference);
  });

  test('rejects tampered and malformed idempotency keys', () => {
    const metadata = createExposureAssignmentMetadata(reference);
    const tampered = metadata.reference.replace(/.$/, value => (value === 'a' ? 'b' : 'a'));

    expect(
      getExposureReferenceFromIdempotencyKey(`${tampered}.44444444-4444-4444-8444-444444444444`),
    ).toBeNull();
    expect(getExposureReferenceFromIdempotencyKey('not-an-idempotency-key')).toBeNull();
  });
});
