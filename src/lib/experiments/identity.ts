import crypto from 'node:crypto';

const IDENTITY_DOMAIN = 'umami.experiment.identity';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^[a-z0-9_-]{1,16}$/i;

export const EXPERIMENT_IDENTITY_KEY_VERSION = 'k1' as const;
export const EXPERIMENT_IDENTITY_ERA = 'i1' as const;

export interface ExperimentIdentityOptions {
  /** Injected only by tests or an explicit key-rotation caller. */
  key?: string;
  keyVersion?: string;
  identityEra?: string;
}

function encodeFields(fields: string[]) {
  const chunks: Buffer[] = [];

  for (const field of fields) {
    const bytes = Buffer.from(field, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }

  return Buffer.concat(chunks);
}

export function createExperimentVisitorDigest(
  websiteId: string,
  userKey: string,
  options: ExperimentIdentityOptions = {},
) {
  const keyVersion = options.keyVersion ?? EXPERIMENT_IDENTITY_KEY_VERSION;
  const identityEra = options.identityEra ?? EXPERIMENT_IDENTITY_ERA;
  const key = options.key === undefined ? process.env.APP_SECRET : options.key;

  if (!UUID_PATTERN.test(websiteId)) {
    throw new Error('A valid Website identifier is required.');
  }
  if (!userKey) {
    throw new Error('A user identity is required.');
  }
  if (!key) {
    throw new Error('An identity HMAC key is required.');
  }
  if (!VERSION_PATTERN.test(keyVersion) || !VERSION_PATTERN.test(identityEra)) {
    throw new Error('Identity versions must be explicit, bounded identifiers.');
  }

  const message = encodeFields([
    IDENTITY_DOMAIN,
    keyVersion,
    identityEra,
    websiteId.toLowerCase(),
    userKey,
  ]);
  const digest = crypto.createHmac('sha256', key).update(message).digest('hex');

  return `${keyVersion}.${identityEra}:${digest}`;
}

export function isExperimentVisitorDigest(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const separator = value.indexOf(':');
  if (separator < 0) {
    return false;
  }

  const versions = value.slice(0, separator).split('.');
  const digest = value.slice(separator + 1);

  return (
    versions.length === 2 &&
    versions.every(version => VERSION_PATTERN.test(version)) &&
    /^[0-9a-f]{64}$/.test(digest)
  );
}

export function safeEqualExperimentVisitorDigest(left: string, right: string) {
  if (!isExperimentVisitorDigest(left) || !isExperimentVisitorDigest(right)) {
    return false;
  }

  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');

  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}
