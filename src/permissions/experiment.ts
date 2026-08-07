import type { Auth } from '@/lib/types';
import { canDeleteWebsite, canUpdateWebsite, canViewWebsite } from './website';

export interface ExperimentPermissionTarget {
  websiteId: string;
}

export async function canViewExperiment(auth: Auth, experiment: ExperimentPermissionTarget | null) {
  return !!experiment && canViewWebsite(auth, experiment.websiteId);
}

/** Website update permission operates both Experiment definitions and their Runs. */
export async function canUpdateExperiment(
  auth: Auth,
  experiment: ExperimentPermissionTarget | null,
) {
  return !!experiment && canUpdateWebsite(auth, experiment.websiteId);
}

/** Experiments with data are archived; this intentionally uses Website delete permission. */
export async function canArchiveExperiment(
  auth: Auth,
  experiment: ExperimentPermissionTarget | null,
) {
  return !!experiment && canDeleteWebsite(auth, experiment.websiteId);
}

// Keep the repository's conventional canDelete* permission name for route contracts.
export const canDeleteExperiment = canArchiveExperiment;
