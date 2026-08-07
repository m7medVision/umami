import clickhouse from '@/lib/clickhouse';
import { uuid } from '@/lib/crypto';
import type {
  ExperimentAssignmentRecord,
  ExperimentAssignmentUnit,
  ExperimentAssignmentWrite,
} from '@/lib/experiments/assignment';
import { isExperimentSessionAssignmentTombstoned, isExperimentVisitorTombstoned } from './privacy';
import {
  clickhouseDateTime64,
  EXPERIMENT_ASSIGNMENT_VERSION,
  SENSITIVE_EXPERIMENT_PARAMS,
} from './utils';

const FUNCTION_NAME = 'experimentAssignment';

export interface GetExperimentAssignmentArgs {
  websiteId: string;
  experimentRunId: string;
  unitType: ExperimentAssignmentUnit;
  unitKey: string;
}

export async function getExperimentAssignment({
  websiteId,
  experimentRunId,
  unitType,
  unitKey,
}: GetExperimentAssignmentArgs): Promise<ExperimentAssignmentRecord | null> {
  const tombstoned =
    unitType === 'visitor'
      ? await isExperimentVisitorTombstoned(websiteId, unitKey)
      : await isExperimentSessionAssignmentTombstoned(websiteId, experimentRunId, unitKey);
  if (tombstoned) {
    return null;
  }

  const rows = await clickhouse.rawQuery<{ variation: number; assignmentCount: number }[]>(
    `
    select
      argMin(variation, tuple(assigned_at, assignment_id)) as variation,
      count() as assignmentCount
    from experiment_assignment
    where website_id = {websiteId:UUID}
      and experiment_run_id = {experimentRunId:UUID}
      and unit_type = {unitType:String}
      and unit_key = {unitKey:String}
    `,
    { websiteId, experimentRunId, unitType, unitKey },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
  const row = rows[0];

  if (!row || Number(row.assignmentCount) === 0) {
    return null;
  }

  return {
    experimentRunId,
    variation: Number(row.variation),
    unitType,
  };
}

export interface SaveFirstExperimentAssignmentArgs extends ExperimentAssignmentWrite {
  assignedAt?: Date;
  isBinding?: boolean;
}

export async function saveFirstExperimentAssignment({
  websiteId,
  experimentRunId,
  mutualExclusionGroupId,
  unitType,
  unitKey,
  variation,
  assignedAt = new Date(),
  isBinding = false,
}: SaveFirstExperimentAssignmentArgs) {
  const tombstoned =
    unitType === 'visitor'
      ? await isExperimentVisitorTombstoned(websiteId, unitKey)
      : await isExperimentSessionAssignmentTombstoned(websiteId, experimentRunId, unitKey);
  if (tombstoned) {
    return null;
  }

  await clickhouse.insert('experiment_assignment', [
    {
      assignment_id: uuid(),
      website_id: websiteId,
      experiment_run_id: experimentRunId,
      mutual_exclusion_group_id: mutualExclusionGroupId,
      unit_type: unitType,
      unit_key: unitKey,
      variation,
      assignment_version: EXPERIMENT_ASSIGNMENT_VERSION,
      is_binding: isBinding ? 1 : 0,
      assigned_at: clickhouseDateTime64(assignedAt),
      recorded_at: clickhouseDateTime64(new Date()),
    },
  ]);

  return getExperimentAssignment({ websiteId, experimentRunId, unitType, unitKey });
}

export interface BindAnonymousExperimentAssignmentArgs {
  websiteId: string;
  experimentRunId: string;
  mutualExclusionGroupId: string | null;
  sessionAssignmentKey: string;
  visitorDigest: string;
  assignedAt?: Date;
}

export async function bindAnonymousExperimentAssignment({
  websiteId,
  experimentRunId,
  mutualExclusionGroupId,
  sessionAssignmentKey,
  visitorDigest,
  assignedAt,
}: BindAnonymousExperimentAssignmentArgs) {
  const sessionAssignment = await getExperimentAssignment({
    websiteId,
    experimentRunId,
    unitType: 'session',
    unitKey: sessionAssignmentKey,
  });

  if (!sessionAssignment) {
    return null;
  }

  const visitorAssignment = await saveFirstExperimentAssignment({
    websiteId,
    experimentRunId,
    mutualExclusionGroupId,
    unitType: 'visitor',
    unitKey: visitorDigest,
    variation: sessionAssignment.variation,
    assignedAt,
    isBinding: true,
  });

  if (!visitorAssignment) {
    return null;
  }

  const bindingRows = await clickhouse.rawQuery<{ bindingCount: number }[]>(
    `select count() as bindingCount
     from experiment_assignment_binding
     where website_id = {websiteId:UUID}
       and experiment_run_id = {experimentRunId:UUID}
       and session_assignment_key = {sessionAssignmentKey:String}`,
    { websiteId, experimentRunId, sessionAssignmentKey },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
  if (Number(bindingRows[0]?.bindingCount ?? 0) > 0) {
    return visitorAssignment;
  }

  const boundAt = assignedAt ?? new Date();
  await clickhouse.insert('experiment_assignment_binding', [
    {
      binding_id: uuid(),
      website_id: websiteId,
      experiment_run_id: experimentRunId,
      session_assignment_key: sessionAssignmentKey,
      visitor_digest: visitorDigest,
      bound_at: clickhouseDateTime64(boundAt),
      recorded_at: clickhouseDateTime64(new Date()),
    },
  ]);

  return visitorAssignment;
}

export interface GetMutualExclusionAssignmentArgs {
  websiteId: string;
  mutualExclusionGroupId: string;
  activeExperimentRunIds: string[];
  unitType: ExperimentAssignmentUnit;
  unitKey: string;
}

export async function getMutualExclusionAssignment({
  websiteId,
  mutualExclusionGroupId,
  activeExperimentRunIds,
  unitType,
  unitKey,
}: GetMutualExclusionAssignmentArgs): Promise<{ experimentRunId: string } | null> {
  if (!activeExperimentRunIds.length) return null;
  const tombstoned =
    unitType === 'visitor'
      ? await isExperimentVisitorTombstoned(websiteId, unitKey)
      : await isExperimentSessionAssignmentTombstoned(websiteId, null, unitKey);
  if (tombstoned) {
    return null;
  }

  const rows = await clickhouse.rawQuery<{ experimentRunId: string; assignmentCount: number }[]>(
    `
    select
      argMin(experiment_run_id, tuple(assigned_at, assignment_id)) as experimentRunId,
      count() as assignmentCount
    from experiment_assignment
    where website_id = {websiteId:UUID}
      and mutual_exclusion_group_id = {mutualExclusionGroupId:UUID}
      and experiment_run_id in {activeExperimentRunIds:Array(UUID)}
      and unit_type = {unitType:String}
      and unit_key = {unitKey:String}
    `,
    { websiteId, mutualExclusionGroupId, activeExperimentRunIds, unitType, unitKey },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
  const row = rows[0];

  return row && Number(row.assignmentCount) > 0 ? { experimentRunId: row.experimentRunId } : null;
}
