import clickhouse from '@/lib/clickhouse';
import { uuid } from '@/lib/crypto';
import {
  createExperimentVisitorDigest,
  isExperimentVisitorDigest,
} from '@/lib/experiments/identity';
import { saveExperimentDiagnostic } from './diagnostic';
import { clickhouseDateTime64, SENSITIVE_EXPERIMENT_PARAMS } from './utils';

const FUNCTION_NAME = 'experimentPrivacy';

function identityVersions(visitorDigest: string) {
  if (!isExperimentVisitorDigest(visitorDigest)) {
    throw new Error('A valid versioned Visitor digest is required.');
  }

  const [version] = visitorDigest.split(':');
  const [keyVersion, identityEra] = version.split('.');
  return { keyVersion, identityEra };
}

export async function isExperimentVisitorTombstoned(websiteId: string, visitorDigest: string) {
  identityVersions(visitorDigest);
  const rows = await clickhouse.rawQuery<{ tombstoneCount: number }[]>(
    `
    select count() as tombstoneCount
    from experiment_privacy_tombstone final
    where website_id = {websiteId:UUID}
      and visitor_digest = {visitorDigest:String}
    `,
    { websiteId, visitorDigest },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );

  return Number(rows[0]?.tombstoneCount ?? 0) > 0;
}

/** Suppresses a Session assignment as soon as its bound Visitor is tombstoned. */
export async function isExperimentSessionAssignmentTombstoned(
  websiteId: string,
  experimentRunId: string | null,
  sessionAssignmentKey: string,
) {
  const runPredicate = experimentRunId ? 'and experiment_run_id = {experimentRunId:UUID}' : '';
  const rows = await clickhouse.rawQuery<{ tombstoneCount: number }[]>(
    `
    select count() as tombstoneCount
    from (
      select argMin(visitor_digest, tuple(bound_at, binding_id)) as visitor_digest
      from experiment_assignment_binding
      where website_id = {websiteId:UUID}
        ${runPredicate}
        and session_assignment_key = {sessionAssignmentKey:String}
    ) binding
    inner join experiment_privacy_tombstone as tombstone final
      on tombstone.website_id = {websiteId:UUID}
     and tombstone.visitor_digest = binding.visitor_digest
    where binding.visitor_digest != ''
    `,
    { websiteId, experimentRunId, sessionAssignmentKey },
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );

  return Number(rows[0]?.tombstoneCount ?? 0) > 0;
}

export interface DeleteExperimentVisitorDataArgs {
  websiteId: string;
  userKey: string;
  deletedAt?: Date;
}

/** Accepts the authenticated raw key only at this boundary and never stores or logs it. */
export async function deleteExperimentVisitorData({
  websiteId,
  userKey,
  deletedAt = new Date(),
}: DeleteExperimentVisitorDataArgs) {
  const visitorDigest = createExperimentVisitorDigest(websiteId, userKey);
  const { keyVersion, identityEra } = identityVersions(visitorDigest);

  // Store the tombstone first so reads stop immediately even while mutations run.
  await clickhouse.insert('experiment_privacy_tombstone', [
    {
      tombstone_id: uuid(),
      website_id: websiteId,
      visitor_digest: visitorDigest,
      identity_key_version: keyVersion,
      identity_era: identityEra,
      deleted_at: clickhouseDateTime64(deletedAt),
    },
  ]);
  await saveExperimentDiagnostic({
    websiteId,
    type: 'privacy-deletion',
    reason: 'authenticated-request',
    occurredAt: deletedAt,
  });

  const params = { websiteId, visitorDigest };
  const boundAssignmentUnits = `
    select experiment_run_id, session_assignment_key
    from (
      select
        experiment_run_id,
        session_assignment_key,
        argMin(visitor_digest, tuple(bound_at, binding_id)) as first_visitor_digest
      from experiment_assignment_binding
      where website_id = {websiteId:UUID}
      group by experiment_run_id, session_assignment_key
    )
    where first_visitor_digest = {visitorDigest:String}
  `;
  const linkedSessionIds = `
    select toString(session_id)
    from experiment_exposure final
    where website_id = {websiteId:UUID}
      and (
        (unit_type = 'visitor' and unit_key = {visitorDigest:String})
        or (
          unit_type = 'session'
          and tuple(experiment_run_id, unit_key) in (${boundAssignmentUnits})
        )
      )
  `;

  // Outcome Session keys are authoritative session IDs, so remove them before
  // their source Exposures and binding facts disappear.
  await clickhouse.command(
    `alter table experiment_outcome_unit delete where
      website_id = {websiteId:UUID}
      and (
        (unit_type = 'visitor' and unit_key = {visitorDigest:String})
        or (unit_type = 'session' and unit_key in (${linkedSessionIds}))
      )
      settings mutations_sync = 1`,
    params,
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );

  await Promise.all([
    clickhouse.command(
      `alter table experiment_assignment delete where
        website_id = {websiteId:UUID}
        and (
          (unit_type = 'visitor' and unit_key = {visitorDigest:String})
          or (unit_type = 'session' and tuple(experiment_run_id, unit_key) in (${boundAssignmentUnits}))
        )
        settings mutations_sync = 1`,
      params,
      FUNCTION_NAME,
      SENSITIVE_EXPERIMENT_PARAMS,
    ),
    clickhouse.command(
      `alter table experiment_exposure delete where
        website_id = {websiteId:UUID}
        and (
          (unit_type = 'visitor' and unit_key = {visitorDigest:String})
          or (unit_type = 'session' and tuple(experiment_run_id, unit_key) in (${boundAssignmentUnits}))
        )
        settings mutations_sync = 1`,
      params,
      FUNCTION_NAME,
      SENSITIVE_EXPERIMENT_PARAMS,
    ),
  ]);

  await clickhouse.command(
    `alter table experiment_assignment_binding delete where
      website_id = {websiteId:UUID}
      and visitor_digest = {visitorDigest:String}
      settings mutations_sync = 1`,
    params,
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
}
