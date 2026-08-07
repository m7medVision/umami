import {
  getRunningFeatureFlagExperimentRunByKey,
  markExperimentRunFirstExposure,
} from '@/queries/prisma';
import {
  getExperimentAssignment,
  getLinkedDistinctIds,
  saveExperimentDiagnostic,
  saveExperimentExposure,
} from '@/queries/sql';
import { createDefaultExposureIngestionService } from './ingestExposure';

export const ingestExposure = createDefaultExposureIngestionService({
  findRunningRun: getRunningFeatureFlagExperimentRunByKey,
  getAssignment: getExperimentAssignment,
  getLinkedDistinctIds,
  saveExposure: saveExperimentExposure,
  markFirstExposure: markExperimentRunFirstExposure,
  saveDiagnostic: saveExperimentDiagnostic,
});
