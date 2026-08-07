import clickhouse from '@/lib/clickhouse';
import { EVENT_TYPE } from '@/lib/constants';
import {
  computeExperimentResults,
  type ExperimentCumulativeAggregate,
  type ExperimentDiagnosticAggregate,
  type ExperimentExposureAggregate,
  type ExperimentOutcomeRow,
  type ExperimentOutcomeUnitAggregate,
} from '@/lib/experiments/computeResults';
import type { ExperimentResultComputation } from '@/lib/experiments/runService';
import { clickhouseDateTime64, SENSITIVE_EXPERIMENT_PARAMS } from './utils';

const FUNCTION_NAME = 'experimentResults';

type Scope = 'session' | 'visitor';

type Outcome = {
  id: string;
  type: string;
  sourceType: string;
  sourceValue: string;
  numericField?: string | null;
  countingMode: string;
  attributionScope: string;
  visitorWindowDays: number;
  currency?: string | null;
};

function scopes(outcome: Outcome): Scope[] {
  if (outcome.attributionScope === 'both') return ['session', 'visitor'];
  if (outcome.attributionScope === 'session' || outcome.attributionScope === 'visitor') {
    return [outcome.attributionScope];
  }
  throw new Error(`Unsupported attribution scope: ${outcome.attributionScope}`);
}

function assertOutcome(outcome: Outcome) {
  if (!['unique', 'count', 'sum'].includes(outcome.countingMode)) {
    throw new Error(`Unsupported Outcome counting mode: ${outcome.countingMode}`);
  }
  if (
    !Number.isInteger(outcome.visitorWindowDays) ||
    outcome.visitorWindowDays < 1 ||
    outcome.visitorWindowDays > 30
  ) {
    throw new Error('Visitor attribution window must be between 1 and 30 days');
  }
}

function sourceEventsSql(outcome: Outcome) {
  if (outcome.sourceType === 'event') {
    const numericJoin = outcome.numericField
      ? `left join event_data ed
          on ed.website_id = we.website_id
         and ed.event_id = we.event_id
         and ed.data_key = {numericField:String}`
      : '';
    const value = outcome.numericField ? 'toFloat64(ifNull(ed.number_value, 0))' : '1.';
    return `
      select we.session_id as session_id, we.event_id as event_key, we.created_at as occurred_at,
             ${value} as value, '' as currency
      from website_event we
      ${numericJoin}
      where we.website_id = {websiteId:UUID}
        and we.event_type = ${EVENT_TYPE.customEvent}
        and we.event_name = {sourceValue:String}
        and we.created_at <= {sourceDataThroughAt:DateTime64(3, 'UTC')}`;
  }
  if (outcome.sourceValue === 'pageview') {
    return `
      select session_id, event_id as event_key, created_at as occurred_at, 1. as value, '' as currency
      from website_event
      where website_id = {websiteId:UUID}
        and event_type = ${EVENT_TYPE.pageView}
        and created_at <= {sourceDataThroughAt:DateTime64(3, 'UTC')}`;
  }
  if (outcome.sourceValue === 'visit') {
    return `
      select session_id, visit_id as event_key, min(created_at) as occurred_at, 1. as value, '' as currency
      from website_event
      where website_id = {websiteId:UUID}
        and event_type not in (${EVENT_TYPE.customEvent}, ${EVENT_TYPE.performance})
        and created_at <= {sourceDataThroughAt:DateTime64(3, 'UTC')}
      group by session_id, visit_id`;
  }
  if (outcome.sourceValue === 'revenue') {
    return `
      select session_id, event_id as event_key, created_at as occurred_at,
             toFloat64(revenue) as value, upper(currency) as currency
      from website_revenue
      where website_id = {websiteId:UUID}
        and created_at <= {sourceDataThroughAt:DateTime64(3, 'UTC')}`;
  }
  if (outcome.sourceValue === 'session-duration') {
    return `
      select session_id, event_id as event_key, created_at as occurred_at,
             0. as value, '' as currency
      from website_event
      where website_id = {websiteId:UUID}
        and event_type != ${EVENT_TYPE.performance}
        and created_at <= {sourceDataThroughAt:DateTime64(3, 'UTC')}`;
  }
  throw new Error(`Unsupported standard Experiment metric: ${outcome.sourceValue}`);
}

function attributionCtes(scope: Scope, outcome: Outcome) {
  const eligibleSessions =
    scope === 'session'
      ? `select unit_key as unit_key, first_session_id as session_id from first_exposures`
      : `select distinct f.unit_key as unit_key, linked.session_id as session_id
       from first_exposures f
       inner join session_link as origin final
         on origin.website_id = {websiteId:UUID} and origin.session_id = f.first_session_id
       inner join session_link as linked final
         on linked.website_id = origin.website_id and linked.distinct_id = origin.distinct_id`;
  const windowPredicate =
    scope === 'visitor'
      ? `and s.occurred_at <= addDays(f.first_exposure_at, {visitorWindowDays:UInt8})`
      : '';
  const attributed =
    outcome.sourceValue === 'session-duration'
      ? `select
        f.unit_key as unit_key,
        toString(es.session_id) as event_key,
        max(s.occurred_at) as occurred_at,
        toFloat64(dateDiff(
          'millisecond',
          if(es.session_id = f.first_session_id, f.first_exposure_at, min(s.occurred_at)),
          max(s.occurred_at)
        )) as value,
        '' as currency
      from first_exposures f
      inner join eligible_sessions es on es.unit_key = f.unit_key
      inner join source_events s on s.session_id = es.session_id
      where s.occurred_at > f.first_exposure_at
        ${windowPredicate}
      group by f.unit_key, es.session_id, f.first_session_id, f.first_exposure_at`
      : `select
        f.unit_key as unit_key,
        s.event_key as event_key,
        s.occurred_at as occurred_at,
        s.value as value,
        s.currency as currency
      from first_exposures f
      inner join eligible_sessions es on es.unit_key = f.unit_key
      inner join source_events s on s.session_id = es.session_id
      where s.occurred_at > f.first_exposure_at
        ${windowPredicate}`;
  return `
    first_bindings as (
      select
        session_assignment_key,
        argMin(visitor_digest, tuple(bound_at, binding_id)) as visitor_digest
      from experiment_assignment_binding
      where website_id = {websiteId:UUID}
        and experiment_run_id = {experimentRunId:UUID}
      group by session_assignment_key
    ),
    tombstoned_visitors as (
      select visitor_digest
      from experiment_privacy_tombstone final
      where website_id = {websiteId:UUID}
    ),
    first_assignments as (
      select unit_type, unit_key, argMin(variation, tuple(assigned_at, assignment_id)) as variation
      from experiment_assignment
      where website_id = {websiteId:UUID}
        and experiment_run_id = {experimentRunId:UUID}
      group by unit_type, unit_key
    ),
    visitor_first_assignments as (
      select visitor_unit_key,
             argMin(variation, tuple(assigned_at, assignment_id)) as variation
      from (
        select a.*,
               if(a.unit_type = 'visitor', a.unit_key, ifNull(b.visitor_digest, '')) as visitor_unit_key
        from experiment_assignment a
        left join first_bindings b
          on a.unit_type = 'session' and b.session_assignment_key = a.unit_key
        where a.website_id = {websiteId:UUID}
          and a.experiment_run_id = {experimentRunId:UUID}
      )
      where visitor_unit_key != ''
        and visitor_unit_key not in (select visitor_digest from tombstoned_visitors)
      group by visitor_unit_key
    ),
    eligible_exposures as (
      select
        e.exposure_id,
        e.session_id,
        e.exposed_at,
        e.unit_type,
        e.unit_key,
        if(a.unit_key != '', a.variation, e.variation) as authoritative_variation,
        if(v.visitor_unit_key != '', v.variation, authoritative_variation) as visitor_authoritative_variation,
        if(
          e.unit_type = 'visitor',
          e.unit_key,
          if(e.unit_type = 'session', ifNull(b.visitor_digest, ''), '')
        ) as visitor_unit_key
      from (
        select *
        from experiment_exposure final
        where website_id = {websiteId:UUID}
          and experiment_run_id = {experimentRunId:UUID}
      ) e
      left join first_assignments a on a.unit_type = e.unit_type and a.unit_key = e.unit_key
      left join first_bindings b
        on e.unit_type = 'session' and b.session_assignment_key = e.unit_key
      left join visitor_first_assignments v
        on v.visitor_unit_key = if(
          e.unit_type = 'visitor',
          e.unit_key,
          if(e.unit_type = 'session', ifNull(b.visitor_digest, ''), '')
        )
      where visitor_unit_key not in (select visitor_digest from tombstoned_visitors)
    ),
    first_exposures as (
      select
        ${scope === 'session' ? 'toString(e.session_id)' : 'e.visitor_unit_key'} as unit_key,
        argMin(e.session_id, tuple(e.exposed_at, e.exposure_id)) as first_session_id,
        min(e.exposed_at) as first_exposure_at,
        argMin(${scope === 'visitor' ? 'e.visitor_authoritative_variation' : 'e.authoritative_variation'}, tuple(e.exposed_at, e.exposure_id)) as variation
      from eligible_exposures e
      where ${scope === 'visitor' ? "e.visitor_unit_key != ''" : "e.unit_type in ('session', 'visitor')"}
      group by ${scope === 'session' ? 'toString(e.session_id)' : 'e.visitor_unit_key'}
    ),
    eligible_sessions as (${eligibleSessions}),
    source_events as (${sourceEventsSql(outcome)}),
    attributed as (${attributed})`;
}

export async function aggregateExperimentOutcome(input: {
  websiteId: string;
  experimentRunId: string;
  outcome: Outcome;
  sourceDataThroughAt: Date;
  computedAt?: Date;
}) {
  const { websiteId, experimentRunId, outcome, sourceDataThroughAt } = input;
  assertOutcome(outcome);
  const computedAt = input.computedAt ?? new Date();
  const aggregationVersion = computedAt.getTime();
  const params = {
    websiteId,
    experimentRunId,
    outcomeId: outcome.id,
    sourceValue: outcome.sourceValue,
    numericField: outcome.numericField ?? '',
    visitorWindowDays: outcome.visitorWindowDays,
    currency: outcome.currency?.toUpperCase() ?? '',
    sourceDataThroughAt: clickhouseDateTime64(sourceDataThroughAt),
    computedAt: clickhouseDateTime64(computedAt),
    aggregationVersion,
  };

  for (const scope of scopes(outcome)) {
    const uniqueCount = outcome.countingMode === 'unique';
    const currencyPredicate = outcome.currency ? 'and upper(a.currency) = {currency:String}' : '';
    await clickhouse.command(
      `insert into experiment_outcome_unit
      with ${attributionCtes(scope, outcome)},
      eligible_outcomes as (
        select a.unit_key, a.event_key, a.occurred_at, a.value, a.currency
        from attributed a
        where 1 = 1 ${currencyPredicate}
      )
      select
        {websiteId:UUID}, {experimentRunId:UUID}, {outcomeId:UUID}, f.variation,
        {scope:String}, {scope:String}, f.unit_key,
        toUInt8(count(e.event_key) > 0) as converted,
        ${uniqueCount ? 'toUInt64(count(e.event_key) > 0)' : 'toUInt64(count(e.event_key))'} as event_count,
        toDecimal128(${outcome.countingMode === 'sum' ? 'ifNull(sum(e.value), 0)' : uniqueCount ? 'count(e.event_key) > 0' : 'count(e.event_key)'}, 4) as value_sum,
        f.first_exposure_at,
        minOrNull(e.occurred_at), maxOrNull(e.occurred_at),
        {sourceDataThroughAt:DateTime64(3, 'UTC')}, {aggregationVersion:UInt64},
        {computedAt:DateTime64(3, 'UTC')}
      from first_exposures f
      left join eligible_outcomes e on e.unit_key = f.unit_key
      group by f.unit_key, f.variation, f.first_exposure_at`,
      { ...params, scope },
      FUNCTION_NAME,
      SENSITIVE_EXPERIMENT_PARAMS,
    );
  }
}

export async function getExperimentExposureAggregates(websiteId: string, experimentRunId: string) {
  return clickhouse.rawQuery<ExperimentExposureAggregate[]>(
    `with first_assignments as (
       select unit_type, unit_key, argMin(variation, tuple(assigned_at, assignment_id)) variation
       from experiment_assignment
       where website_id = {websiteId:UUID} and experiment_run_id = {experimentRunId:UUID}
       group by unit_type, unit_key
     ), first_bindings as (
       select session_assignment_key,
              argMin(visitor_digest, tuple(bound_at, binding_id)) visitor_digest
       from experiment_assignment_binding
       where website_id = {websiteId:UUID} and experiment_run_id = {experimentRunId:UUID}
       group by session_assignment_key
     ), visitor_first_assignments as (
       select visitor_unit_key, argMin(variation, tuple(assigned_at, assignment_id)) variation
       from (
         select a.*,
                if(a.unit_type = 'visitor', a.unit_key, ifNull(b.visitor_digest, '')) visitor_unit_key
         from experiment_assignment a
         left join first_bindings b
           on a.unit_type = 'session' and b.session_assignment_key = a.unit_key
         where a.website_id = {websiteId:UUID}
           and a.experiment_run_id = {experimentRunId:UUID}
       )
       where visitor_unit_key != ''
       group by visitor_unit_key
     ), eligible_exposures as (
       select e.*, if(a.unit_key != '', a.variation, e.variation) authoritative_variation,
              if(v.visitor_unit_key != '', v.variation, authoritative_variation) visitor_authoritative_variation,
              if(e.unit_type = 'visitor', e.unit_key,
                 if(e.unit_type = 'session', ifNull(b.visitor_digest, ''), '')) visitor_unit_key
       from experiment_exposure as e final
       left join first_assignments a on a.unit_type = e.unit_type and a.unit_key = e.unit_key
       left join first_bindings b
         on e.unit_type = 'session' and b.session_assignment_key = e.unit_key
       left join visitor_first_assignments v
         on v.visitor_unit_key = if(e.unit_type = 'visitor', e.unit_key,
            if(e.unit_type = 'session', ifNull(b.visitor_digest, ''), ''))
       where e.website_id = {websiteId:UUID} and e.experiment_run_id = {experimentRunId:UUID}
         and visitor_unit_key not in (
           select visitor_digest from experiment_privacy_tombstone final where website_id = {websiteId:UUID}
         )
     ), first_exposures as (
       select 'session' scope, toString(session_id) unit_key,
              argMin(authoritative_variation, tuple(exposed_at, exposure_id)) variation
       from eligible_exposures
       group by session_id
       union all
       select 'visitor' scope, visitor_unit_key unit_key,
              argMin(visitor_authoritative_variation, tuple(exposed_at, exposure_id)) variation
       from eligible_exposures
       where visitor_unit_key != ''
       group by visitor_unit_key
     )
     select scope, variation, count() exposed from first_exposures group by scope, variation`,
    { websiteId, experimentRunId },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
}

export async function getExperimentOutcomeUnitAggregates(
  websiteId: string,
  experimentRunId: string,
) {
  return clickhouse.rawQuery<ExperimentOutcomeUnitAggregate[]>(
    `select experiment_outcome_id outcomeId, attribution_scope scope, variation,
            toUInt8(converted) converted, toUInt64(event_count) eventCount,
            toFloat64(value_sum) value, first_exposure_at exposedAt, first_outcome_at firstOutcomeAt
     from experiment_outcome_unit final
     where website_id = {websiteId:UUID} and experiment_run_id = {experimentRunId:UUID}
       and not (unit_type = 'visitor' and unit_key in (
         select visitor_digest from experiment_privacy_tombstone final where website_id = {websiteId:UUID}
       ))
       and not (unit_type = 'session' and unit_key in (
         select toString(e.session_id)
         from experiment_exposure as e final
         inner join experiment_privacy_tombstone as t final
           on t.website_id = e.website_id and t.visitor_digest = e.unit_key
         where e.website_id = {websiteId:UUID} and e.unit_type = 'visitor'
         union all
         select toString(e.session_id)
         from experiment_exposure as e final
         inner join (
           select experiment_run_id, session_assignment_key,
                  argMin(visitor_digest, tuple(bound_at, binding_id)) visitor_digest
           from experiment_assignment_binding
           where website_id = {websiteId:UUID}
           group by experiment_run_id, session_assignment_key
         ) b on b.experiment_run_id = e.experiment_run_id
            and b.session_assignment_key = e.unit_key
         inner join experiment_privacy_tombstone as t final
           on t.website_id = e.website_id and t.visitor_digest = b.visitor_digest
         where e.website_id = {websiteId:UUID}
       ))`,
    { websiteId, experimentRunId },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
}

async function getOutcomeDerivedDiagnostics(input: {
  websiteId: string;
  experimentRunId: string;
  outcome: Outcome;
  sourceDataThroughAt: Date;
}) {
  const rows: ExperimentDiagnosticAggregate[] = [];
  for (const scope of scopes(input.outcome)) {
    const params = {
      websiteId: input.websiteId,
      experimentRunId: input.experimentRunId,
      scope,
      sourceValue: input.outcome.sourceValue,
      numericField: input.outcome.numericField ?? '',
      visitorWindowDays: input.outcome.visitorWindowDays,
      currency: input.outcome.currency?.toUpperCase() ?? '',
      sourceDataThroughAt: clickhouseDateTime64(input.sourceDataThroughAt),
    };
    if (input.outcome.currency) {
      const result = await clickhouse.rawQuery<{ count: number }[]>(
        `with ${attributionCtes(scope, input.outcome)}
         select count() count from attributed where upper(currency) != {currency:String}`,
        params,
        FUNCTION_NAME,
        SENSITIVE_EXPERIMENT_PARAMS,
      );
      rows.push({
        type: 'excluded-currency',
        reason: input.outcome.id,
        count: Number(result[0]?.count ?? 0),
      });
    }
    if (scope === 'visitor') {
      const result = await clickhouse.rawQuery<{ count: number }[]>(
        `with ${attributionCtes(scope, input.outcome)}
         select count() count
         from first_exposures f
         inner join eligible_sessions es on es.unit_key = f.unit_key
         inner join source_events s on s.session_id = es.session_id
         where s.occurred_at > addDays(f.first_exposure_at, {visitorWindowDays:UInt8})`,
        params,
        FUNCTION_NAME,
        SENSITIVE_EXPERIMENT_PARAMS,
      );
      rows.push({
        type: 'late-event',
        reason: input.outcome.id,
        count: Number(result[0]?.count ?? 0),
      });
    }
  }
  return rows;
}

export async function getExperimentDiagnostics(websiteId: string, experimentRunId: string) {
  return clickhouse.rawQuery<ExperimentDiagnosticAggregate[]>(
    `select diagnostic_type type, reason, sum(count) count
     from experiment_diagnostic
     where website_id = {websiteId:UUID}
       and experiment_run_id in ({experimentRunId:UUID}, toUUID('00000000-0000-0000-0000-000000000000'))
     group by diagnostic_type, reason
     union all
     select 'crossover', 'first-assignment-wins', count()
     from (
       select unit_type, unit_key
       from experiment_assignment
       where website_id = {websiteId:UUID} and experiment_run_id = {experimentRunId:UUID}
       group by unit_type, unit_key having uniq(variation) > 1
     )
     union all
     select 'missing-identity', 'visitor-session-link', count()
     from (
       select argMin(session_id, tuple(exposed_at, exposure_id)) session_id
       from experiment_exposure final
       where website_id = {websiteId:UUID} and experiment_run_id = {experimentRunId:UUID} and unit_type = 'visitor'
       group by unit_key
     ) e left join session_link as sl final
       on sl.website_id = {websiteId:UUID} and sl.session_id = e.session_id
     where sl.session_id is null`,
    { websiteId, experimentRunId },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
}

export async function getExperimentCumulativeAggregates(
  websiteId: string,
  experimentRunId: string,
) {
  return clickhouse.rawQuery<ExperimentCumulativeAggregate[]>(
    `select attribution_scope scope, experiment_outcome_id outcomeId, variation,
            toString(toDate(first_exposure_at)) date,
            sum(count()) over w exposed,
            sum(sum(toUInt64(converted))) over w converted,
            sum(sum(event_count)) over w eventCount,
            sum(sum(toFloat64(value_sum))) over w value
     from experiment_outcome_unit final
     where website_id = {websiteId:UUID} and experiment_run_id = {experimentRunId:UUID}
       and not (unit_type = 'visitor' and unit_key in (
         select visitor_digest from experiment_privacy_tombstone final where website_id = {websiteId:UUID}
       ))
       and not (unit_type = 'session' and unit_key in (
         select toString(e.session_id)
         from experiment_exposure as e final
         inner join experiment_privacy_tombstone as t final
           on t.website_id = e.website_id and t.visitor_digest = e.unit_key
         where e.website_id = {websiteId:UUID} and e.unit_type = 'visitor'
         union all
         select toString(e.session_id)
         from experiment_exposure as e final
         inner join (
           select experiment_run_id, session_assignment_key,
                  argMin(visitor_digest, tuple(bound_at, binding_id)) visitor_digest
           from experiment_assignment_binding
           where website_id = {websiteId:UUID}
           group by experiment_run_id, session_assignment_key
         ) b on b.experiment_run_id = e.experiment_run_id
            and b.session_assignment_key = e.unit_key
         inner join experiment_privacy_tombstone as t final
           on t.website_id = e.website_id and t.visitor_digest = b.visitor_digest
         where e.website_id = {websiteId:UUID}
       ))
     group by scope, outcomeId, variation, date
     window w as (partition by scope, outcomeId, variation order by date rows unbounded preceding)
     order by date`,
    { websiteId, experimentRunId },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
}

function hasUnsupportedRealtimePredicate(snapshot: any): boolean {
  if (!snapshot) return false;
  const value = JSON.stringify(snapshot.parameters ?? snapshot).toLowerCase();
  return (
    value.includes('realtime') || value.includes('activevisitor') || value.includes('currently')
  );
}

async function computeClickhouseExperimentResults(run: any, outcomes: Outcome[]) {
  if (
    hasUnsupportedRealtimePredicate(run.audienceSegmentSnapshot) ||
    hasUnsupportedRealtimePredicate(run.exclusionSegmentSnapshot)
  ) {
    throw new Error('Frozen Segment contains an unsupported real-time predicate');
  }
  const sourceDataThroughAt = new Date();
  const computedAt = new Date();
  const derivedDiagnostics: ExperimentDiagnosticAggregate[] = [];
  for (const outcome of outcomes) {
    // ReplacingMergeTree keeps one current aggregate per Unit. Scheduled runs refresh these
    // materialized Unit rows, while finalization performs the same computation from all raw facts.
    await aggregateExperimentOutcome({
      websiteId: run.websiteId,
      experimentRunId: run.id,
      outcome,
      sourceDataThroughAt,
      computedAt,
    });
    derivedDiagnostics.push(
      ...(await getOutcomeDerivedDiagnostics({
        websiteId: run.websiteId,
        experimentRunId: run.id,
        outcome,
        sourceDataThroughAt,
      })),
    );
  }
  const [units, exposures, storedDiagnostics, cumulative] = await Promise.all([
    getExperimentOutcomeUnitAggregates(run.websiteId, run.id),
    getExperimentExposureAggregates(run.websiteId, run.id),
    getExperimentDiagnostics(run.websiteId, run.id),
    getExperimentCumulativeAggregates(run.websiteId, run.id),
  ]);
  const result = computeExperimentResults({
    run,
    outcomes: outcomes as unknown as ExperimentOutcomeRow[],
    units,
    exposures,
    diagnostics: [...storedDiagnostics, ...derivedDiagnostics],
    cumulative,
    sourceDataThroughAt,
    computedAt,
  });
  return {
    results: result,
    diagnostics: result.diagnostics,
    safeguardResults: {
      session: result.modes.session.readiness,
      visitor: result.modes.visitor.readiness,
    },
    sourceDataThroughAt,
    computedAt,
  };
}

export const clickhouseExperimentResultComputer: ExperimentResultComputation = {
  computeFull: ({ run, outcomes }) =>
    computeClickhouseExperimentResults(run, outcomes as Outcome[]),
  computeIncremental: ({ run, outcomes }) =>
    computeClickhouseExperimentResults(run, outcomes as Outcome[]),
};
