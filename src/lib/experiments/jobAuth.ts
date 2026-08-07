import crypto from 'node:crypto';

function constantTimeEqual(left: string, right: string) {
  const leftDigest = crypto.createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(right, 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export function isExperimentJobRequestAuthorized(request: Request) {
  const expected = process.env.EXPERIMENT_JOBS_SECRET;
  if (!expected) return false;

  const authorization = request.headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const provided = bearer ?? request.headers.get('x-experiment-jobs-secret');
  return !!provided && constantTimeEqual(provided, expected);
}
