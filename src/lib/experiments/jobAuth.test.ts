import { afterEach, describe, expect, test, vi } from 'vitest';
import { isExperimentJobRequestAuthorized } from './jobAuth';

afterEach(() => vi.unstubAllEnvs());

describe('Experiment job authentication', () => {
  test('fails closed when the dedicated secret is missing', () => {
    vi.stubEnv('EXPERIMENT_JOBS_SECRET', '');
    expect(
      isExperimentJobRequestAuthorized(
        new Request('http://localhost/api/jobs/experiments', {
          headers: { authorization: 'Bearer anything' },
        }),
      ),
    ).toBe(false);
  });

  test('accepts only the exact secret from bearer or dedicated header', () => {
    vi.stubEnv('EXPERIMENT_JOBS_SECRET', 'jobs-secret-with-enough-entropy');
    expect(
      isExperimentJobRequestAuthorized(
        new Request('http://localhost', {
          headers: { authorization: 'Bearer jobs-secret-with-enough-entropy' },
        }),
      ),
    ).toBe(true);
    expect(
      isExperimentJobRequestAuthorized(
        new Request('http://localhost', {
          headers: { 'x-experiment-jobs-secret': 'jobs-secret-with-enough-entropy' },
        }),
      ),
    ).toBe(true);
    expect(
      isExperimentJobRequestAuthorized(
        new Request('http://localhost', { headers: { authorization: 'Bearer wrong' } }),
      ),
    ).toBe(false);
  });
});
