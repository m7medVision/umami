import clickhouse from '@/lib/clickhouse';
import { uuid } from '@/lib/crypto';
import type { ExperimentAssignmentUnit } from '@/lib/experiments/assignment';
import { saveExperimentDiagnostic } from './diagnostic';
import { isExperimentSessionAssignmentTombstoned, isExperimentVisitorTombstoned } from './privacy';
import { clickhouseDateTime64, SENSITIVE_EXPERIMENT_PARAMS, ZERO_UUID } from './utils';

const FUNCTION_NAME = 'saveExperimentExposure';

export interface SaveExperimentExposureArgs {
  websiteId: string;
  experimentRunId: string;
  featureFlagKey: string;
  variation: number;
  sessionId: string;
  unitType: ExperimentAssignmentUnit;
  unitKey: string;
  idempotencyKey: string;
  source: string;
  sdkVersion: string;
  exposedAt?: Date;
}

export async function saveExperimentExposure({
  websiteId,
  experimentRunId,
  featureFlagKey,
  variation,
  sessionId,
  unitType,
  unitKey,
  idempotencyKey,
  source,
  sdkVersion,
  exposedAt = new Date(),
}: SaveExperimentExposureArgs): Promise<{ saved: boolean; reason?: 'duplicate' | 'deleted' }> {
  const tombstoned =
    unitType === 'visitor'
      ? await isExperimentVisitorTombstoned(websiteId, unitKey)
      : await isExperimentSessionAssignmentTombstoned(websiteId, experimentRunId, unitKey);
  if (tombstoned) {
    return { saved: false, reason: 'deleted' };
  }

  const dedupSessionId = unitType === 'session' ? sessionId : ZERO_UUID;
  const rows = await clickhouse.rawQuery<{ exposureCount: number }[]>(
    `
    select count() as exposureCount
    from experiment_exposure final
    where website_id = {websiteId:UUID}
      and experiment_run_id = {experimentRunId:UUID}
      and (
        (
          unit_type = {unitType:String}
          and unit_key = {unitKey:String}
          and variation = {variation:UInt16}
          and dedup_session_id = {dedupSessionId:UUID}
        )
        or idempotency_key = {idempotencyKey:String}
      )
    `,
    {
      websiteId,
      experimentRunId,
      unitType,
      unitKey,
      variation,
      dedupSessionId,
      idempotencyKey,
    },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );

  if (Number(rows[0]?.exposureCount ?? 0) > 0) {
    try {
      await saveExperimentDiagnostic({
        websiteId,
        experimentRunId,
        type: 'duplicate',
        reason: 'exposure',
      });
    } catch {
      // Duplicate diagnostics are best-effort; idempotency still succeeds.
    }
    return { saved: false, reason: 'duplicate' };
  }

  const timestamp = clickhouseDateTime64(exposedAt);
  await clickhouse.insert('experiment_exposure', [
    {
      exposure_id: uuid(),
      website_id: websiteId,
      experiment_run_id: experimentRunId,
      feature_flag_key: featureFlagKey,
      variation,
      session_id: sessionId,
      unit_type: unitType,
      unit_key: unitKey,
      dedup_session_id: dedupSessionId,
      idempotency_key: idempotencyKey,
      source,
      sdk_version: sdkVersion,
      exposed_at: timestamp,
      recorded_at: clickhouseDateTime64(new Date()),
    },
  ]);

  return { saved: true };
}
