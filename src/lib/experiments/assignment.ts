import { isExperimentVisitorDigest } from './identity';
import type { ExperimentRunStatus } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ExperimentAssignmentUnit = 'session' | 'visitor';

export interface ExperimentAssignmentRecord {
  experimentRunId: string;
  variation: number;
  unitType: ExperimentAssignmentUnit;
}

export interface ExperimentAssignmentWrite {
  websiteId: string;
  experimentRunId: string;
  mutualExclusionGroupId: string | null;
  unitType: ExperimentAssignmentUnit;
  unitKey: string;
  variation: number;
}

export type ExperimentAssignmentDiagnosticType =
  | 'crossover'
  | 'missing-identity'
  | 'collection-failure'
  | 'exclusion';

export interface ExperimentAssignmentDiagnostic {
  websiteId: string;
  experimentRunId: string;
  type: ExperimentAssignmentDiagnosticType;
  reason?: string;
  count: number;
}

export interface ExperimentAssignmentAdapter {
  getAssignment(input: {
    websiteId: string;
    experimentRunId: string;
    unitType: ExperimentAssignmentUnit;
    unitKey: string;
  }): Promise<ExperimentAssignmentRecord | null>;
  saveFirstAssignment(input: ExperimentAssignmentWrite): Promise<ExperimentAssignmentRecord>;
  bindSessionAssignment(
    input: ExperimentAssignmentWrite & { sessionAssignmentKey: string },
  ): Promise<ExperimentAssignmentRecord>;
  getMutualExclusionAssignment(input: {
    websiteId: string;
    mutualExclusionGroupId: string;
    unitType: ExperimentAssignmentUnit;
    unitKey: string;
  }): Promise<{ experimentRunId: string } | null>;
  saveDiagnostic(diagnostic: ExperimentAssignmentDiagnostic): Promise<void>;
}

export interface ResolveExperimentAssignmentInput {
  run: {
    id: string;
    websiteId: string;
    status: ExperimentRunStatus | string;
    mutualExclusionGroupId?: string | null;
  };
  evaluatedVariation: number;
  sessionAssignmentKey?: string | null;
  visitorDigest?: string | null;
}

async function saveDiagnostic(
  adapter: ExperimentAssignmentAdapter,
  diagnostic: ExperimentAssignmentDiagnostic,
) {
  try {
    await adapter.saveDiagnostic(diagnostic);
  } catch {
    // Diagnostics are best-effort and never change Feature Flag evaluation.
  }
}

function validSessionAssignmentKey(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

async function diagnoseCrossover(
  adapter: ExperimentAssignmentAdapter,
  input: ResolveExperimentAssignmentInput,
) {
  await saveDiagnostic(adapter, {
    websiteId: input.run.websiteId,
    experimentRunId: input.run.id,
    type: 'crossover',
    count: 1,
  });
}

async function isExcludedByGroup(
  input: ResolveExperimentAssignmentInput,
  adapter: ExperimentAssignmentAdapter,
  units: { unitType: ExperimentAssignmentUnit; unitKey: string }[],
) {
  const groupId = input.run.mutualExclusionGroupId;
  if (!groupId) {
    return false;
  }

  for (const unit of units) {
    const admitted = await adapter.getMutualExclusionAssignment({
      websiteId: input.run.websiteId,
      mutualExclusionGroupId: groupId,
      ...unit,
    });

    if (admitted && admitted.experimentRunId !== input.run.id) {
      await saveDiagnostic(adapter, {
        websiteId: input.run.websiteId,
        experimentRunId: input.run.id,
        type: 'exclusion',
        reason: 'mutual-exclusion',
        count: 1,
      });
      return true;
    }
  }

  return false;
}

function assignmentWrite(
  input: ResolveExperimentAssignmentInput,
  unitType: ExperimentAssignmentUnit,
  unitKey: string,
  variation: number,
): ExperimentAssignmentWrite {
  return {
    websiteId: input.run.websiteId,
    experimentRunId: input.run.id,
    mutualExclusionGroupId: input.run.mutualExclusionGroupId ?? null,
    unitType,
    unitKey,
    variation,
  };
}

/**
 * Resolves experiment persistence around an already evaluated Feature Flag Variation.
 * A null result deliberately leaves the caller's normal Feature Flag result untouched.
 */
export async function resolveExperimentAssignment(
  input: ResolveExperimentAssignmentInput,
  adapter: ExperimentAssignmentAdapter,
): Promise<ExperimentAssignmentRecord | null> {
  if (input.run.status !== 'Running') {
    return null;
  }

  const validRun =
    UUID_PATTERN.test(input.run.id) &&
    UUID_PATTERN.test(input.run.websiteId) &&
    (!input.run.mutualExclusionGroupId || UUID_PATTERN.test(input.run.mutualExclusionGroupId));
  const validVariation =
    Number.isInteger(input.evaluatedVariation) && input.evaluatedVariation >= 0;
  const hasVisitorDigest = input.visitorDigest != null;
  const visitorDigestValid =
    !hasVisitorDigest || isExperimentVisitorDigest(input.visitorDigest as string);
  const sessionKeyValid = validSessionAssignmentKey(input.sessionAssignmentKey);

  if (
    !validRun ||
    !validVariation ||
    !visitorDigestValid ||
    (!hasVisitorDigest && !sessionKeyValid)
  ) {
    await saveDiagnostic(adapter, {
      websiteId: input.run.websiteId,
      experimentRunId: input.run.id,
      type: 'missing-identity',
      reason: 'invalid-or-missing-unit-key',
      count: 1,
    });
    return null;
  }

  try {
    if (hasVisitorDigest) {
      const visitorDigest = input.visitorDigest as string;
      const groupUnits = [
        { unitType: 'visitor' as const, unitKey: visitorDigest },
        ...(sessionKeyValid
          ? [{ unitType: 'session' as const, unitKey: input.sessionAssignmentKey }]
          : []),
      ];
      if (await isExcludedByGroup(input, adapter, groupUnits)) {
        return null;
      }

      const visitorAssignment = await adapter.getAssignment({
        websiteId: input.run.websiteId,
        experimentRunId: input.run.id,
        unitType: 'visitor',
        unitKey: visitorDigest,
      });
      const sessionAssignment = sessionKeyValid
        ? await adapter.getAssignment({
            websiteId: input.run.websiteId,
            experimentRunId: input.run.id,
            unitType: 'session',
            unitKey: input.sessionAssignmentKey,
          })
        : null;

      if (visitorAssignment) {
        if (
          visitorAssignment.variation !== input.evaluatedVariation ||
          (sessionAssignment && sessionAssignment.variation !== visitorAssignment.variation)
        ) {
          await diagnoseCrossover(adapter, input);
        }
        if (sessionAssignment && sessionKeyValid) {
          // Persist the privacy/attribution link even when this Visitor already
          // had the authoritative assignment. The adapter must preserve the
          // Visitor's first assignment while recording the Session binding.
          const rebound = await adapter.bindSessionAssignment({
            ...assignmentWrite(input, 'visitor', visitorDigest, sessionAssignment.variation),
            sessionAssignmentKey: input.sessionAssignmentKey,
          });
          return rebound;
        }
        return visitorAssignment;
      }

      if (sessionAssignment && sessionKeyValid) {
        const bound = await adapter.bindSessionAssignment({
          ...assignmentWrite(input, 'visitor', visitorDigest, sessionAssignment.variation),
          sessionAssignmentKey: input.sessionAssignmentKey,
        });

        if (
          bound.variation !== sessionAssignment.variation ||
          bound.variation !== input.evaluatedVariation
        ) {
          await diagnoseCrossover(adapter, input);
        }
        return (await isExcludedByGroup(input, adapter, groupUnits)) ? null : bound;
      }

      const saved = await adapter.saveFirstAssignment(
        assignmentWrite(input, 'visitor', visitorDigest, input.evaluatedVariation),
      );
      if (saved.variation !== input.evaluatedVariation) {
        await diagnoseCrossover(adapter, input);
      }
      return (await isExcludedByGroup(input, adapter, groupUnits)) ? null : saved;
    }

    const sessionUnit = {
      unitType: 'session' as const,
      unitKey: input.sessionAssignmentKey as string,
    };
    if (await isExcludedByGroup(input, adapter, [sessionUnit])) {
      return null;
    }

    const sessionAssignment = await adapter.getAssignment({
      websiteId: input.run.websiteId,
      experimentRunId: input.run.id,
      unitType: 'session',
      unitKey: input.sessionAssignmentKey as string,
    });
    if (sessionAssignment) {
      if (sessionAssignment.variation !== input.evaluatedVariation) {
        await diagnoseCrossover(adapter, input);
      }
      return sessionAssignment;
    }

    const saved = await adapter.saveFirstAssignment(
      assignmentWrite(input, sessionUnit.unitType, sessionUnit.unitKey, input.evaluatedVariation),
    );
    if (saved.variation !== input.evaluatedVariation) {
      await diagnoseCrossover(adapter, input);
    }
    return (await isExcludedByGroup(input, adapter, [sessionUnit])) ? null : saved;
  } catch {
    await saveDiagnostic(adapter, {
      websiteId: input.run.websiteId,
      experimentRunId: input.run.id,
      type: 'collection-failure',
      reason: 'assignment-adapter-failure',
      count: 1,
    });
    return null;
  }
}
