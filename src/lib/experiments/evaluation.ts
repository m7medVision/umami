import type { FeatureFlag } from '@/generated/prisma/client';
import { asEvaluableFeatureFlag, evaluateFlag } from '@/lib/flags';
import type {
  ExperimentAssignmentAdapter,
  ExperimentAssignmentRecord,
  ResolveExperimentAssignmentInput,
} from './assignment';
import { resolveExperimentAssignment } from './assignment';
import { createExposureAssignmentMetadata } from './exposureReference';
import { createExperimentVisitorDigest } from './identity';
import { evaluateRealtimeSegmentSnapshot } from './segmentEligibility';

interface ActiveExperimentRun {
  id: string;
  websiteId: string;
  status: string;
  mutualExclusionGroupId?: string | null;
  featureFlagKey: string;
  featureFlagVariations: unknown;
  variationWeights: unknown;
  rolloutPercentage: number;
  fallthroughVariation: number;
  audienceSegmentSnapshot?: unknown;
  exclusionSegmentSnapshot?: unknown;
}

export interface ExperimentFlagMetadata {
  resolved: boolean;
  variation?: number;
  assignment?: string;
  reference?: string;
  diagnostic?: 'unsupported-segment' | 'excluded-segment';
}

export interface ExperimentFeatureFlagEvaluationDependencies {
  findRunningRun(websiteId: string, featureFlagId: string): Promise<ActiveExperimentRun | null>;
  resolveAssignment(
    input: ResolveExperimentAssignmentInput,
  ): Promise<ExperimentAssignmentRecord | null>;
  createVisitorDigest(websiteId: string, userKey: string): string;
  createAssignmentMetadata(input: {
    websiteId: string;
    experimentRunId: string;
    featureFlagKey: string;
    variation: number;
    unitType: 'session' | 'visitor';
    unitKey: string;
  }): { assignment: string; reference: string };
  saveSegmentDiagnostic?(input: {
    websiteId: string;
    experimentRunId: string;
    reason: 'unsupported-segment' | 'segment-exclusion';
  }): Promise<void>;
}

export interface EvaluateExperimentFeatureFlagsInput {
  websiteId: string;
  definitions: Pick<
    FeatureFlag,
    'id' | 'key' | 'enabled' | 'variations' | 'rollout' | 'defaultVariation'
  >[];
  userKey?: string;
  assignmentKey?: string;
  context?: Record<string, unknown>;
  participate?: boolean;
}

export async function evaluateExperimentFeatureFlags(
  input: EvaluateExperimentFeatureFlagsInput,
  dependencies: ExperimentFeatureFlagEvaluationDependencies,
) {
  const flags: Record<string, { enabled: boolean; value: unknown }> = {};
  const experiments: Record<string, ExperimentFlagMetadata> = {};
  const evaluationKey = input.userKey || input.assignmentKey;
  let visitorDigest: string | undefined;
  if (input.userKey) {
    try {
      visitorDigest = dependencies.createVisitorDigest(input.websiteId, input.userKey);
    } catch {
      // APP_SECRET/HMAC failures disable Experiment assignment, never ordinary flag evaluation.
    }
  }

  await Promise.all(
    input.definitions.map(async flag => {
      const currentDefinition = asEvaluableFeatureFlag(flag);
      const currentEvaluation = evaluateFlag(currentDefinition, evaluationKey);
      flags[flag.key] = {
        enabled:
          flag.enabled && currentEvaluation.value !== false && currentEvaluation.value != null,
        value: currentEvaluation.value,
      };
      experiments[flag.key] = { resolved: false };

      if (input.participate === false || (input.userKey && !visitorDigest)) return;

      try {
        const run = await dependencies.findRunningRun(input.websiteId, flag.id);
        if (!run) return;
        const frozenDefinition = asEvaluableFeatureFlag({
          key: run.featureFlagKey,
          enabled: flag.enabled,
          variations: run.featureFlagVariations,
          rollout: {
            percentage: run.rolloutPercentage,
            weights: run.variationWeights,
          },
          defaultVariation: run.fallthroughVariation,
        });
        const experimentEvaluation = evaluateFlag(frozenDefinition, evaluationKey);
        const match = /^variation-(\d+)$/.exec(experimentEvaluation.reason);
        if (!match) return;

        let diagnostic: ExperimentFlagMetadata['diagnostic'];
        if (run.audienceSegmentSnapshot) {
          const audience = evaluateRealtimeSegmentSnapshot(
            run.audienceSegmentSnapshot,
            input.context,
          );
          if (!audience.supported) diagnostic = 'unsupported-segment';
          else if (!audience.matches) return;
        }
        if (!diagnostic && run.exclusionSegmentSnapshot) {
          const exclusion = evaluateRealtimeSegmentSnapshot(
            run.exclusionSegmentSnapshot,
            input.context,
          );
          if (!exclusion.supported) diagnostic = 'unsupported-segment';
          else if (exclusion.matches) diagnostic = 'excluded-segment';
        }
        if (diagnostic) {
          experiments[flag.key] = { resolved: false, diagnostic };
          try {
            await dependencies.saveSegmentDiagnostic?.({
              websiteId: input.websiteId,
              experimentRunId: run.id,
              reason: diagnostic === 'excluded-segment' ? 'segment-exclusion' : diagnostic,
            });
          } catch {
            // Segment diagnostics are best-effort and cannot gate ordinary flag evaluation.
          }
          return;
        }

        const assignment = await dependencies.resolveAssignment({
          run,
          evaluatedVariation: Number(match[1]),
          sessionAssignmentKey: input.assignmentKey,
          visitorDigest,
        });
        if (!assignment) return;

        const variation = frozenDefinition.variations[assignment.variation];
        const unitKey = assignment.unitType === 'visitor' ? visitorDigest : input.assignmentKey;
        if (!variation || !unitKey) return;

        flags[flag.key] = {
          enabled: flag.enabled && variation.value !== false && variation.value != null,
          value: variation.value,
        };
        experiments[flag.key] = {
          resolved: true,
          variation: assignment.variation,
          ...dependencies.createAssignmentMetadata({
            websiteId: input.websiteId,
            experimentRunId: run.id,
            featureFlagKey: flag.key,
            variation: assignment.variation,
            unitType: assignment.unitType,
            unitKey,
          }),
        };
      } catch {
        // Experiment persistence is deliberately isolated from normal flag evaluation.
      }
    }),
  );

  return { flags, experiments };
}

export function createExperimentFeatureFlagEvaluationDependencies(input: {
  findRunningRun: ExperimentFeatureFlagEvaluationDependencies['findRunningRun'];
  assignmentAdapter: ExperimentAssignmentAdapter;
}): ExperimentFeatureFlagEvaluationDependencies {
  return {
    findRunningRun: input.findRunningRun,
    resolveAssignment: assignment =>
      resolveExperimentAssignment(assignment, input.assignmentAdapter),
    createVisitorDigest: createExperimentVisitorDigest,
    createAssignmentMetadata: createExposureAssignmentMetadata,
    saveSegmentDiagnostic: async diagnostic => {
      try {
        await input.assignmentAdapter.saveDiagnostic({
          websiteId: diagnostic.websiteId,
          experimentRunId: diagnostic.experimentRunId,
          type: 'exclusion',
          reason: diagnostic.reason,
          count: 1,
        });
      } catch {
        // Diagnostics are best-effort and cannot gate ordinary flag evaluation.
      }
    },
  };
}
