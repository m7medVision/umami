import { beforeEach, expect, test, vi } from 'vitest';
import { aggregateExperimentOutcome, getExperimentExposureAggregates } from './results';

const mocks = vi.hoisted(() => ({ command: vi.fn(), rawQuery: vi.fn() }));
vi.mock('@/lib/clickhouse', () => ({
  default: {
    enabled: true,
    command: mocks.command,
    rawQuery: mocks.rawQuery,
    getUTCString: (date: Date) => date.toISOString().slice(0, 19).replace('T', ' '),
  },
}));

beforeEach(() => {
  mocks.command.mockReset().mockResolvedValue(undefined);
  mocks.rawQuery.mockReset().mockResolvedValue([]);
});

const base = {
  websiteId: '11111111-1111-4111-8111-111111111111',
  experimentRunId: '22222222-2222-4222-8222-222222222222',
  sourceDataThroughAt: new Date('2026-01-10T00:00:00Z'),
  computedAt: new Date('2026-01-10T00:01:00Z'),
};

test.each([
  ['pageview', 'count', 'count'],
  ['visit', 'count', 'count'],
  ['revenue', 'revenue', 'sum'],
  ['session-duration', 'duration', 'sum'],
] as const)(
  'builds parameterized standard %s attribution',
  async (sourceValue, type, countingMode) => {
    await aggregateExperimentOutcome({
      ...base,
      outcome: {
        id: '33333333-3333-4333-8333-333333333333',
        type,
        sourceType: 'standard',
        sourceValue,
        countingMode,
        attributionScope: 'both',
        visitorWindowDays: 14,
        currency: sourceValue === 'revenue' ? 'USD' : null,
      },
    });
    expect(mocks.command).toHaveBeenCalledTimes(2);
    const [sql, params] = mocks.command.mock.calls[0];
    expect(sql).toContain('s.occurred_at > f.first_exposure_at');
    expect(sql).toContain('{websiteId:UUID}');
    expect(sql).not.toContain(base.websiteId);
    expect(params).toMatchObject({ websiteId: base.websiteId, visitorWindowDays: 14 });
  },
);

test('Session view includes identified visitor-assigned exposures while Visitor remains identified-only', async () => {
  await aggregateExperimentOutcome({
    ...base,
    outcome: {
      id: '33333333-3333-4333-8333-333333333333',
      type: 'conversion',
      sourceType: 'event',
      sourceValue: 'purchase',
      countingMode: 'unique',
      attributionScope: 'both',
      visitorWindowDays: 14,
    },
  });

  const sessionSql = mocks.command.mock.calls[0][0];
  const visitorSql = mocks.command.mock.calls[1][0];
  expect(sessionSql).toContain("e.unit_type in ('session', 'visitor')");
  expect(sessionSql).toContain('toString(e.session_id)');
  expect(visitorSql).toContain("e.visitor_unit_key != ''");
  expect(visitorSql).toContain('inner join session_link as origin final');
  expect(visitorSql).toContain('experiment_assignment_binding');
  expect(visitorSql).toContain("e.unit_type = 'session'");
  expect(visitorSql).toContain('visitor_first_assignments');
  expect(visitorSql).toContain('argMin(variation, tuple(assigned_at, assignment_id))');

  await getExperimentExposureAggregates(base.websiteId, base.experimentRunId);
  const aggregateSql = mocks.rawQuery.mock.calls.at(-1)[0];
  expect(aggregateSql).toContain("select 'session' scope, toString(session_id)");
  expect(aggregateSql).toContain("select 'visitor' scope, visitor_unit_key unit_key");
  expect(aggregateSql).toContain("where visitor_unit_key != ''");
  expect(aggregateSql).toContain('experiment_assignment_binding');
});

test('session duration starts at Exposure and never includes pre-Exposure events', async () => {
  await aggregateExperimentOutcome({
    ...base,
    outcome: {
      id: '33333333-3333-4333-8333-333333333333',
      type: 'duration',
      sourceType: 'standard',
      sourceValue: 'session-duration',
      countingMode: 'sum',
      attributionScope: 'session',
      visitorWindowDays: 14,
    },
  });

  const sql = mocks.command.mock.calls[0][0];
  expect(sql).toContain('if(es.session_id = f.first_session_id, f.first_exposure_at');
  expect(sql).toContain('max(s.occurred_at)');
  expect(sql).toContain('where s.occurred_at > f.first_exposure_at');
  expect(sql).not.toContain("dateDiff('millisecond', min(created_at), max(created_at))");
});

test('uses actual numeric event_data field and exact Visitor window', async () => {
  await aggregateExperimentOutcome({
    ...base,
    outcome: {
      id: '33333333-3333-4333-8333-333333333333',
      type: 'value',
      sourceType: 'event',
      sourceValue: 'purchase',
      numericField: 'quantity',
      countingMode: 'sum',
      attributionScope: 'visitor',
      visitorWindowDays: 30,
    },
  });
  const [sql, params] = mocks.command.mock.calls[0];
  expect(sql).toContain('ed.number_value');
  expect(sql).toContain('addDays(f.first_exposure_at, {visitorWindowDays:UInt8})');
  expect(params).toMatchObject({ sourceValue: 'purchase', numericField: 'quantity' });
});
