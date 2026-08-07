import crypto from 'node:crypto';
import { decrypt, encrypt, secret } from '@/lib/crypto';
import { isExperimentVisitorDigest } from './identity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_KEY_PATTERN = UUID_PATTERN;
const REFERENCE_PREFIX = 'e1_';

export interface ExposureAssignmentReference {
  websiteId: string;
  experimentRunId: string;
  featureFlagKey: string;
  variation: number;
  unitType: 'session' | 'visitor';
  unitKey: string;
}

function validReference(value: ExposureAssignmentReference) {
  return (
    UUID_PATTERN.test(value.websiteId) &&
    UUID_PATTERN.test(value.experimentRunId) &&
    typeof value.featureFlagKey === 'string' &&
    value.featureFlagKey.length > 0 &&
    value.featureFlagKey.length <= 200 &&
    Number.isInteger(value.variation) &&
    value.variation >= 0 &&
    (value.unitType === 'session' || value.unitType === 'visitor') &&
    (value.unitType === 'session'
      ? SESSION_KEY_PATTERN.test(value.unitKey)
      : isExperimentVisitorDigest(value.unitKey))
  );
}

function base64Url(value: string) {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  return value.replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * Creates client-safe Experiment metadata. `assignment` is a stable opaque
 * fingerprint used only for SDK deduplication. `reference` is authenticated,
 * encrypted server state carried inside the later idempotency key. This is the
 * bridge back to an anonymous persisted assignment without exposing or sending
 * a raw identity, Run ID, session ID, or visitor digest as a payload field.
 */
export function createExposureAssignmentMetadata(input: ExposureAssignmentReference) {
  const reference: ExposureAssignmentReference = {
    websiteId: input.websiteId,
    experimentRunId: input.experimentRunId,
    featureFlagKey: input.featureFlagKey,
    variation: input.variation,
    unitType: input.unitType,
    unitKey: input.unitKey,
  };

  if (!validReference(reference)) {
    throw new Error('Invalid Exposure assignment reference.');
  }

  const serialized = JSON.stringify(reference);
  const assignment = crypto
    .createHmac('sha256', secret())
    .update('umami.experiment.exposure-assignment\0')
    .update(serialized)
    .digest('base64url');
  const encrypted = base64Url(encrypt(serialized, secret()));

  return { assignment: `a1_${assignment}`, reference: `${REFERENCE_PREFIX}${encrypted}` };
}

export function parseExposureAssignmentReference(
  value: string,
): ExposureAssignmentReference | null {
  if (typeof value !== 'string' || !value.startsWith(REFERENCE_PREFIX) || value.length > 2048) {
    return null;
  }

  try {
    const serialized = decrypt(fromBase64Url(value.slice(REFERENCE_PREFIX.length)), secret());
    const reference = JSON.parse(serialized) as ExposureAssignmentReference;
    return validReference(reference) ? reference : null;
  } catch {
    return null;
  }
}

export function getExposureReferenceFromIdempotencyKey(value: string) {
  const separator = value.lastIndexOf('.');
  if (separator < 0 || !UUID_PATTERN.test(value.slice(separator + 1))) {
    return null;
  }
  return parseExposureAssignmentReference(value.slice(0, separator));
}
