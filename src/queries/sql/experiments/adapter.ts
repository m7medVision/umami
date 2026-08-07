import type { ExperimentAssignmentAdapter } from '@/lib/experiments/assignment';
import { getActiveMutualExclusionRunIds } from '@/queries/prisma/experiment';
import {
  bindAnonymousExperimentAssignment,
  getExperimentAssignment,
  getMutualExclusionAssignment,
  saveFirstExperimentAssignment,
} from './assignment';
import { saveExperimentDiagnostic } from './diagnostic';

export const clickhouseExperimentAssignmentAdapter: ExperimentAssignmentAdapter = {
  getAssignment: getExperimentAssignment,
  async saveFirstAssignment(input) {
    const assignment = await saveFirstExperimentAssignment(input);
    if (!assignment) {
      throw new Error('Experiment assignment was not persisted.');
    }
    return assignment;
  },
  async bindSessionAssignment(input) {
    const assignment = await bindAnonymousExperimentAssignment({
      websiteId: input.websiteId,
      experimentRunId: input.experimentRunId,
      mutualExclusionGroupId: input.mutualExclusionGroupId,
      sessionAssignmentKey: input.sessionAssignmentKey,
      visitorDigest: input.unitKey,
    });
    if (!assignment) {
      throw new Error('Anonymous Experiment assignment could not be bound.');
    }
    return assignment;
  },
  async getMutualExclusionAssignment(input) {
    const activeExperimentRunIds = await getActiveMutualExclusionRunIds(
      input.websiteId,
      input.mutualExclusionGroupId,
    );
    return getMutualExclusionAssignment({ ...input, activeExperimentRunIds });
  },
  saveDiagnostic(diagnostic) {
    return saveExperimentDiagnostic({
      websiteId: diagnostic.websiteId,
      experimentRunId: diagnostic.experimentRunId,
      type: diagnostic.type,
      reason: diagnostic.reason,
      count: diagnostic.count,
    });
  },
};
