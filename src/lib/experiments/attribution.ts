export type AttributionScope = 'session' | 'visitor';
export type AttributionCountingMode = 'unique' | 'count' | 'sum';

export interface AttributionExposureFact {
  unitType: AttributionScope;
  unitKey: string;
  sessionId: string;
  variation: number;
  exposedAt: Date;
}

export interface AttributionAssignmentFact {
  unitType: AttributionScope;
  unitKey: string;
  variation: number;
  assignedAt: Date;
}

export interface AttributionOutcomeFact {
  sessionId: string;
  occurredAt: Date;
  value?: number;
  currency?: string;
}

export interface AttributeOutcomeInput {
  scope: AttributionScope;
  countingMode: AttributionCountingMode;
  visitorWindowDays: number;
  currency?: string | null;
  exposures: AttributionExposureFact[];
  assignments: AttributionAssignmentFact[];
  outcomes: AttributionOutcomeFact[];
  /** Session ids keyed by the same identified Visitor. */
  linkedSessions?: Record<string, string[]>;
  tombstonedVisitorKeys?: ReadonlySet<string>;
}

export interface AttributedOutcomeUnit {
  scope: AttributionScope;
  unitKey: string;
  variation: number;
  exposedAt: Date;
  converted: boolean;
  eventCount: number;
  valueSum: number;
  firstOutcomeAt: Date | null;
  lastOutcomeAt: Date | null;
}

/**
 * Reference attribution used by fixtures and adapters. It deliberately ignores Run status:
 * pausing prevents collection of new Exposures, but already-exposed Units keep accruing Outcomes.
 */
export function attributeExperimentOutcomes(input: AttributeOutcomeInput): {
  units: AttributedOutcomeUnit[];
  diagnostics: { excludedCurrency: number; crossover: number; missingIdentity: number };
} {
  if (input.scope === 'visitor' && (input.visitorWindowDays < 1 || input.visitorWindowDays > 30)) {
    throw new Error('Visitor attribution window must be between 1 and 30 days');
  }

  const assignments = new Map<string, AttributionAssignmentFact>();
  let crossover = 0;
  for (const assignment of [...input.assignments].sort(
    (a, b) => a.assignedAt.getTime() - b.assignedAt.getTime(),
  )) {
    if (assignment.unitType !== input.scope) continue;
    const existing = assignments.get(assignment.unitKey);
    if (!existing) assignments.set(assignment.unitKey, assignment);
    else if (existing.variation !== assignment.variation) crossover++;
  }

  const firstExposures = new Map<string, AttributionExposureFact>();
  for (const exposure of input.exposures) {
    if (exposure.unitType !== input.scope) continue;
    if (input.scope === 'visitor' && input.tombstonedVisitorKeys?.has(exposure.unitKey)) {
      continue;
    }
    const current = firstExposures.get(exposure.unitKey);
    if (!current || exposure.exposedAt < current.exposedAt)
      firstExposures.set(exposure.unitKey, exposure);
  }

  let excludedCurrency = 0;
  let missingIdentity = 0;
  const units = [...firstExposures.values()].map(exposure => {
    const assignment = assignments.get(exposure.unitKey);
    const sessionIds =
      input.scope === 'session'
        ? [exposure.sessionId]
        : (input.linkedSessions?.[exposure.sessionId] ?? [exposure.sessionId]);
    if (input.scope === 'visitor' && !input.linkedSessions?.[exposure.sessionId]) missingIdentity++;
    const end =
      input.scope === 'visitor'
        ? exposure.exposedAt.getTime() + input.visitorWindowDays * 86_400_000
        : Number.POSITIVE_INFINITY;

    const eligible = input.outcomes
      .filter(outcome => {
        if (!sessionIds.includes(outcome.sessionId)) return false;
        const timestamp = outcome.occurredAt.getTime();
        if (timestamp <= exposure.exposedAt.getTime() || timestamp > end) return false;
        if (input.currency && outcome.currency?.toUpperCase() !== input.currency.toUpperCase()) {
          excludedCurrency++;
          return false;
        }
        return true;
      })
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const eventCount =
      input.countingMode === 'unique' ? Number(eligible.length > 0) : eligible.length;
    const valueSum =
      input.countingMode === 'sum'
        ? eligible.reduce(
            (sum, outcome) =>
              sum +
              (typeof outcome.value === 'number' && Number.isFinite(outcome.value)
                ? outcome.value
                : 0),
            0,
          )
        : eventCount;

    return {
      scope: input.scope,
      unitKey: exposure.unitKey,
      // Intention-to-treat: the first persisted assignment wins, even after crossover.
      variation: assignment?.variation ?? exposure.variation,
      exposedAt: exposure.exposedAt,
      converted: eligible.length > 0,
      eventCount,
      valueSum,
      firstOutcomeAt: eligible[0]?.occurredAt ?? null,
      lastOutcomeAt: eligible.at(-1)?.occurredAt ?? null,
    };
  });

  return { units, diagnostics: { excludedCurrency, crossover, missingIdentity } };
}
