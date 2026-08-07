import { calculateActiveRuntimeMs } from './domain';
import { calculateExperimentReadiness } from './readiness';
import { calculateExperimentStatistics, type StatisticalOutcomeModel } from './statistics';

export type ExperimentResultMode = 'session' | 'visitor';

export interface ExperimentOutcomeRow {
  id: string;
  name: string;
  type: string;
  countingMode: string;
  attributionScope: string;
  desiredDirection: 'increase' | 'decrease';
  role: 'primary' | 'secondary';
}

export interface ExperimentOutcomeUnitAggregate {
  outcomeId: string;
  scope: ExperimentResultMode;
  variation: number;
  converted: number;
  eventCount: number;
  value: number;
  exposedAt?: Date | string;
  firstOutcomeAt?: Date | string | null;
}

export interface ExperimentExposureAggregate {
  scope: ExperimentResultMode;
  variation: number;
  exposed: number;
}

export interface ExperimentCumulativeAggregate {
  scope: ExperimentResultMode;
  outcomeId: string;
  variation: number;
  date: string;
  exposed: number;
  converted: number;
  eventCount: number;
  value: number;
}

export interface ExperimentDiagnosticAggregate {
  type: string;
  reason?: string;
  count: number;
}

export interface ComputeExperimentResultsInput {
  run: any;
  outcomes: ExperimentOutcomeRow[];
  units: ExperimentOutcomeUnitAggregate[];
  exposures: ExperimentExposureAggregate[];
  diagnostics?: ExperimentDiagnosticAggregate[];
  cumulative?: ExperimentCumulativeAggregate[];
  sourceDataThroughAt: Date;
  computedAt?: Date;
}

function variationCount(run: any) {
  return Array.isArray(run.featureFlagVariations) ? run.featureFlagVariations.length : 0;
}

function modelFor(outcome: ExperimentOutcomeRow): StatisticalOutcomeModel {
  if (outcome.countingMode === 'unique' || outcome.type === 'conversion') return 'conversion';
  if (outcome.countingMode === 'count' || outcome.type === 'count') return 'count';
  return 'continuous';
}

function appliesToScope(outcome: ExperimentOutcomeRow, scope: ExperimentResultMode) {
  return outcome.attributionScope === 'both' || outcome.attributionScope === scope;
}

function aggregateDiagnostics(rows: ExperimentDiagnosticAggregate[] = []) {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + Number(row.count || 0);
  return {
    missingIdentity: counts['missing-identity'] ?? 0,
    duplicateExposures: counts.duplicate ?? 0,
    crossovers: counts.crossover ?? 0,
    lateEvents: counts['late-event'] ?? 0,
    exclusions: counts.exclusion ?? 0,
    excludedBotsOrInternalTraffic: counts.exclusion ?? 0,
    excludedCurrency: counts['excluded-currency'] ?? 0,
    collectionFailures: counts['collection-failure'] ?? 0,
    unsupportedSegments: counts['unsupported-segment'] ?? 0,
    collectionHealthy: (counts['collection-failure'] ?? 0) === 0,
    byType: counts,
  };
}

/** Pure integration seam from per-Unit aggregates to the frozen bayesian-v1 contract. */
export function computeExperimentResults(input: ComputeExperimentResultsInput) {
  const computedAt = input.computedAt ?? new Date();
  const count = variationCount(input.run);
  if (count < 2) throw new Error('Experiment results require at least two frozen Variations');
  const weights = (input.run.variationWeights as number[]).map(Number);
  if (weights.length !== count) throw new Error('Frozen Variation weights do not match Variations');

  const modes = Object.fromEntries(
    (['session', 'visitor'] as const).map(scope => {
      const exposedUnits = Array.from({ length: count }, (_, variation) =>
        input.exposures
          .filter(row => row.scope === scope && Number(row.variation) === variation)
          .reduce((sum, row) => sum + Number(row.exposed), 0),
      );
      const totalExposed = exposedUnits.reduce((sum, value) => sum + value, 0);
      const exposures = exposedUnits.map((exposed, variation) => ({
        variation,
        exposed,
        rate: totalExposed ? exposed / totalExposed : 0,
        expectedRate: weights[variation],
      }));

      const outcomes = input.outcomes
        .filter(outcome => appliesToScope(outcome, scope))
        .map(outcome => {
          const model = modelFor(outcome);
          const unitRows = input.units.filter(
            row => row.scope === scope && row.outcomeId === outcome.id,
          );
          const variationInputs = Array.from({ length: count }, (_, variation) => {
            const rows = unitRows.filter(row => Number(row.variation) === variation);
            if (model === 'conversion') {
              return {
                exposed: exposedUnits[variation],
                conversions: rows.reduce((sum, row) => sum + Number(row.converted), 0),
              };
            }
            if (model === 'count') {
              return {
                exposed: exposedUnits[variation],
                count: rows.reduce((sum, row) => sum + Number(row.eventCount), 0),
              };
            }
            return { values: rows.map(row => Number(row.value)) };
          });
          const statistics = calculateExperimentStatistics({
            model,
            desiredDirection: outcome.desiredDirection,
            baselineVariation: Number(input.run.baselineVariation),
            variations: variationInputs,
            seed: `${input.run.id}:${outcome.id}:${scope}`,
            statisticsVersion: input.run.statisticsVersion,
          });
          const totals = variationInputs.map((row, variation) => {
            const exposed = exposedUnits[variation];
            const value =
              'conversions' in row
                ? row.conversions
                : 'count' in row
                  ? row.count
                  : row.values.reduce((sum, item) => sum + item, 0);
            return { variation, exposed, value, rate: exposed ? value / exposed : 0 };
          });
          return {
            id: outcome.id,
            name: outcome.name,
            role: outcome.role,
            type: outcome.type,
            countingMode: outcome.countingMode,
            model,
            totals,
            statistics,
            cumulative: (input.cumulative ?? []).filter(
              row => row.scope === scope && row.outcomeId === outcome.id,
            ),
          };
        });

      const primary = outcomes.find(outcome => outcome.role === 'primary');
      const activeRuntimeMs = calculateActiveRuntimeMs(
        {
          startedAt: input.run.startedAt,
          pausedAt: input.run.pausedAt,
          completedAt: input.run.completedAt,
          accumulatedPausedDurationMs: Number(input.run.accumulatedPausedDurationMs ?? 0),
        },
        computedAt,
      );
      const readiness = primary
        ? calculateExperimentReadiness({
            exposedUnits,
            expectedWeights: weights,
            activeRuntimeMs,
            safeguards: input.run.safeguards,
            // Deliberately Primary-only. Secondary results are never passed into readiness.
            primaryOutcome: primary.statistics,
          })
        : { status: 'Unavailable' as const, ready: false, winnerVariation: null, checks: {} };

      return [scope, { scope, exposures, totalExposed, outcomes, readiness }];
    }),
  ) as Record<ExperimentResultMode, any>;

  const diagnostics = aggregateDiagnostics(input.diagnostics);
  const rawDataExpired =
    !!input.run.rawDataExpiredAt ||
    (!!input.run.rawDataRetainedUntil && new Date(input.run.rawDataRetainedUntil) <= computedAt);
  const warnings = [
    rawDataExpired &&
      'Underlying raw Experiment data has expired; aggregate results remain available.',
    diagnostics.collectionFailures > 0 && 'Experiment collection failures were recorded.',
    diagnostics.excludedCurrency > 0 && 'Revenue in a different currency was excluded.',
    diagnostics.lateEvents > 0 && 'Outcomes outside their attribution window were excluded.',
    diagnostics.missingIdentity > 0 && 'Some Visitor Outcomes could not be linked to an identity.',
    diagnostics.crossovers > 0 && 'Assignment crossovers were analyzed by first assignment.',
    diagnostics.unsupportedSegments > 0 &&
      'A frozen Segment predicate is unsupported for results computation.',
    modes.session.readiness.checks?.sampleRatioMismatch?.passed === false &&
      'Session allocation has sample-ratio mismatch.',
    modes.visitor.readiness.checks?.sampleRatioMismatch?.passed === false &&
      'Visitor allocation has sample-ratio mismatch.',
  ].filter(Boolean);

  return {
    statisticsVersion: input.run.statisticsVersion,
    baselineVariation: input.run.baselineVariation,
    variations: input.run.featureFlagVariations,
    modes,
    diagnostics,
    warnings,
    exploratory: { filtersAffectOfficialReadiness: false },
    rawRetention: {
      retainedUntil: input.run.rawDataRetainedUntil ?? null,
      expiredAt: input.run.rawDataExpiredAt ?? null,
      expired: rawDataExpired,
    },
    sourceDataThroughAt: input.sourceDataThroughAt,
    computedAt,
  };
}
