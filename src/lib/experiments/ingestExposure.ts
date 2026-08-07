import type { ExperimentAssignmentRecord } from './assignment';
import {
  type ExposureAssignmentReference,
  getExposureReferenceFromIdempotencyKey,
} from './exposureReference';
import { createExperimentVisitorDigest } from './identity';

interface RunningExperimentRun {
  id: string;
  websiteId: string;
  status: string;
  featureFlagKey: string;
  featureFlagVariations: unknown;
  startedAt?: Date | null;
}

export interface IngestExposureInput {
  websiteId: string;
  sessionId: string;
  featureFlagKey: string;
  variation: number;
  idempotencyKey: string;
  source: 'auto' | 'explicit';
  sdkVersion: string;
  exposedAt?: Date;
}

export interface ExposureIngestionDependencies {
  findRunningRun(websiteId: string, featureFlagKey: string): Promise<RunningExperimentRun | null>;
  parseAssignmentReference(idempotencyKey: string): ExposureAssignmentReference | null;
  getAssignment(input: {
    websiteId: string;
    experimentRunId: string;
    unitType: 'session' | 'visitor';
    unitKey: string;
  }): Promise<ExperimentAssignmentRecord | null>;
  getLinkedDistinctIds(websiteId: string, sessionId: string): Promise<string[]>;
  createVisitorDigest(websiteId: string, userKey: string): string;
  saveExposure(input: {
    websiteId: string;
    experimentRunId: string;
    featureFlagKey: string;
    variation: number;
    sessionId: string;
    unitType: 'session' | 'visitor';
    unitKey: string;
    idempotencyKey: string;
    source: string;
    sdkVersion: string;
    exposedAt: Date;
  }): Promise<{ saved: boolean }>;
  markFirstExposure(experimentRunId: string, exposedAt: Date): Promise<unknown>;
  saveDiagnostic(input: {
    websiteId: string;
    experimentRunId?: string | null;
    type: 'collection-failure';
    reason: string;
  }): Promise<unknown>;
}

export function createExposureIngestionService(dependencies: ExposureIngestionDependencies) {
  return async function ingestExposure(input: IngestExposureInput): Promise<{
    accepted: boolean;
    saved: boolean;
    reason?: string;
  }> {
    let run: RunningExperimentRun | null = null;
    try {
      run = await dependencies.findRunningRun(input.websiteId, input.featureFlagKey);
      if (run?.status !== 'Running') {
        return { accepted: false, saved: false, reason: 'run-not-running' };
      }

      const exposedAt = input.exposedAt ?? new Date();
      if (!run.startedAt || exposedAt < run.startedAt) {
        return { accepted: false, saved: false, reason: 'exposure-before-run' };
      }

      const variations = Array.isArray(run.featureFlagVariations) ? run.featureFlagVariations : [];
      if (input.variation < 0 || input.variation >= variations.length) {
        return { accepted: false, saved: false, reason: 'variation-invalid' };
      }

      const reference = dependencies.parseAssignmentReference(input.idempotencyKey);
      if (
        !reference ||
        reference.websiteId !== input.websiteId ||
        reference.experimentRunId !== run.id ||
        reference.featureFlagKey !== input.featureFlagKey ||
        reference.variation !== input.variation
      ) {
        return { accepted: false, saved: false, reason: 'assignment-reference-invalid' };
      }

      // The identity link is authoritative server data. Raw distinct IDs exist
      // only long enough to derive HMACs and are never passed to persistence or logs.
      let assignment: (ExperimentAssignmentRecord & { unitKey: string }) | null = null;
      const distinctIds = await dependencies.getLinkedDistinctIds(input.websiteId, input.sessionId);
      for (const distinctId of distinctIds) {
        const unitKey = dependencies.createVisitorDigest(input.websiteId, distinctId);
        const visitorAssignment = await dependencies.getAssignment({
          websiteId: input.websiteId,
          experimentRunId: run.id,
          unitType: 'visitor',
          unitKey,
        });
        if (visitorAssignment) {
          assignment = { ...visitorAssignment, unitKey };
          break;
        }
      }

      // For anonymous tabs, the authenticated encrypted reference issued by eval
      // recovers only the persisted assignment unit. Assignment existence is the
      // proof that eligibility and mutual-exclusion admission succeeded at eval.
      if (!assignment) {
        const referencedAssignment = await dependencies.getAssignment({
          websiteId: input.websiteId,
          experimentRunId: run.id,
          unitType: reference.unitType,
          unitKey: reference.unitKey,
        });
        if (referencedAssignment) {
          assignment = { ...referencedAssignment, unitKey: reference.unitKey };
        }
      }

      if (!assignment || assignment.variation !== input.variation) {
        return { accepted: false, saved: false, reason: 'assignment-mismatch' };
      }

      const result = await dependencies.saveExposure({
        websiteId: input.websiteId,
        experimentRunId: run.id,
        featureFlagKey: input.featureFlagKey,
        variation: assignment.variation,
        sessionId: input.sessionId,
        unitType: assignment.unitType,
        unitKey: assignment.unitKey,
        idempotencyKey: input.idempotencyKey,
        source: input.source,
        sdkVersion: input.sdkVersion,
        exposedAt,
      });

      if (result.saved) {
        await dependencies.markFirstExposure(run.id, exposedAt);
      }
      return { accepted: true, saved: result.saved };
    } catch {
      try {
        await dependencies.saveDiagnostic({
          websiteId: input.websiteId,
          experimentRunId: run?.id,
          type: 'collection-failure',
          reason: 'exposure-ingestion',
        });
      } catch {
        // Collection diagnostics use the same best-effort persistence path and
        // must never expose identity, assignment, or flag payload values.
      }
      return { accepted: false, saved: false, reason: 'collection-failure' };
    }
  };
}

export function createDefaultExposureIngestionService(dependencies: {
  findRunningRun: ExposureIngestionDependencies['findRunningRun'];
  getAssignment: ExposureIngestionDependencies['getAssignment'];
  getLinkedDistinctIds: ExposureIngestionDependencies['getLinkedDistinctIds'];
  saveExposure: ExposureIngestionDependencies['saveExposure'];
  markFirstExposure: ExposureIngestionDependencies['markFirstExposure'];
  saveDiagnostic: ExposureIngestionDependencies['saveDiagnostic'];
}) {
  return createExposureIngestionService({
    ...dependencies,
    parseAssignmentReference: getExposureReferenceFromIdempotencyKey,
    createVisitorDigest: createExperimentVisitorDigest,
  });
}
