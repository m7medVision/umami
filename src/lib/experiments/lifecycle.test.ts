import { describe, expect, test, vi } from 'vitest';
import {
  applyLifecycleAction,
  ExperimentLifecycleError,
  finalizeRun,
  getRunRemoval,
  validateRunStart,
} from './lifecycle';

const hour = 60 * 60 * 1000;
const now = new Date('2025-01-10T12:00:00Z');

function run(status = 'Draft') {
  return {
    status,
    startedAt: status === 'Draft' ? null : new Date('2025-01-01T00:00:00Z'),
    pausedAt: null,
    completedAt: null,
    provisionalUntil: null,
    finalizedAt: null,
    archivedAt: null,
    accumulatedPausedDurationMs: 0,
  };
}

describe('Experiment Run lifecycle', () => {
  test('allows only Draft→Running↔Paused→Completed→Finalized→Archived', () => {
    expect(applyLifecycleAction(run(), 'start', now)).toMatchObject({
      status: 'Running',
      startedAt: now,
    });
    expect(applyLifecycleAction(run('Running'), 'pause', now)).toMatchObject({
      status: 'Paused',
      pausedAt: now,
    });
    expect(() => applyLifecycleAction(run(), 'complete', now)).toThrow(ExperimentLifecycleError);
    expect(() => applyLifecycleAction(run('Finalized'), 'pause', now)).toThrow(
      ExperimentLifecycleError,
    );
  });

  test('accounts for every pause and creates a 24-hour provisional deadline', () => {
    const paused = {
      ...run('Paused'),
      pausedAt: new Date(now.getTime() - 3 * hour),
      accumulatedPausedDurationMs: 2 * hour,
    };
    const resumed = applyLifecycleAction(paused, 'resume', now);
    expect(resumed).toMatchObject({
      status: 'Running',
      pausedAt: null,
      accumulatedPausedDurationMs: 5 * hour,
    });

    const completed = applyLifecycleAction(paused, 'complete', now);
    expect(completed).toMatchObject({
      status: 'Completed',
      completedAt: now,
      provisionalUntil: new Date(now.getTime() + 24 * hour),
      accumulatedPausedDurationMs: 5 * hour,
    });
  });

  test('finalizes only after the deadline and only with a full-result computation', async () => {
    const completed = {
      ...run('Completed'),
      completedAt: new Date(now.getTime() - 25 * hour),
      provisionalUntil: new Date(now.getTime() - hour),
    };
    const computeFull = vi.fn().mockResolvedValue({
      results: { primary: [] },
      diagnostics: { srm: false },
      safeguardResults: { ready: false },
      sourceDataThroughAt: now,
      computedAt: now,
    });

    await expect(finalizeRun(completed, { computeFull }, now)).resolves.toMatchObject({
      run: { status: 'Finalized', finalizedAt: now },
      snapshot: { results: { primary: [] } },
    });
    expect(computeFull).toHaveBeenCalledOnce();

    await expect(
      finalizeRun(
        { ...completed, provisionalUntil: new Date(now.getTime() + hour) },
        { computeFull },
        now,
      ),
    ).rejects.toThrow('provisional');
  });

  test('enforces ownership, active capacity, and one active Run per flag and Experiment', () => {
    expect(() =>
      validateRunStart({
        websiteId: 'website-1',
        experimentWebsiteId: 'website-1',
        flagWebsiteId: 'website-1',
        segmentWebsiteIds: ['website-1'],
        groupWebsiteId: 'website-1',
        activeWebsiteRunCount: 19,
        hasActiveFlagRun: false,
        hasActiveExperimentRun: false,
      }),
    ).not.toThrow();

    for (const change of [
      { activeWebsiteRunCount: 20 },
      { hasActiveFlagRun: true },
      { hasActiveExperimentRun: true },
      { segmentWebsiteIds: ['another-website'] },
    ]) {
      expect(() =>
        validateRunStart({
          websiteId: 'website-1',
          experimentWebsiteId: 'website-1',
          flagWebsiteId: 'website-1',
          segmentWebsiteIds: [],
          groupWebsiteId: null,
          activeWebsiteRunCount: 0,
          hasActiveFlagRun: false,
          hasActiveExperimentRun: false,
          ...change,
        }),
      ).toThrow(ExperimentLifecycleError);
    }
  });

  test('hard-deletes only an empty Draft and archives only finalized history', () => {
    expect(getRunRemoval({ status: 'Draft', firstExposureAt: null })).toBe('delete');
    expect(getRunRemoval({ status: 'Finalized', firstExposureAt: now })).toBe('archive');
    expect(() => getRunRemoval({ status: 'Draft', firstExposureAt: now })).toThrow();
    expect(() => getRunRemoval({ status: 'Completed', firstExposureAt: now })).toThrow();
  });
});
