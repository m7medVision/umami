import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ insert: vi.fn(), rawQuery: vi.fn() }));
vi.mock('@/lib/clickhouse', () => ({
  default: {
    insert: mocks.insert,
    rawQuery: mocks.rawQuery,
    getUTCString: (date: Date) => date.toISOString().slice(0, 19).replace('T', ' '),
  },
}));
vi.mock('@/lib/crypto', () => ({ uuid: vi.fn(() => 'fact-id') }));
vi.mock('./privacy', () => ({
  isExperimentSessionAssignmentTombstoned: vi.fn().mockResolvedValue(false),
  isExperimentVisitorTombstoned: vi.fn().mockResolvedValue(false),
}));

import { bindAnonymousExperimentAssignment, getMutualExclusionAssignment } from './assignment';

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_KEY = '33333333-3333-4333-8333-333333333333';
const VISITOR_DIGEST = `k1.i1:${'a'.repeat(64)}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue(undefined);
  mocks.rawQuery.mockResolvedValue([{ variation: 1, assignmentCount: 1 }]);
});

test('mutual exclusion considers only currently active Runs', async () => {
  const activeRunId = '44444444-4444-4444-8444-444444444444';

  await getMutualExclusionAssignment({
    websiteId: WEBSITE_ID,
    mutualExclusionGroupId: '55555555-5555-4555-8555-555555555555',
    activeExperimentRunIds: [activeRunId],
    unitType: 'session',
    unitKey: SESSION_KEY,
  });

  expect(mocks.rawQuery).toHaveBeenCalledWith(
    expect.stringContaining('experiment_run_id in {activeExperimentRunIds:Array(UUID)}'),
    expect.objectContaining({ activeExperimentRunIds: [activeRunId] }),
    expect.any(String),
    expect.any(Array),
  );

  mocks.rawQuery.mockClear();
  await expect(
    getMutualExclusionAssignment({
      websiteId: WEBSITE_ID,
      mutualExclusionGroupId: '55555555-5555-4555-8555-555555555555',
      activeExperimentRunIds: [],
      unitType: 'session',
      unitKey: SESSION_KEY,
    }),
  ).resolves.toBeNull();
  expect(mocks.rawQuery).not.toHaveBeenCalled();
});

test('binding persists a digest-only anonymous Session continuity fact', async () => {
  await expect(
    bindAnonymousExperimentAssignment({
      websiteId: WEBSITE_ID,
      experimentRunId: RUN_ID,
      mutualExclusionGroupId: null,
      sessionAssignmentKey: SESSION_KEY,
      visitorDigest: VISITOR_DIGEST,
      assignedAt: new Date('2026-01-01T00:00:00Z'),
    }),
  ).resolves.toMatchObject({ variation: 1, unitType: 'visitor' });

  expect(mocks.insert).toHaveBeenCalledWith('experiment_assignment_binding', [
    expect.objectContaining({
      website_id: WEBSITE_ID,
      experiment_run_id: RUN_ID,
      session_assignment_key: SESSION_KEY,
      visitor_digest: VISITOR_DIGEST,
    }),
  ]);
  const binding = mocks.insert.mock.calls.find(call => call[0] === 'experiment_assignment_binding');
  expect(binding).toBeTruthy();
  expect(JSON.stringify(binding)).not.toContain('customer');
});
