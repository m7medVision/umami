import clickhouse from '@/lib/clickhouse';
import { SENSITIVE_EXPERIMENT_PARAMS } from './utils';

const FUNCTION_NAME = 'experimentCleanup';
const RAW_EXPERIMENT_TABLES = [
  'experiment_assignment',
  'experiment_assignment_binding',
  'experiment_exposure',
  'experiment_outcome_unit',
  'experiment_diagnostic',
] as const;

async function deleteWhere(table: string, predicate: string, params: Record<string, unknown>) {
  await clickhouse.command(
    `alter table ${table} delete where ${predicate} settings mutations_sync = 1`,
    params,
    FUNCTION_NAME,
    SENSITIVE_EXPERIMENT_PARAMS,
  );
}

/** Purges only reconstructable per-Run facts. Frozen PostgreSQL snapshots are untouched. */
export async function purgeExperimentRunRawData(experimentRunId: string) {
  if (!clickhouse.enabled) return { skipped: true as const };

  await Promise.all(
    RAW_EXPERIMENT_TABLES.map(table =>
      deleteWhere(table, 'experiment_run_id = {experimentRunId:UUID}', { experimentRunId }),
    ),
  );
  return { skipped: false as const };
}

/** Analytics reset removes Experiment facts but preserves privacy tombstones and PostgreSQL history. */
export async function resetWebsiteExperimentData(websiteId: string) {
  if (!clickhouse.enabled) return { skipped: true as const };

  await Promise.all(
    RAW_EXPERIMENT_TABLES.map(table =>
      deleteWhere(table, 'website_id = {websiteId:UUID}', { websiteId }),
    ),
  );
  return { skipped: false as const };
}

/** Website deletion removes all Experiment ClickHouse state, including privacy tombstones. */
export async function deleteWebsiteExperimentData(websiteId: string) {
  if (!clickhouse.enabled) return { skipped: true as const };

  await Promise.all(
    [...RAW_EXPERIMENT_TABLES, 'experiment_privacy_tombstone'].map(table =>
      deleteWhere(table, 'website_id = {websiteId:UUID}', { websiteId }),
    ),
  );
  return { skipped: false as const };
}
