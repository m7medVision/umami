import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), enabled: true }));
vi.mock('@/lib/clickhouse', () => ({
  default: {
    get enabled() {
      return mocks.enabled;
    },
    command: mocks.command,
  },
}));

import {
  deleteWebsiteExperimentData,
  purgeExperimentRunRawData,
  resetWebsiteExperimentData,
} from './cleanup';

beforeEach(() => {
  mocks.enabled = true;
  mocks.command.mockReset().mockResolvedValue(undefined);
});

describe('Experiment ClickHouse cleanup', () => {
  test('Run retention removes all reconstructable raw facts', async () => {
    await purgeExperimentRunRawData('11111111-1111-4111-8111-111111111111');
    expect(mocks.command).toHaveBeenCalledTimes(5);
    expect(mocks.command.mock.calls.map(call => call[0]).join('\n')).toContain(
      'experiment_run_id = {experimentRunId:UUID}',
    );
  });

  test('Website reset preserves tombstones while deletion removes them', async () => {
    await resetWebsiteExperimentData('11111111-1111-4111-8111-111111111111');
    expect(mocks.command).toHaveBeenCalledTimes(5);
    expect(mocks.command.mock.calls.map(call => call[0]).join('\n')).not.toContain(
      'experiment_privacy_tombstone',
    );

    mocks.command.mockClear();
    await deleteWebsiteExperimentData('11111111-1111-4111-8111-111111111111');
    expect(mocks.command).toHaveBeenCalledTimes(6);
    expect(mocks.command.mock.calls.map(call => call[0]).join('\n')).toContain(
      'experiment_privacy_tombstone',
    );
  });

  test('a deployment without ClickHouse skips cleanup explicitly', async () => {
    mocks.enabled = false;
    await expect(
      purgeExperimentRunRawData('11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual({ skipped: true });
    expect(mocks.command).not.toHaveBeenCalled();
  });
});
