import { describe, expect, test } from 'vitest';
import {
  createExperimentVisitorDigest,
  EXPERIMENT_IDENTITY_ERA,
  EXPERIMENT_IDENTITY_KEY_VERSION,
  isExperimentVisitorDigest,
  safeEqualExperimentVisitorDigest,
} from './identity';

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';
const TEST_KEY = 'identity-test-key-not-used-in-production';

describe('createExperimentVisitorDigest', () => {
  test('is deterministic against a known HMAC-SHA256 vector and carries its versions', () => {
    const digest = createExperimentVisitorDigest(WEBSITE_ID, 'visitor@example.com', {
      key: TEST_KEY,
    });

    expect(digest).toBe('k1.i1:538e9cb00303ef0b1276e4da3eb283aa5d8103a224034055dc5eab52d9423366');
    expect(
      digest.startsWith(`${EXPERIMENT_IDENTITY_KEY_VERSION}.${EXPERIMENT_IDENTITY_ERA}:`),
    ).toBe(true);
    expect(digest).not.toContain('visitor@example.com');
  });

  test('domain-separates websites, identity eras, key versions, and ambiguous field boundaries', () => {
    const base = createExperimentVisitorDigest(WEBSITE_ID, 'visitor', { key: TEST_KEY });

    expect(
      createExperimentVisitorDigest('22222222-2222-4222-8222-222222222222', 'visitor', {
        key: TEST_KEY,
      }),
    ).not.toBe(base);
    expect(
      createExperimentVisitorDigest(WEBSITE_ID, 'visitor', {
        key: TEST_KEY,
        identityEra: 'i2',
      }),
    ).not.toBe(base);
    expect(
      createExperimentVisitorDigest(WEBSITE_ID, 'visitor', {
        key: TEST_KEY,
        keyVersion: 'k2',
      }),
    ).not.toBe(base);

    const first = createExperimentVisitorDigest(WEBSITE_ID, 'ab\u0000c', { key: TEST_KEY });
    const second = createExperimentVisitorDigest(WEBSITE_ID, 'a\u0000bc', { key: TEST_KEY });
    expect(first).not.toBe(second);
  });

  test('rejects missing or invalid identifiers', () => {
    expect(() => createExperimentVisitorDigest('', 'visitor', { key: TEST_KEY })).toThrow();
    expect(() =>
      createExperimentVisitorDigest('not-a-uuid', 'visitor', { key: TEST_KEY }),
    ).toThrow();
    expect(() => createExperimentVisitorDigest(WEBSITE_ID, '', { key: TEST_KEY })).toThrow();
    expect(() => createExperimentVisitorDigest(WEBSITE_ID, 'visitor', { key: '' })).toThrow();
  });
});

describe('experiment visitor digest comparison', () => {
  test('validates the versioned representation and compares equal digests safely', () => {
    const digest = createExperimentVisitorDigest(WEBSITE_ID, 'visitor', { key: TEST_KEY });

    expect(isExperimentVisitorDigest(digest)).toBe(true);
    expect(isExperimentVisitorDigest('visitor')).toBe(false);
    expect(isExperimentVisitorDigest(`${EXPERIMENT_IDENTITY_KEY_VERSION}.i1:abc`)).toBe(false);
    expect(safeEqualExperimentVisitorDigest(digest, digest)).toBe(true);
    expect(
      safeEqualExperimentVisitorDigest(
        digest,
        createExperimentVisitorDigest(WEBSITE_ID, 'another-visitor', { key: TEST_KEY }),
      ),
    ).toBe(false);
    expect(safeEqualExperimentVisitorDigest(digest, 'malformed')).toBe(false);
  });
});
