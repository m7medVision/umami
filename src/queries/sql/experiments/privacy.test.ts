import { beforeEach, describe, expect, test, vi } from 'vitest';

const VISITOR_DIGEST = `k1.i1:${'a'.repeat(64)}`;
const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  insert: vi.fn(),
  rawQuery: vi.fn(),
  saveDiagnostic: vi.fn(),
}));

vi.mock('@/lib/clickhouse', () => ({
  default: {
    command: mocks.command,
    insert: mocks.insert,
    rawQuery: mocks.rawQuery,
    getUTCString: (date: Date) => date.toISOString().slice(0, 19).replace('T', ' '),
  },
}));
vi.mock('@/lib/crypto', () => ({ uuid: vi.fn(() => 'tombstone-id') }));
vi.mock('@/lib/experiments/identity', () => ({
  createExperimentVisitorDigest: vi.fn(() => VISITOR_DIGEST),
  isExperimentVisitorDigest: vi.fn((value: string) => value === VISITOR_DIGEST),
}));
vi.mock('./diagnostic', () => ({ saveExperimentDiagnostic: mocks.saveDiagnostic }));

import { deleteExperimentVisitorData, isExperimentSessionAssignmentTombstoned } from './privacy';

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_KEY = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.command.mockResolvedValue(undefined);
  mocks.insert.mockResolvedValue(undefined);
  mocks.rawQuery.mockResolvedValue([{ tombstoneCount: 1 }]);
  mocks.saveDiagnostic.mockResolvedValue(undefined);
});

describe('Experiment bound-session privacy', () => {
  test('tombstone reads map the first anonymous assignment binding to its Visitor digest', async () => {
    await expect(
      isExperimentSessionAssignmentTombstoned(WEBSITE_ID, RUN_ID, SESSION_KEY),
    ).resolves.toBe(true);

    const [sql, params, _name, sensitive] = mocks.rawQuery.mock.calls[0];
    expect(sql).toContain('experiment_assignment_binding');
    expect(sql).toContain('argMin(visitor_digest, tuple(bound_at, binding_id))');
    expect(sql).toContain('experiment_privacy_tombstone as tombstone final');
    expect(params).toEqual({
      websiteId: WEBSITE_ID,
      experimentRunId: RUN_ID,
      sessionAssignmentKey: SESSION_KEY,
    });
    expect(sensitive).toContain('sessionAssignmentKey');
  });

  test('deletion removes Visitor and bound Session assignments, Exposures, and Outcome units', async () => {
    const rawUserKey = 'private-customer@example.test';
    await deleteExperimentVisitorData({ websiteId: WEBSITE_ID, userKey: rawUserKey });

    expect(mocks.insert).toHaveBeenCalledWith('experiment_privacy_tombstone', expect.any(Array));
    expect(mocks.command).toHaveBeenCalledTimes(4);
    const sql = mocks.command.mock.calls.map(call => call[0]).join('\n');
    expect(sql).toContain('alter table experiment_outcome_unit delete');
    expect(sql).toContain('alter table experiment_assignment delete');
    expect(sql).toContain('alter table experiment_exposure delete');
    expect(sql).toContain('alter table experiment_assignment_binding delete');
    expect(sql).toContain("unit_type = 'session'");
    expect(sql).toContain('session_assignment_key');
    expect(sql).toContain('toString(session_id)');
    expect(sql).toContain('mutations_sync = 1');
    expect(JSON.stringify(mocks.command.mock.calls)).not.toContain(rawUserKey);
  });
});
